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
  type DeriveKey,
  EncryptedFiles,
  iri,
  literal,
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
