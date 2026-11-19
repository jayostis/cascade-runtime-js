import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import {
  blank,
  canonical,
  CorePod,
  type DeriveKey,
  EncryptedFiles,
  type Files,
  iri,
  literal,
  type Store,
  type Term,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  FolderFiles,
  headerIn,
  openDatabase,
} from "@cascade-runtime/runtime/node";
import { probing } from "@cascade-runtime/runtime/probe";
import { ownerAbout, tablesBeside } from "cascade-runtime";
import { podKey } from "../src/encrypted.js";
import { openFolderPod } from "../src/node/folder-pod.js";
import {
  answersBeside,
  databaseBeside,
  resolved,
} from "../src/node/resolved.js";
import { openPodWith, type Parts } from "../src/pod.js";
import { profileOf, syntheticPulls } from "./import-bench.js";

const DATABASE = "pod.db";
/** What a sealed pod keeps beside it under names that say only what kind of file each is, as its build and answers. */
const ANSWERS_KEPT = ["answers.json", "pod.json", "build.trig", "build.nt"];
/** A keyed name, as a sealed pod's files are stored under: a keyed hash, in a folder of its first two letters. */
const SEALED_NAME = /^sealed\/[0-9a-f]{2}\/[0-9a-f]{62}$/;
const BUILT_BESIDE = "build.trig";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const LAB_RESULTS = "clinical/lab-results.ttl";
const MANIFEST = "manifest.ttl";
const WHOLE = "core-pod.keepDatabase.whole";
const STEP = "core-pod.step.database";
const KEPT_WHOLE = "kept.whole";
const WORDS = "t-shirt abacus yo-yo zoom drop-down felt-tip";
const MARK = `PLAINTEXT-MARKER-${"x".repeat(40)}`;
/** SQLite's page, the first of which holds the schema. */
const PAGE = 4096;

let pods: string;
let parts: Parts;
let claiming: readonly string[];
/** A pod imported into once and closed, which each test copies before it changes anything. */
let first: string;

/** A stand-in for Argon2id, a hash of what it is given. */
const fastDerive: DeriveKey = async (secret, salt) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array([...secret, ...salt])),
  );

const besideOf = (folder: string): string =>
  join(pods, ".answers", basename(folder));

/** A copy of the pod in the folder and of what is kept beside it, but its answers, which would answer without a build. */
async function copied(from: string, name: string): Promise<string> {
  const to = join(pods, name);
  await cp(from, to, { recursive: true });
  await cp(besideOf(from), besideOf(to), { recursive: true });
  await rm(join(besideOf(to), "answers.json"), { force: true });
  return to;
}

/** The pod in the folder, opened with the parts, `act` run on it, and closed: what ran inside, and the spans it took. */
async function session<T>(
  folder: string,
  act: (pod: Awaited<ReturnType<typeof openPodWith>>) => Promise<T>,
  given: Parts = parts,
): Promise<{ result: T; spans: string[] }> {
  const { result, seen } = await probing(async () => {
    const pod = await openPodWith(given, folder);
    try {
      return await act(pod);
    } finally {
      await pod.close();
    }
  });
  return { result, spans: [...seen.spans.keys()] };
}

/** The later pull, of records the first did not hold. */
const laterPull = () => syntheticPulls(20, { from: 40 });

/** What the database beside the pod in the folder holds, read with the key. */
function readDatabase<T>(
  folder: string,
  read: (db: ReturnType<typeof openDatabase>) => T,
  key?: Uint8Array,
): T {
  const db = openDatabase(
    join(besideOf(folder), DATABASE),
    key === undefined ? {} : { key },
  );
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** Each statement the database holds, as Oxigraph's N-Triples writes it and then its graph, sorted. */
const statementsIn = (db: ReturnType<typeof openDatabase>): string[] =>
  db
    .prepare(
      "SELECT s.nt || ' ' || p.nt || ' ' || o.nt || ' ' || g.nt AS line FROM quad " +
        "JOIN term s ON s.id = quad.s JOIN term p ON p.id = quad.p JOIN term o ON o.id = quad.o JOIN term g ON g.id = quad.g",
    )
    .all()
    .map(({ line }) => String(line))
    .sort();

const ledgerOf = (db: ReturnType<typeof openDatabase>): unknown =>
  db.prepare("SELECT fingerprint FROM ledger").get()?.fingerprint;

/** Each statement of each graph of the union the build kept beside the pod as its working copy holds it, sorted. */
async function builtStatements(folder: string): Promise<string[]> {
  const bytes = await readFile(join(besideOf(folder), BUILT_BESIDE), "utf8");
  const lines = bytes.split("\n");
  const { graphs } = JSON.parse(lines[0]?.slice(2) ?? "{}") as {
    graphs: string[];
  };
  const kept = new Set(graphs);
  const found: string[] = [];
  let graph: string | undefined;
  for (const line of lines.slice(2)) {
    if (graph === undefined) graph = /^<(.*)> \{$/.exec(line)?.[1];
    else if (line === "}") graph = undefined;
    else if (kept.has(graph)) found.push(`${line.slice(0, -2)} <${graph}>`);
  }
  return found.sort();
}

/**
 * The statements but the manifest's, each blank node's label left out, which a store read back names afresh. A build
 * states in its manifest when it was made and by whom, so two builds of one pod differ there and nowhere else.
 */
const blind = (lines: readonly string[]): string[] =>
  lines
    .filter((line) => !line.endsWith(`/${MANIFEST}>`))
    .map((line) => line.replace(/_:\S+/g, "_:"))
    .sort();

const TERM =
  /<[^>]*>|_:\S+|"((?:[^"\\]|\\[\s\S])*)"(?:@([A-Za-z0-9-]+)|\^\^<([^>]*)>)?/g;

/** A term as N-Triples writes it, its literal's lexical form kept escaped as written, which both sides compared share. */
function termOf(written: RegExpExecArray): Term {
  const [text, lexical, language, datatype] = written;
  if (text.startsWith("<")) return iri(text.slice(1, -1));
  if (text.startsWith("_:")) return blank(text.slice(2));
  return literal(
    lexical ?? "",
    language === undefined ? datatype : { language },
  );
}

/** Each graph's statements, from lines of a statement and its graph, in canonical N-Quads by RDFC-1.0, by the graph. */
async function canonicalGraphs(
  lines: readonly string[],
): Promise<Map<string, string>> {
  const graphs = new Map<string, Triple[]>();
  for (const line of lines) {
    const [s, p, o, g] = [...line.matchAll(TERM)].map(termOf);
    assert.ok(
      s !== undefined &&
        s.termType !== "Literal" &&
        p?.termType === "NamedNode" &&
        o !== undefined &&
        g !== undefined,
      line,
    );
    const triples = graphs.get(g.value) ?? [];
    triples.push([s, p, o]);
    graphs.set(g.value, triples);
  }
  const found = new Map<string, string>();
  for (const graph of [...graphs.keys()].sort())
    found.set(graph, await canonical(graphs.get(graph) ?? []));
  return found;
}

/** What the database holds as a reader of it sees it: its statements blind to blank nodes' labels, each screen's triples, and its order. */
function asRead(db: ReturnType<typeof openDatabase>) {
  const screens: Record<string, string[]> = {};
  for (const [name, triples] of screenTriples) {
    screens[name] = db
      .prepare(triples)
      .all()
      .map(({ s, p, o }) => `${String(s)} ${String(p)} ${String(o)}`)
      .sort();
  }
  return {
    statements: blind(statementsIn(db)),
    screens,
    labOrder: db
      .prepare("SELECT sort_key FROM lab_result ORDER BY sort_key")
      .all()
      .map(({ sort_key: key }) => String(key)),
    ledger: ledgerOf(db),
  };
}

/** The `triples` part of each screen's `.sql` among the vocabulary's views, by its name. */
const screenTriples = new Map<string, string>();

before(async () => {
  pods = await mkdtemp(join(tmpdir(), "pod-database-"));
  const resolvedParts = await resolved();
  parts = {
    ...resolvedParts,
    answers: { runtime: "test", at: answersBeside },
    databaseBeside,
    tables: await tablesBeside(pods),
  };
  const views = join(
    (resolvedParts.vocabulary as FolderFiles).folder,
    "queries",
    "views",
  );
  for (const name of await readdir(views))
    if (name.endsWith(".sql"))
      screenTriples.set(
        name,
        (await readFile(join(views, name), "utf8")).split(
          /^-- part: triples\s*$/m,
        )[1] ?? "",
      );
  claiming = await profileOf("first");
  first = join(pods, "first");
  await session(first, async (pod) => {
    for (const pull of syntheticPulls(40))
      await pod.import(pull, { claimProfiles: claiming });
  });
});

after(async () => {
  await rm(pods, { recursive: true, force: true });
});

/**
 * Beside a pod in a folder the runtime keeps `pod.db`: the pod's statements and its screens in SQLite, a cache its
 * files can always build again. It is built whole when it is absent or names another build than the pod's, and kept
 * current after each step.
 */
describe("Keeping a pod's database beside it · openPod(), pod.close()", () => {
  describe("given a pod imported into and closed", () => {
    it("holds in pod.db each statement of the build kept beside the pod, and a row of the lab results screen for each lab result entry", async () => {
      const built = await builtStatements(first);
      const held = readDatabase(first, (db) => ({
        statements: statementsIn(db),
        labRows: Number(
          db.prepare("SELECT count(*) AS n FROM lab_result").get()?.n,
        ),
      }));
      assert.ok(built.length > 0);
      assert.deepEqual(held.statements, built);
      const labEntries = new Set(
        built
          .filter(
            (line) =>
              line.includes(` <${CASCADE}leadMember> `) &&
              line.endsWith(`${LAB_RESULTS}>`),
          )
          .map((line) => line.split(" ")[0]),
      );
      assert.ok(labEntries.size > 0, "the pod holds no lab result entry");
      assert.equal(held.labRows, labEntries.size);
    });
  });

  describe("given a later import, in a later session", () => {
    let stepped: string;
    let spans: string[];
    before(async () => {
      stepped = await copied(first, "stepped");
      ({ spans } = await session(stepped, async (pod) => {
        for (const pull of laterPull())
          await pod.import(pull, { claimProfiles: claiming });
      }));
    });

    it("keeps pod.db equal, graph by graph and its manifest with them, to the build kept beside the pod at the same close", async () => {
      assert.ok(spans.includes(STEP), spans.join(", "));
      assert.ok(!spans.includes(WHOLE), spans.join(", "));
      const held = await canonicalGraphs(readDatabase(stepped, statementsIn));
      const built = await canonicalGraphs(await builtStatements(stepped));
      assert.ok(
        [...held.keys()].some((graph) => graph.endsWith(`/${MANIFEST}`)),
      );
      assert.deepEqual(held, built);
    });

    it("keeps pod.db equal to one built whole from the same pod, by its step and without building it whole", async () => {
      assert.ok(spans.includes(STEP), spans.join(", "));
      assert.ok(!spans.includes(WHOLE), spans.join(", "));

      const whole = join(pods, "stepped-whole");
      await cp(stepped, whole, { recursive: true });
      const built = await session(whole, (pod) =>
        pod.ask("pod/My active conditions"),
      );
      assert.ok(built.spans.includes(WHOLE), built.spans.join(", "));
      const keyed = readDatabase(stepped, asRead);
      assert.ok(
        Object.values(keyed.screens).some((triples) => triples.length > 0),
      );
      assert.deepEqual(keyed, readDatabase(whole, asRead));
    });
  });

  describe("given the owner's claim of another hospital's patient, the first act of a later session", () => {
    it("keeps pod.db by the claim's step, from the build kept beside the pod, without building either whole", async () => {
      const claimed = await copied(first, "claimed");
      const { result: imported } = await session(claimed, (pod) =>
        pod.import(syntheticPulls(5, { hospital: "second" })[0]!, {
          match: false,
        }),
      );
      const [profile] = imported.unclaimedProfiles;
      assert.ok(profile !== undefined);
      const { spans } = await session(claimed, (pod) =>
        pod.judge(ownerAbout(pod, profile)),
      );
      assert.ok(spans.includes(STEP), spans.join(", "));
      assert.ok(!spans.includes(KEPT_WHOLE), spans.join(", "));
      assert.ok(!spans.includes(WHOLE), spans.join(", "));
      assert.deepEqual(
        await canonicalGraphs(readDatabase(claimed, statementsIn)),
        await canonicalGraphs(await builtStatements(claimed)),
      );
    });
  });

  describe("given an import refused for want of its export, the first act of a later session", () => {
    it("rebuilds from the build kept beside the pod, building neither the pod nor pod.db whole", async () => {
      const refused = await copied(first, "refused");
      const { result, spans } = await session(refused, (pod) =>
        pod.import(join(pods, "no-such-export")),
      );
      assert.ok(result.refused !== undefined, JSON.stringify(result));
      assert.ok(!spans.includes(KEPT_WHOLE), spans.join(", "));
      assert.ok(!spans.includes(WHOLE), spans.join(", "));
      // The step stamps the manifest afresh; no file the build's queries wrote changed, so the build is not kept again.
      const unstamped = (lines: readonly string[]) =>
        canonicalGraphs(
          lines.filter((line) => !line.endsWith(`/${MANIFEST}>`)),
        );
      assert.deepEqual(
        await unstamped(readDatabase(refused, statementsIn)),
        await unstamped(await builtStatements(refused)),
      );
    });
  });

  describe("given a fingerprint other than the one pod.db was built under", () => {
    it("builds pod.db whole again, holding each statement of the build kept beside the pod", async () => {
      const refingered = await copied(first, "refingered");
      const before = readDatabase(refingered, ledgerOf);
      const { spans } = await session(
        refingered,
        (pod) => pod.ask("pod/My active conditions"),
        { ...parts, builtCode: "another" },
      );
      assert.ok(spans.includes(WHOLE), spans.join(", "));
      assert.notEqual(readDatabase(refingered, ledgerOf), before);
      assert.deepEqual(
        readDatabase(refingered, statementsIn),
        await builtStatements(refingered),
      );
    });
  });

  describe("given a pod.db damaged past its first page, which opens and names its ledger but does not read", () => {
    it("takes the next step as if pod.db named no fingerprint, and builds pod.db whole again at the close", async () => {
      const damaged = await copied(first, "damaged");
      const path = join(besideOf(damaged), DATABASE);
      const size = (await stat(path)).size;
      const handle = await open(path, "r+");
      try {
        await handle.write(
          Buffer.alloc(size - PAGE, 0xab),
          0,
          size - PAGE,
          PAGE,
        );
      } finally {
        await handle.close();
      }
      const { spans } = await session(damaged, async (pod) => {
        for (const pull of laterPull())
          await pod.import(pull, { claimProfiles: claiming });
      });
      assert.ok(spans.includes(WHOLE), spans.join(", "));
      assert.deepEqual(
        blind(readDatabase(damaged, statementsIn)),
        blind(await builtStatements(damaged)),
      );
    });
  });

  describe("when the process stops after a step's files are written and before pod.db commits", () => {
    it("finds the ledger stale at the next open, keeps nothing on it by a step, and builds pod.db whole", async () => {
      const stopped = await copied(first, "stopped");
      const path = join(besideOf(stopped), DATABASE);
      const beforeStep = await readFile(path);
      await session(stopped, async (pod) => {
        for (const pull of laterPull())
          await pod.import(pull, { claimProfiles: claiming });
      });
      await writeFile(path, beforeStep);
      for (const log of [`${path}-wal`, `${path}-shm`])
        await rm(log, { force: true });
      const stale = readDatabase(stopped, ledgerOf);
      assert.equal(stale, readDatabase(first, ledgerOf));

      const { spans } = await session(stopped, (pod) =>
        pod.ask("pod/My active conditions"),
      );
      assert.ok(spans.includes(WHOLE), spans.join(", "));
      assert.ok(!spans.includes(STEP), spans.join(", "));
      assert.notEqual(readDatabase(stopped, ledgerOf), stale);
      assert.deepEqual(
        blind(readDatabase(stopped, statementsIn)),
        blind(await builtStatements(stopped)),
      );
    });
  });

  describe("given a sealed pod", () => {
    const at = () => join(pods, "sealed");
    /** The files kept beside the sealed pod once it is closed, by their paths there. */
    let kept: string[];
    /** The database's key, and the paths of the database and of its key file beside the pod. */
    let sealedKey: Uint8Array | undefined;
    let databaseAt: string | undefined;
    let keyAt: string | undefined;

    before(async () => {
      const opened = await openFolderPod(
        { ...parts, derive: fastDerive },
        at(),
        { secret: WORDS },
      );
      try {
        for (const pull of syntheticPulls(40))
          await opened.import(pull, { claimProfiles: claiming });
      } finally {
        await opened.close();
      }
      kept = (
        await readdir(besideOf(at()), { recursive: true, withFileTypes: true })
      )
        .filter((entry) => entry.isFile())
        .map((entry) =>
          join(entry.parentPath, entry.name)
            .slice(besideOf(at()).length + 1)
            .replaceAll("\\", "/"),
        )
        .sort();
      const podsKey = await podKey(
        {
          files: new FolderFiles(at()),
          header: await headerIn(at()),
          reread: () => headerIn(at()),
          held: async () => true,
        },
        WORDS,
        fastDerive,
      );
      assert.ok(podsKey);
      const sealed = new EncryptedFiles(answersBeside(at()), podsKey, {
        kind: "answers",
      });
      for (const path of kept.filter((path) => SEALED_NAME.test(path))) {
        const opens = await sealed.read(path);
        if (opens === undefined) databaseAt = path;
        else {
          keyAt = path;
          sealedKey = opens;
        }
      }
    });

    it("names no file beside it by what it holds: the database and its key are each under a keyed name, as a sealed pod's own files are", () => {
      assert.deepEqual(
        kept.filter(
          (path) => !ANSWERS_KEPT.includes(path) && !SEALED_NAME.test(path),
        ),
        [],
      );
      assert.ok(databaseAt !== undefined, kept.join(", "));
      assert.ok(keyAt !== undefined, kept.join(", "));
    });

    it("seals pod.db, its log, its shared memory and its key file: none holds the pod's statements, its key, or a marker a transaction killed part way wrote", async () => {
      assert.ok(databaseAt !== undefined && keyAt !== undefined);
      const key = sealedKey;
      assert.equal(key?.length, 32);
      const path = join(besideOf(at()), databaseAt);
      const db = openDatabase(path, { key });
      let statements: string[];
      try {
        statements = statementsIn(db);
      } finally {
        db.close();
      }
      assert.ok(statements.some((line) => line.includes(CASCADE)));

      const opener = import.meta.resolve("@cascade-runtime/runtime/node");
      await promisify(execFile)(process.execPath, [
        "--input-type=module",
        "-e",
        `const [path, hex, mark] = process.argv.slice(-3);
const { openDatabase } = await import(${JSON.stringify(opener)});
const db = openDatabase(path, { key: Buffer.from(hex, "hex") });
db.exec("PRAGMA cache_size=50");
db.exec("BEGIN");
const put = db.prepare("INSERT INTO term (nt, kind, lex) VALUES (?, 3, ?)");
for (let i = 0; i < 20000; i++) put.run('"' + mark + i + '"', mark + i);
process.exit(0);`,
        path,
        Buffer.from(key ?? []).toString("hex"),
        MARK,
      ]);
      const files = [
        path,
        `${path}-wal`,
        `${path}-shm`,
        join(besideOf(at()), keyAt),
      ];
      assert.ok(
        existsSync(`${path}-wal`),
        "the killed transaction left no log",
      );
      for (const file of files) {
        const bytes = await readFile(file);
        const text = bytes.toString("latin1");
        for (const plain of [MARK, CASCADE, "SQLite format 3"])
          assert.ok(!text.includes(plain), `${file} holds ${plain}`);
        assert.ok(
          !bytes.includes(Buffer.from(key ?? [])),
          `${file} holds the key`,
        );
      }
    });
  });
});

const LABS = "pod/My lab results";
const CONDITIONS = "pod/My active conditions";
/** A question of the vocabulary's that has no `.sql` beside its `.rq`. */
const NO_SQL = "pod/What each folder holds";

/** The parts with no database beside the pod and no answers kept: every question is asked of the store. */
function storeOnly(given: Parts): Parts {
  return {
    ...given,
    databaseBeside: undefined,
    answers: undefined,
    builtBeside: answersBeside,
  };
}

/** The name of each question of the vocabulary with a `.sql` beside its `.rq`. */
async function sqlQuestions(): Promise<string[]> {
  const folder = "queries/questions/";
  return (await parts.vocabulary.list(folder))
    .filter((path) => path.endsWith(".sql"))
    .map((path) => path.slice(folder.length, -".sql".length))
    .sort();
}

/**
 * The parts with each store they make counted as it loads statements, by a restore of a kept build, a file loaded or
 * triples added, and each `CorePod.dataset()` counted, the store read whole.
 */
function counting(given: Parts) {
  const loads = { restored: 0, files: 0, triples: 0, datasets: 0 };
  const counted: Record<string, (args: readonly unknown[]) => void> = {
    restore: () => (loads.restored += 1),
    loadTurtle: () => (loads.files += 1),
    loadFiles: ([files]) => (loads.files += [...(files as unknown[])].length),
    add: ([triples]) => (loads.triples += [...(triples as unknown[])].length),
  };
  const newStore = (): Store =>
    new Proxy(given.newStore(), {
      get(target, name) {
        const value: unknown = Reflect.get(target, name, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (typeof name === "string") counted[name]?.(args);
          return (value as (...given: unknown[]) => unknown).apply(
            target,
            args,
          );
        };
      },
    });
  const dataset = CorePod.prototype.dataset;
  CorePod.prototype.dataset = function (this: CorePod, lens: string) {
    loads.datasets += 1;
    return dataset.call(this, lens);
  };
  return {
    parts: { ...given, newStore },
    loads,
    restore: () => {
      CorePod.prototype.dataset = dataset;
    },
  };
}

interface Paged {
  readonly rows: unknown[];
  readonly pages: number;
}

/** The question's pages of `size`, each asked after the key the one before gave, joined, until one names no next. */
async function pagesJoined(
  pod: Awaited<ReturnType<typeof openPodWith>>,
  question: string,
  size: number,
  most: number,
): Promise<Paged> {
  const rows: unknown[] = [];
  let after: string | undefined;
  let pages = 0;
  while (pages <= most) {
    const page = await pod.askPage(question, {
      size,
      ...(after === undefined ? {} : { after }),
    });
    pages += 1;
    rows.push(...page.rows);
    after = page.next;
    if (after === undefined) break;
  }
  return { rows, pages };
}

/** The parts with every write to a pod's files held at a gate, once `reached` says the first write came to it. */
function writesHeld(given: Parts) {
  let release = (): void => undefined;
  const gate = new Promise<void>((open) => (release = open));
  let reach = (): void => undefined;
  const reached = new Promise<void>((came) => (reach = came));
  const held = (files: Files): Files => ({
    ...files,
    iri: files.iri,
    read: (path) => files.read(path),
    list: (folder) => files.list(folder),
    write: async (path, bytes) => {
      reach();
      await gate;
      return files.write(path, bytes);
    },
    ...(files.writeAll === undefined
      ? {}
      : {
          writeAll: async (written) => {
            reach();
            await gate;
            return files.writeAll!(written);
          },
        }),
  });
  return {
    parts: {
      ...given,
      folder: (path: string, iri?: string) => {
        const folder = given.folder(path, iri);
        return { ...folder, files: held(folder.files) };
      },
    } satisfies Parts,
    reached,
    release: () => release(),
  };
}

/**
 * A pod opened again answers a named question that has a `.sql` beside its `.rq` from `pod.db`, its rows those the store
 * gives, a page at a time when asked for one, without building the store, waiting for a step, or keeping answers.
 */
describe("Answering a pod's questions from its database, a page at a time · pod.ask(), pod.askPage()", () => {
  describe("given a pod imported into and closed, opened again", () => {
    it("answers My lab results without reading the pod whole: no dataset is read and no store loads a statement", async () => {
      const folder = await copied(first, "asked-unloaded");
      const watched = counting(parts);
      try {
        const pod = await openPodWith(watched.parts, folder);
        try {
          const rows = await pod.ask(LABS);
          assert.ok(rows.length > 0, "the pod has no lab results");
          assert.deepEqual(watched.loads, {
            restored: 0,
            files: 0,
            triples: 0,
            datasets: 0,
          });
        } finally {
          await pod.close();
        }
      } finally {
        watched.restore();
      }
    });

    it("gives, for each question with a .sql, the rows the store gives a pod with no database", async () => {
      const named = await sqlQuestions();
      assert.ok(named.includes(LABS) && named.includes(CONDITIONS));
      const fromDatabase = await session(
        await copied(first, "asked-database"),
        async (pod) => {
          const found: Record<string, unknown> = {};
          for (const question of named)
            found[question] = await pod.ask(question);
          return found;
        },
      );
      assert.ok(!fromDatabase.spans.includes(KEPT_WHOLE));
      const fromStore = await session(
        await copied(first, "asked-store"),
        async (pod) => {
          const found: Record<string, unknown> = {};
          for (const question of named)
            found[question] = await pod.ask(question);
          return found;
        },
        storeOnly(parts),
      );
      for (const question of named)
        assert.deepEqual(
          fromDatabase.result[question],
          fromStore.result[question],
          question,
        );
    });

    it("gives pages of 1, 2 and 50 that join, in order, to the whole list ask gives, the last naming no next page", async () => {
      const { result } = await session(
        await copied(first, "asked-pages"),
        async (pod) => {
          const whole = await pod.ask(LABS);
          const joined: Record<number, Paged> = {};
          for (const size of [1, 2, 50])
            joined[size] = await pagesJoined(pod, LABS, size, whole.length);
          return { whole, joined };
        },
      );
      assert.ok(result.whole.length > 2, "too few lab results to page");
      for (const size of [1, 2, 50])
        assert.deepEqual(
          result.joined[size]?.rows,
          result.whole,
          `pages of ${size}`,
        );
      assert.ok((result.joined[1]?.pages ?? 0) > 2);
      assert.equal(result.joined[50]?.pages, 1);
    });

    it("pages a question with no .sql the same way, from the rows the store gives", async () => {
      const { result } = await session(
        await copied(first, "asked-pages-no-sql"),
        async (pod) => {
          const whole = await pod.ask(NO_SQL);
          return {
            whole,
            ones: await pagesJoined(pod, NO_SQL, 1, whole.length),
            twos: await pagesJoined(pod, NO_SQL, 2, whole.length),
          };
        },
      );
      assert.ok(result.whole.length > 2);
      assert.deepEqual(result.ones.rows, result.whole);
      assert.deepEqual(result.twos.rows, result.whole);
      assert.ok(result.ones.pages > result.twos.pages);
    });

    it("refuses a page size that is no whole number above 0, and a key no page of a question with no .sql gave", async () => {
      await session(await copied(first, "asked-pages-refused"), async (pod) => {
        for (const size of [0, -1, 1.5, Number.NaN, "50"])
          await assert.rejects(
            pod.askPage(LABS, { size: size as number }),
            { name: "Refusal" },
            String(size),
          );
        await assert.rejects(
          pod.askPage(NO_SQL, { size: 1, after: "34D69677." }),
          { name: "Refusal" },
        );
        await assert.rejects(pod.askPage(NO_SQL, { size: 1, after: "@-1" }), {
          name: "Refusal",
        });
      });
    });

    it("keeps no answers.json for a question with a .sql", async () => {
      const folder = await copied(first, "asked-unkept");
      await session(folder, async (pod) => {
        await pod.ask(LABS);
        await pod.ask(CONDITIONS);
      });
      assert.ok(!existsSync(join(besideOf(folder), "answers.json")));
    });

    it("answers a question with no .sql by building the store, the rows the store gives a pod with no database", async () => {
      assert.ok(!(await sqlQuestions()).includes(NO_SQL));
      const folder = await copied(first, "asked-no-sql");
      const watched = counting(parts);
      let rows: unknown;
      try {
        ({ result: rows } = await session(
          folder,
          (pod) => pod.ask(NO_SQL),
          watched.parts,
        ));
        assert.equal(watched.loads.datasets, 1);
      } finally {
        watched.restore();
      }
      const { result: fromStore } = await session(
        await copied(first, "asked-no-sql-store"),
        (pod) => pod.ask(NO_SQL),
        storeOnly(parts),
      );
      assert.ok(Array.isArray(rows) && rows.length > 0);
      assert.deepEqual(rows, fromStore);
    });
  });

  describe("when a later import is held part way, its files not yet written", () => {
    it("answers a question with a .sql at once, with the rows from before the import, and after it with the rows of the pod it left", async () => {
      const folder = await copied(first, "asked-held");
      const holding = writesHeld(parts);
      const pod = await openPodWith(holding.parts, folder);
      try {
        const before = await pod.ask(LABS);
        const importing = pod.import(laterPull()[0]!, {
          claimProfiles: claiming,
        });
        importing.catch(() => undefined);
        await holding.reached;
        const waited = Symbol("waited");
        const during = await Promise.race([
          pod.ask(LABS),
          new Promise<typeof waited>((resolve) =>
            setTimeout(() => resolve(waited), 20_000),
          ),
        ]);
        holding.release();
        await importing;
        assert.notEqual(during, waited, "the question waited for the import");
        assert.deepEqual(during, before);
        const after = await pod.ask(LABS);
        assert.ok(after.length > before.length, "the import added no lab");
        await pod.close();
        const { result: fromStore } = await session(
          await copied(folder, "asked-held-store"),
          (opened) => opened.ask(LABS),
          storeOnly(parts),
        );
        assert.deepEqual(after, fromStore);
      } finally {
        holding.release();
        await pod.close().catch(() => undefined);
      }
    });
  });

  describe("given a pod opened again and asked a page of a question with a .sql", () => {
    it("pages on from pod.db after a retitle, reading no dataset, with the new title in pod.db and no build of it whole at close", async () => {
      const folder = await copied(first, "asked-retitled");
      const title = "Retitled for the test";
      const watched = counting(parts);
      try {
        const { result, spans } = await session(
          folder,
          async (pod) => {
            const page = await pod.askPage(LABS, { size: 2 });
            assert.ok(page.next !== undefined, "too few lab results to page");
            await pod.retitle(title);
            const next = await pod.askPage(LABS, {
              size: 2,
              after: page.next,
            });
            return { next, loads: { ...watched.loads } };
          },
          watched.parts,
        );
        assert.ok(result.next.rows.length > 0);
        assert.deepEqual(result.loads, {
          restored: 0,
          files: 0,
          triples: 0,
          datasets: 0,
        });
        assert.ok(!spans.includes(WHOLE), "pod.db was built whole at close");
      } finally {
        watched.restore();
      }
      assert.ok(
        readDatabase(folder, statementsIn).some((line) =>
          line.includes(`"${title}"`),
        ),
        "pod.db does not hold the new title",
      );
    });

    it("refuses a key of no page_key's shape rather than paging after it", async () => {
      await session(await copied(first, "asked-made-up-key"), async (pod) => {
        for (const after of ["zzzz-not-a-key", "", "34D696.", "mnm~"])
          await assert.rejects(
            pod.askPage(LABS, { size: 1, after }),
            { name: "Refusal" },
            after,
          );
      });
    });

    it("pages after a key of the rows ask gave from pod.db, as the store would, restoring no store", async () => {
      const folder = await copied(first, "asked-rows-key");
      const watched = counting(parts);
      try {
        const { result } = await session(
          folder,
          async (pod) => {
            const second = await pod.askPage(LABS, {
              size: 2,
              after: (await pod.askPage(LABS, { size: 2 })).next!,
            });
            const counted = await pod.askPage(LABS, { size: 2, after: "@2" });
            return { second, counted, loads: { ...watched.loads } };
          },
          watched.parts,
        );
        assert.deepEqual(result.counted, result.second);
        assert.equal(result.loads.restored, 0);
        assert.equal(result.loads.datasets, 0);
      } finally {
        watched.restore();
      }
    });

    it("answers under a lens pod.db was not built for from the store, the rows the store gives", async () => {
      const lens = "export";
      const { result } = await session(
        await copied(first, "asked-other-lens"),
        (pod) => pod.ask(LABS, { lens }),
      );
      const { result: fromStore } = await session(
        await copied(first, "asked-other-lens-store"),
        (pod) => pod.ask(LABS, { lens }),
        storeOnly(parts),
      );
      assert.ok(result.length > 0);
      assert.deepEqual(result, fromStore);
    });
  });

  describe("when the pod is closed as a question is asked", () => {
    it("refuses the question, as it refuses any call after close, and leaves no connection to pod.db open", async () => {
      let opened = 0;
      let closed = 0;
      const given: Parts = {
        ...parts,
        databaseBeside: async (path, name) => {
          const beside = await parts.databaseBeside!(path, name);
          return {
            ...beside,
            builtWhole: (whole) => beside.builtWhole(whole),
            remove: () => beside.remove(),
            open: (options) => {
              const db = beside.open(options);
              opened += 1;
              return {
                prepare: (sql) => db.prepare(sql),
                exec: (sql) => db.exec(sql),
                transaction: (work) => db.transaction(work),
                close: () => {
                  closed += 1;
                  db.close();
                },
              };
            },
          };
        },
      };
      for (const askedBefore of [false, true]) {
        const pod = await openPodWith(
          given,
          await copied(first, `asked-closing-${String(askedBefore)}`),
        );
        if (askedBefore) await pod.askPage(LABS, { size: 1 });
        const closing = pod.close();
        const asked = pod.ask(LABS);
        await closing;
        await assert.rejects(asked, /is closed/, String(askedBefore));
      }
      assert.ok(opened > 0);
      assert.equal(closed, opened, "a connection to pod.db is left open");
    });
  });
});
