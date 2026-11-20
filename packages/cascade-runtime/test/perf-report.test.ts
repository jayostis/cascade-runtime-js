import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import { openPod } from "cascade-runtime";
import { wholeBuildJob } from "@cascade-runtime/runtime/node";
import {
  probing,
  recorded,
  type Seen,
  type SpanEvent,
  timed,
} from "@cascade-runtime/runtime/probe";
import { explain, glossaryMarkdown, readGlossary } from "./perf-glossary.js";
import { type Database } from "@cascade-runtime/runtime";
import { resolved } from "../src/node/resolved.js";
import { flatten, loadPlainly } from "./perf-floor.js";
import { held, rowsOfHeld } from "./perf-held.js";
import { rowsOfJobs } from "./perf-jobs-held.js";
import { profileOf, syntheticPull } from "./import-bench.js";
import {
  changedBundle,
  CHANGED_ENTRIES,
  clockRow,
  commits,
  databaseFigures,
  folderFingerprint,
  openedAt,
  parsed,
  PINNED,
  pinClock,
  pinnedAt,
  pinOf,
  countRow,
  oneMoreBundle,
  perfFile,
  unitOfCounter,
  envOf,
  floorRows,
  tabulated,
  FIRST_SCREEN,
  KIT,
  PAGES,
  part,
  probedRows,
  refused,
  RUNTIME_ROOT,
  SCENARIOS,
  storedIn,
  STORED_KINDS,
  THEN,
  type Plan,
  type Row,
  type Scenario,
  type Stored,
  type StoredKind,
} from "./perf-report.js";

const history = (await import(
  pathToFileURL(
    fileURLToPath(
      new URL("../../../../scripts/perf-history.mjs", import.meta.url),
    ),
  ).href
)) as {
  forHistory(
    file: object,
    options?: object,
  ): { name: string; value: number; extra?: string }[];
};

const stacked = (await import(
  pathToFileURL(
    fileURLToPath(
      new URL("../../../../scripts/perf-stacked.mjs", import.meta.url),
    ),
  ).href
)) as { readGlossary(folder?: string): object };

interface Rates {
  lines?: number;
  files?: number;
}
interface Speed {
  imported: number;
  floor?: { total: number };
  times?: number;
  records?: number;
  lines?: number;
  files?: number;
  queries?: number;
  facts?: number;
  rates: { saving: Rates };
}
interface Compare {
  compare(before: object, after: object, options?: object): string;
  comparison(file: object, options?: object): string;
  cpuModelOf(file: object): string | undefined;
  summary(file: object, options?: object): string;
  speedOf(file: object, key: string): Speed | undefined;
  floorLine(speed: Speed | undefined): string | undefined;
  shown(value: number | undefined, unit: string): string;
}

const execFileAsync = promisify(execFile);

const scratch: string[] = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A checkout beside the runtime's, as CI lays them out. */
const beside = (...path: string[]) => join(dirname(RUNTIME_ROOT), ...path);

const compare = (await import(
  pathToFileURL(
    fileURLToPath(
      new URL("../../../../scripts/perf-compare.mjs", import.meta.url),
    ),
  ).href
)) as Compare;

interface StoredPage {
  entries: number;
  podRecords: number;
  versionLinks: number;
  kinds: {
    id: string;
    files: number;
    statements: number;
    bytes: number;
    class: string;
  }[];
  classes: {
    class: string;
    files: number;
    statements: number;
    bytes: number;
  }[];
}

const stored$ = (await import(
  pathToFileURL(
    fileURLToPath(
      new URL("../../../../scripts/perf-stored.mjs", import.meta.url),
    ),
  ).href
)) as {
  storedKeys(file: object): string[];
  storedOf(
    file: object,
    key: string,
    glossary?: object,
  ): StoredPage | undefined;
  storedLine(page: StoredPage): string;
};

const file = (rows: Row[]) => ({
  env: { os: "linux", runner: "ci; cpu", cpus: 4, node: "24.0.0" },
  commit: { runtime: "a".repeat(40) },
  results: rows,
});

/**
 * The runtime's performance file is rows in the Bridge spec's result format: the headline times come from unprobed
 * runs and the stages and counts from one probed run, and a comparison of two files says what moved, as a change in
 * percent and a multiple.
 */
describe("The performance file · perf-report.ts, perf-compare.mjs", () => {
  describe("given the names of spans, counts and questions the runtime records", () => {
    it("names every one as a row of the result schema's name pattern, none twice", () => {
      const rows = probedRows("fresh-first-screen-synthea-10y", {
        spans: [
          {
            name: "core-pod.step.rebuild:import+judge",
            calls: 1,
            ms: 1500,
            wallMs: 1500,
          },
          {
            name: "matcher.rule:https://ns.cascadeprotocol.org/cascade#SameCodeAndDay",
            calls: 3,
            wallMs: 20,
            ms: 20,
          },
          { name: "question:pod/My lab results", calls: 1, ms: 12, wallMs: 12 },
          { name: "bridge.stage:records", calls: 1, ms: 9, wallMs: 9 },
        ],
        counts: {
          "store.queries": 40,
          "matcher.query: SELECT ?a WHERE { ?a <x> ?b }": 2,
          "matcher.query: SELECT ?a WHERE { ?a <y> ?b }": 2,
        },
      });
      assert.equal(rows.filter((row) => refused(row) !== undefined).length, 0);
      assert.equal(new Set(rows.map(({ name }) => name)).size, rows.length);
      assert.ok(
        rows.some(
          ({ name }) =>
            name ===
            "fresh-first-screen-synthea-10y/stage/core-pod.step.rebuild-import-judge",
        ),
      );
    });

    it("turns a colon, a slash and a space into a dash, and an upper case letter into lower case", () => {
      assert.equal(
        part("question:pod/My lab results"),
        "question-pod-my-lab-results",
      );
      assert.equal(part("bridge.stage:records"), "bridge.stage-records");
    });
  });

  describe("given a row with no samples, a name of one part, or a negative time", () => {
    it("refuses each as the result schema would", () => {
      const row: Row = {
        name: "close-x/total",
        unit: "s",
        value: 1,
        kind: "clock",
        samples: 3,
        range: "1.000-2.000",
      };
      assert.equal(refused(row), undefined);
      assert.match(refused({ ...row, samples: undefined }) ?? "", /samples/);
      assert.match(refused({ ...row, name: "total" }) ?? "", /name/);
      assert.match(refused({ ...row, value: -1 }) ?? "", /value/);
    });

    it("writes a clock row as the median of its samples and their range", () => {
      const row = clockRow("close-x/total", "s", [3, 1, 2], "x");
      assert.deepEqual(
        [row.value, row.samples, row.range],
        [2, 3, "1.000000-3.000000"],
      );
    });
  });

  describe("given two files, one slower and with a count that changed", () => {
    const before = file([
      {
        name: "fresh-first-screen-x/total",
        unit: "s",
        value: 40,
        kind: "clock",
        samples: 3,
        range: "39.000-41.000",
      },
      {
        name: "fresh-first-screen-x/count/store.queries",
        unit: "{count}",
        value: 100,
        kind: "cost",
      },
      {
        name: "fresh-first-screen-x/count/graph.scans",
        unit: "{count}",
        value: 7,
        kind: "cost",
      },
    ]);
    const after = file([
      {
        name: "fresh-first-screen-x/total",
        unit: "s",
        value: 10,
        kind: "clock",
        samples: 3,
        range: "9.000-11.000",
      },
      {
        name: "fresh-first-screen-x/count/store.queries",
        unit: "{count}",
        value: 50,
        kind: "cost",
      },
      {
        name: "fresh-first-screen-x/count/graph.scans",
        unit: "{count}",
        value: 7,
        kind: "cost",
      },
    ]);

    it("gives before and after, the change in percent and the multiple", () => {
      const text = compare.compare(before, after);
      assert.match(
        text,
        /fresh-first-screen-x\/total\s+40\.0 s\s+10\.0 s\s+-75% \(4\.0x faster\)/,
      );
    });

    it("lists the count that changed, exactly, and not the one that did not", () => {
      const text = compare.compare(before, after);
      assert.match(text, /count\/store\.queries\s+100\s+50\s+-50%/);
      assert.doesNotMatch(text, /graph\.scans/);
    });

    it("says that two files taken on different machines do not compare", () => {
      const other = { ...after, env: { ...after.env, cpus: 8 } };
      assert.match(compare.compare(before, other), /different cpus/);
    });
  });

  describe("given a count of bytes, as a handoff's is", () => {
    const bytes = (value: number): Row[] => [
      {
        name: "fresh-first-screen-x/count/handoff.1-document.bytes",
        unit: "By",
        value,
        kind: "cost",
      },
      {
        name: "fresh-first-screen-x/count/handoff.1-document.items",
        unit: "{count}",
        value: 3,
        kind: "cost",
      },
    ];

    it("is a row in bytes where its counter's name ends in .bytes, and a count of things otherwise", () => {
      const count = countRow(
        "x-y/count/handoff.2-answer.bytes",
        19_600_000,
        undefined,
        unitOfCounter("handoff:2-answer.bytes"),
      );
      assert.deepEqual([count.unit, count.kind], ["By", "cost"]);
      assert.equal(refused(count), undefined);
      assert.equal(
        countRow("x-y/count/handoff.2-answer.items", 4).unit,
        "{count}",
      );
      assert.equal(unitOfCounter("bytesome"), "{count}");
    });

    it("is in bytes when its row's name was cut at the length a part allows, or numbered because another had it", () => {
      const long = `${"a".repeat(120)}.bytes`;
      assert.equal(part(long).endsWith(".bytes"), false, "the cut lost it");
      const rows = probedRows("x-y", {
        spans: [],
        counts: {
          [long]: 5,
          [`${"a".repeat(110)}.bytes`]: 6,
          [`${"a".repeat(110)}.items`]: 7,
        },
      });
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map(({ unit }) => unit).sort(), [
        "By",
        "By",
        "{count}",
      ]);
      assert.ok(
        rows.some(({ name }) => /-\d+$/.test(name)),
        "one was numbered",
      );
      for (const row of rows) assert.equal(refused(row), undefined);
    });

    it("is written as bytes by the probed run's count rows too", () => {
      const rows = probedRows("x-y", {
        spans: [],
        counts: { "handoff:2-answer.bytes": 7, "handoff:2-answer.items": 2 },
      });
      const unitOf = (suffix: string) =>
        rows.find(({ name }) => name.endsWith(suffix))?.unit;
      assert.equal(unitOf(".bytes"), "By");
      assert.equal(unitOf(".items"), "{count}");
    });

    it("is compared as an exact count, in whole bytes, with no word of faster or slower", () => {
      const text = compare.compare(
        file(bytes(19_600_000)),
        file(bytes(19_500_000)),
      );
      assert.match(
        text,
        /count\/handoff\.1-document\.bytes\s+19,600,000 By\s+19,500,000 By\s+-0\.5% \(1\.0x\)/,
      );
      assert.doesNotMatch(text, /faster|slower/);
      assert.doesNotMatch(text, /handoff\.1-document\.items/);
    });

    it("is shown in whole mebibytes as a headline size is, and a small one in tenths of one", () => {
      assert.equal(compare.shown(300 * 1048576, "By"), "300 MiB");
      assert.equal(compare.shown(1_500_000, "By"), "1.4 MiB");
    });
  });

  describe("given a process whose clock is pinned", () => {
    it("gives every date and id asked of it the same instant and the next number, and a date it is given as it was", async () => {
      const unpin = pinClock();
      try {
        const asked = performance.now();
        await sleep(20);
        assert.equal(new Date().toISOString(), PINNED);
        assert.equal(Date.now(), Date.parse(PINNED));
        assert.equal(new Date(Date.now()).toISOString(), PINNED);
        assert.equal(new Date().getTime(), Date.parse(PINNED));
        assert.equal(new Date(0).toISOString(), "1970-01-01T00:00:00.000Z");
        assert.equal(Date.parse("2020-01-01T00:00:00Z"), 1577836800000);
        assert.equal(new Date() instanceof Date, true);
        assert.equal(typeof Date(), "string");
        assert.ok(performance.now() - asked >= 15, "durations still run");
        const first = crypto.randomUUID();
        assert.match(
          first,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        assert.notEqual(crypto.randomUUID(), first);
        unpin();
        const again = pinClock();
        assert.equal(crypto.randomUUID(), first, "the numbering starts again");
        again();
      } finally {
        unpin();
      }
    });

    it("gives two jobs ids that differ and a later job a later time, and the same job the same ids and time again", () => {
      const drawn = (pin: Parameters<typeof pinClock>[0]) => {
        const unpin = pinClock(pin);
        try {
          return {
            ids: [crypto.randomUUID(), crypto.randomUUID()],
            at: Date.now(),
          };
        } finally {
          unpin();
        }
      };
      const job = { scenario: "fresh", dataset: "x", encrypted: false };
      const first = drawn(pinOf({ ...job, label: "import", n: 0 }));
      const later = drawn(pinOf({ ...job, label: "a later pull", n: 1 }));
      const alike = drawn(pinOf({ ...job, label: "import", n: 0 }));
      assert.deepEqual(alike, first, "the same job repeats");
      for (const id of later.ids) assert.ok(!first.ids.includes(id));
      assert.ok(later.at > first.at, "the later job is later");
      assert.equal(first.at, pinnedAt(0));
      assert.equal(first.at, Date.parse(PINNED));
      const elsewhere = drawn(
        pinOf({ ...job, label: "import", scenario: "reopen" }),
      );
      for (const id of elsewhere.ids) assert.ok(!first.ids.includes(id));
    });

    it("puts the real clock and the real ids back", async () => {
      pinClock()();
      const before = Date.now();
      await sleep(5);
      assert.ok(Date.now() > before);
      assert.notEqual(crypto.randomUUID(), crypto.randomUUID());
      assert.notEqual(new Date().toISOString(), PINNED);
    });

    it("writes the same pod from the same record on two runs, which a clock left running does not", async () => {
      const claimProfiles = await profileOf("first");
      const folder = await mkdtemp(join(tmpdir(), "pinned-"));
      scratch.push(folder);
      const imported = async (name: string) => {
        const pod = await openedAt(join(folder, name, "pod"), false);
        await pod.import(syntheticPull(20), { claimProfiles });
        await pod.close();
        return folderFingerprint(join(folder, name, "pod"));
      };
      const unpin = pinClock();
      let a, b;
      try {
        a = await imported("pinned-1");
        unpin();
        const unpinAgain = pinClock();
        b = await imported("pinned-2");
        unpinAgain();
      } finally {
        unpin();
      }
      assert.ok(a.files > 20, "files written");
      assert.deepEqual(a, b);
      const running = await imported("running-1");
      assert.notEqual(running.sha256, (await imported("running-2")).sha256);
    });

    it("has the fingerprint of a folder tell two statements apart, and not two labels of one blank node", async () => {
      const folder = await mkdtemp(join(tmpdir(), "fingerprint-"));
      scratch.push(folder);
      const holding = async (name: string, text: string) => {
        await mkdir(join(folder, name), { recursive: true });
        await writeFile(join(folder, name, "judgment.ttl"), text);
        return (await folderFingerprint(join(folder, name))).sha256;
      };
      const was = (label: string, object: string) =>
        `<urn:a> <urn:was> _:${label} .\n_:${label} <urn:is> ${object} .\n`;
      const one = await holding(
        "one",
        was("b54691f5b548c1716b41a26b585b05b1", "<urn:x>"),
      );
      assert.equal(
        await holding("two", was("edf3f236a17f1520697b3359340125f", "<urn:x>")),
        one,
        "another label",
      );
      assert.notEqual(
        await holding(
          "three",
          was("b54691f5b548c1716b41a26b585b05b1", "<urn:y>"),
        ),
        one,
        "another statement",
      );
      // The store sorts a file's lines, and a label decides where its lines fall.
      const before = `_:${"0".repeat(32)} <urn:is> <urn:x> .\n<urn:a> <urn:was> _:${"0".repeat(32)} .\n`;
      const after = `<urn:a> <urn:was> _:${"f".repeat(32)} .\n_:${"f".repeat(32)} <urn:is> <urn:x> .\n`;
      assert.equal(
        await holding("four", after),
        await holding("five", before),
        "lines in another order because of another label",
      );
    });
  });

  describe("given a pod holding a small pull, imported and read with the probe on", () => {
    let spans: string[];
    const seenRuns: Seen[] = [];

    before(async () => {
      const claimProfiles = await profileOf("first");
      const pod = await openPod();
      try {
        const { seen } = await probing(
          async () => {
            await pod.import(syntheticPull(20), { claimProfiles });
            await pod.ask(FIRST_SCREEN[8] as string);
            await pod.askPage(PAGES[0] as string, { size: 5 });
          },
          { trace: true },
        );
        spans = [...seen.spans.keys()];
        seenRuns.push(seen);
      } finally {
        seenRuns.push((await probing(() => pod.close(), { trace: true })).seen);
      }
    });

    it("records the Bridge's own stages as bridge.* spans", () => {
      assert.ok(
        spans.some((name) => name.startsWith("bridge.stage:")),
        spans.join(", "),
      );
    });

    it("records each named question and each page of one as a span", () => {
      assert.ok(spans.includes(`question:${FIRST_SCREEN[8]}`));
      assert.ok(spans.includes(`question.page:${PAGES[0]}`));
    });

    it("draws the Bridge's stages on a track of their own, as children of the convert that waited for them", () => {
      const [imported] = seenRuns.map(({ events }) => events ?? []);
      const parentOf = (events: readonly SpanEvent[], prefix: string) => {
        const found = events.find(({ name }) => name.startsWith(prefix));
        assert.ok(found !== undefined, prefix);
        return {
          track: found.track,
          parent: events[found.parent]?.name,
        };
      };
      assert.deepEqual(parentOf(imported as SpanEvent[], "bridge.stage:"), {
        track: "Bridge stages",
        parent: "arrivals.convert",
      });
    });

    it("has a plain sentence for every stage, own time and count the probe saw, in a row of the performance file", () => {
      const rows = seenRuns.flatMap((seen) =>
        probedRows("fresh-first-screen-synthea-10y", tabulated(seen), 100_000),
      );
      assert.ok(rows.length > 20);
      assert.ok(rows.some(({ name }) => name.includes("/self/")));
      assert.deepEqual(
        rows
          .filter(({ name }) => explain(name) === undefined)
          .map(({ name }) => name),
        [],
      );
    });
  });

  describe("given a performance file for the history page", () => {
    const row = (
      name: string,
      value: number,
      unit: Row["unit"] = "s",
    ): Row => ({
      name,
      unit,
      value,
      kind: name.includes("/count/") ? "cost" : "clock",
      extra: "meaning",
    });
    const kept = history.forHistory(
      file([
        row("close-synthea-10y/total", 2),
        row("close-synthea-10y/rss", 5, "By"),
        row("close-synthea-10y/peak-rss", 9, "By"),
        row("close-synthea-10y/count/records", 647, "{count}"),
        row("close-synthea-10y/stage/a", 1),
        row("close-synthea-10y/stage/b", 3),
        row("close-synthea-10y/stage/c", 2),
        row("close-synthea-10y/stage/scenario.close", 9),
      ]),
      { stages: 2 },
    );

    it("takes the headline times, the peak memory and each run's slowest stages, with their meanings, and no count", () => {
      assert.deepEqual(
        kept.map(({ name }) => name),
        [
          "close-synthea-10y/total",
          "close-synthea-10y/peak-rss",
          "close-synthea-10y/stage/b",
          "close-synthea-10y/stage/c",
        ],
      );
      assert.ok(kept.every(({ extra }) => extra === "meaning"));
    });
  });

  describe("given a record to load as plainly as SQL can", () => {
    const entry = (resource: object) => ({ resource });
    const gz = async (bundle: object): Promise<string> => {
      const dir = await mkdtemp(join(tmpdir(), "perf-floor-test-"));
      scratch.push(dir);
      const path = join(dir, "bundle.json.gz");
      await writeFile(path, gzipSync(JSON.stringify(bundle)));
      return path;
    };
    const sqlite = (path: string) => {
      const Database = createRequire(import.meta.url)(
        "better-sqlite3-multiple-ciphers",
      ) as new (file: string) => {
        prepare(sql: string): { all(): Record<string, unknown>[] };
        close(): void;
      };
      return new Database(path);
    };

    it("flattens each resource into one row of the table of its type, a scalar as a column and anything nested as JSON text", () => {
      const tables = flatten([
        entry({
          resourceType: "Patient",
          id: "p1",
          active: true,
          name: [{ family: "A" }],
        }),
        entry({
          resourceType: "Observation",
          id: "o1",
          status: "final",
          valueQuantity: { value: 3 },
        }),
        entry({ resourceType: "Patient", id: "p2", gender: "female" }),
        {},
      ]);
      assert.deepEqual([...tables.keys()].sort(), ["Observation", "Patient"]);
      const patient = tables.get("Patient");
      assert.deepEqual(patient?.columns, ["id", "active", "name", "gender"]);
      assert.deepEqual(patient?.rows, [
        ["p1", 1, '[{"family":"A"}]', null],
        ["p2", null, null, "female"],
      ]);
      assert.deepEqual(tables.get("Observation")?.rows, [
        ["o1", "final", '{"value":3}'],
      ]);
    });

    it("puts two fields of one type that differ only in case in separate columns, which SQLite would refuse as one name twice", async () => {
      const tables = flatten([
        entry({ resourceType: "Patient", id: "p1", Value: 1, value: 2 }),
        entry({ resourceType: "Patient", id: "p2", VALUE: 3 }),
      ]);
      assert.deepEqual(tables.get("Patient")?.columns, [
        "id",
        "Value",
        "value_2",
        "VALUE_3",
      ]);
      assert.deepEqual(tables.get("Patient")?.rows, [
        ["p1", 1, 2, null],
        ["p2", null, null, 3],
      ]);
      const path = await gz({
        resourceType: "Bundle",
        entry: [
          entry({ resourceType: "Patient", id: "p1", Value: 1, value: 2 }),
        ],
      });
      const database = join(dirname(path), "floor.db");
      assert.equal((await loadPlainly(path, database)).rows, 1);
    });

    it("reads, parses, flattens and inserts a gzipped Bundle in one transaction, and says what each stage took and how many rows went in", async () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          entry({ resourceType: "Patient", id: "p1", name: [{ family: "A" }] }),
          entry({ resourceType: "Observation", id: "o1", status: "final" }),
          entry({ resourceType: "Observation", id: "o2", status: "amended" }),
        ],
      };
      const path = await gz(bundle);
      const database = join(dirname(path), "floor.db");
      const loaded = await loadPlainly(path, database);
      assert.equal(loaded.rows, 3);
      assert.equal(loaded.records, 3);
      assert.equal(loaded.tables, 2);
      for (const stage of [loaded.parse, loaded.flatten, loaded.insert])
        assert.ok(Number.isFinite(stage) && stage >= 0);
      assert.equal(
        loaded.sha256,
        createHash("sha256").update(JSON.stringify(bundle)).digest("hex"),
      );
      const opened = sqlite(database);
      try {
        assert.deepEqual(
          opened
            .prepare(`select id, status from "Observation" order by id`)
            .all(),
          [
            { id: "o1", status: "final" },
            { id: "o2", status: "amended" },
          ],
        );
        assert.deepEqual(opened.prepare(`select name from "Patient"`).all(), [
          { name: '[{"family":"A"}]' },
        ]);
      } finally {
        opened.close();
      }
    });

    it("loads a Bundle with no entry as an empty load, and one whose entries hold no resource as none inserted", async () => {
      const first = await gz({ resourceType: "Bundle", entry: [] });
      const empty = await loadPlainly(first, join(dirname(first), "floor.db"));
      assert.deepEqual([empty.rows, empty.tables], [0, 0]);
      const bare = await gz({ resourceType: "Bundle", entry: [{}, {}] });
      const none = await loadPlainly(bare, join(dirname(bare), "floor.db"));
      assert.deepEqual([none.rows, none.records], [0, 2]);
    });

    it("writes the floor's rows under floor-<size>: the median of each stage and their total, and the rows loaded", () => {
      const run = (parse: number, flat: number, insert: number) => ({
        parse,
        flatten: flat,
        insert,
        rows: 647,
        records: 647,
        tables: 9,
        sha256: "f".repeat(64),
      });
      const rows = floorRows("synthea-10y", "dataset=synthea-10y records=647", [
        run(0.1, 0.2, 0.3),
        run(0.2, 0.2, 0.5),
        run(0.3, 0.3, 0.4),
      ]);
      const by = (name: string) =>
        rows.find((each) => each.name === `floor-synthea-10y/${name}`);
      assert.equal(by("parse")?.value, 0.2);
      assert.equal(by("flatten")?.value, 0.2);
      assert.equal(by("insert")?.value, 0.4);
      assert.equal(by("total")?.value, 0.9);
      assert.equal(by("total")?.samples, 3);
      assert.equal(by("rss"), undefined);
      const held = floorRows(
        "synthea-10y",
        "dataset=synthea-10y",
        [run(0.1, 0.2, 0.3), run(0.2, 0.2, 0.5), run(0.3, 0.3, 0.4)],
        { rss: [3, 1, 2], peak: [9, 7, 8] },
      );
      const heldBy = (name: string) =>
        held.find((each) => each.name === `floor-synthea-10y/${name}`);
      assert.equal(heldBy("rss")?.value, 2);
      assert.equal(heldBy("peak-rss")?.value, 8);
      assert.deepEqual(
        held.filter(({ name }) => explain(name) === undefined),
        [],
      );
      assert.equal(by("count/rows")?.value, 647);
      assert.equal(by("count/rows")?.kind, "cost");
      assert.deepEqual(
        rows.filter((each) => refused(each) !== undefined),
        [],
      );
      assert.deepEqual(
        rows.filter(({ name }) => explain(name) === undefined),
        [],
      );
    });

    it("is a scenario a run can name on its own, and one the glossary says plainly does no mapping, provenance, matching, views or files", () => {
      assert.ok((SCENARIOS as readonly string[]).includes("floor"));
      const says = explain("floor-synthea-10y/total") ?? "";
      for (const left of [
        "no mapping to the Cascade vocabulary",
        "no provenance",
        "no matching",
        "no derived views",
        "no files",
      ])
        assert.ok(says.includes(left), left);
    });
  });

  describe("given a fresh import and the plain load of the same input in one file", () => {
    const row = (
      name: string,
      value: number,
      unit: Row["unit"] = "s",
    ): Row => ({
      name,
      unit,
      value,
      kind: unit === "{count}" ? "cost" : "clock",
      ...(unit !== "{count}" && { samples: 3, range: `${value}-${value}` }),
    });
    const KEY = "fresh-first-screen-synthea-lifetime";
    const rows = [
      row(`${KEY}/import`, 42.3),
      row(`${KEY}/total`, 50),
      row(`${KEY}/phase-converting`, 15.7),
      row(`${KEY}/phase-saving`, 6.7),
      row(`${KEY}/phase-judging`, 10),
      row(`${KEY}/count/records`, 16833, "{count}"),
      row(`${KEY}/count/built.lines.total`, 294000, "{count}"),
      row(`${KEY}/count/files-written`, 27223, "{count}"),
      row(`${KEY}/count/store.queries`, 365, "{count}"),
      row(`${KEY}/count/graph.quadsvisited`, 1300000, "{count}"),
      row("floor-synthea-lifetime/total", 2.1),
      row("floor-synthea-lifetime/parse", 0.6),
      row("floor-synthea-lifetime/flatten", 0.4),
      row("floor-synthea-lifetime/insert", 1.1),
      row("floor-synthea-lifetime/count/rows", 16833, "{count}"),
    ];
    const near = (found: number | undefined, wanted: number) =>
      assert.ok(Math.abs((found ?? NaN) - wanted) < 1e-6, `${found}`);

    it("reads the import, the floor, how many times as long, what the run handled and each phase's rates from the rows", () => {
      const speed = compare.speedOf(file(rows), KEY);
      assert.equal(speed?.imported, 42.3);
      assert.equal(speed?.floor?.total, 2.1);
      near(speed?.times, 42.3 / 2.1);
      assert.deepEqual(
        [
          speed?.records,
          speed?.lines,
          speed?.files,
          speed?.queries,
          speed?.facts,
        ],
        [16833, 294000, 27223, 365, 1300000],
      );
      near(speed?.rates.saving.lines, 294000 / 6.7);
      near(speed?.rates.saving.files, 27223 / 6.7);
      assert.deepEqual(Object.keys(speed?.rates ?? {}), ["saving"]);
      assert.equal(compare.speedOf(file(rows), "close-synthea-10y"), undefined);
    });

    it("says it in one line, and has no line for a file with no floor", () => {
      assert.equal(
        compare.floorLine(compare.speedOf(file(rows), KEY)),
        "Import takes 42.3 s; a plain load of the same input into SQLite takes 2.10 s (20x).",
      );
      const without = file(
        rows.filter(({ name }) => !name.startsWith("floor-")),
      );
      assert.equal(compare.floorLine(compare.speedOf(without, KEY)), undefined);
      assert.ok(compare.speedOf(without, KEY));
    });

    it("shows the line, a throughput table and a plain caption in a summary and in a comparison, and nothing for a file with no import", () => {
      const text = compare.summary(file(rows), { markdown: true });
      assert.match(
        text,
        /Import takes 42\.3 s; a plain load of the same input into SQLite takes 2\.10 s \(20x\)/,
      );
      assert.match(
        text,
        /\| Source entries \| Answer-file lines \| Files written \| Questions put to the fact store \| Individual facts looked at \| Saving: answer-file lines\/s \| Saving: files\/s \|/,
      );
      assert.match(
        text,
        /\| 16,833 \| 294,000 \| 27,223 \| 365 \| 1,300,000 \|/,
      );
      assert.match(text, /43,881/);
      assert.match(text, /maps nothing to the Cascade vocabulary/);
      assert.match(text, /not a lower bound/);
      assert.match(
        text,
        /encrypted import is compared with the same unencrypted/,
      );
      assert.doesNotMatch(text, /Converting: |Judging: |Quads|Statements/);
      const compared = compare.compare(file(rows), file(rows), {
        markdown: true,
      });
      assert.match(compared, /Import takes 42\.3 s/);
      assert.doesNotMatch(
        compare.summary(file([row("close-synthea-10y/total", 1)])),
        /Import takes/,
      );
    });

    it("keeps the floor's stages for the history page beside the headline times, and no count", () => {
      const kept = history
        .forHistory(file(rows))
        .map(({ name }) => name)
        .filter((name) => name.startsWith("floor-"));
      const other = history
        .forHistory(
          file([
            row("scenario-x/parse", 1),
            row("scenario-x/insert", 1),
            ...rows,
          ]),
        )
        .map(({ name }) => name);
      assert.ok(!other.some((name) => name.startsWith("scenario-x/")));
      assert.deepEqual(kept, [
        "floor-synthea-lifetime/total",
        "floor-synthea-lifetime/parse",
        "floor-synthea-lifetime/flatten",
        "floor-synthea-lifetime/insert",
      ]);
    });
  });

  describe("given the glossary", () => {
    it("explains every scenario, size, headline measurement and phase row of the file", () => {
      for (const name of [
        "floor-synthea-10y/total",
        "floor-synthea-lifetime/parse",
        "floor-synthea-10y/flatten",
        "floor-synthea-10y/insert",
        "floor-synthea-10y/count/rows",
        "fresh-first-screen-synthea-10y/total",
        "fresh-first-screen-synthea-lifetime-encrypted/import",
        "fresh-first-screen-synthea-10y/phase-converting",
        "fresh-first-screen-synthea-10y/count/records",
        "fresh-first-screen-synthea-10y/count/files-written",
        "reopen-first-answer-synthea-10y/second-read",
        "question-page-synthea-10y/total",
        "question-page-synthea-10y/question-pod-my-lab-results",
        "close-synthea-10y/total",
        "close-synthea-10y/stage/core-pod.keepdatabase",
        "close-synthea-10y/peak-rss",
        "close-synthea-10y/probed-total",
      ])
        assert.ok(explain(name), name);
    });

    it("says a span sits inside the step it sits inside in the row's scenario, and nowhere for a scenario where it sits at the top", () => {
      const own = (scenario: string, span: string) =>
        explain(`${scenario}-synthea-10y/self/${span}`) ?? "";
      assert.match(
        own("fresh-first-screen", "question-pod-my-lab-results"),
        /Sits inside scenario\.first-screen\. \|/,
      );
      assert.match(
        own("reopen-first-answer", "question-pod-my-lab-results"),
        /Sits inside scenario\.first-read or scenario\.second-read\. \|/,
      );
      assert.doesNotMatch(
        own("question-page", "question.page-pod-my-lab-results"),
        /Sits inside/,
      );
    });

    it("is the page docs/perf-glossary.md lists, word for word", async () => {
      const { readFile } = await import("node:fs/promises");
      const page = await readFile(
        new URL("../../../../docs/perf-glossary.md", import.meta.url),
        "utf8",
      );
      assert.equal(
        page,
        glossaryMarkdown(),
        "regenerate: node packages/cascade-runtime/dist/test/perf-glossary.js > docs/perf-glossary.md",
      );
    });
  });

  describe("given the glossary as the files of a folder, one for each scenario", () => {
    it("has a file named for each scenario that holds that scenario's sentence, and the sentences of no other", async () => {
      const { readdir } = await import("node:fs/promises");
      const folder = new URL("../../test/perf-glossary/", import.meta.url);
      const files = (await readdir(folder)).filter((each) =>
        each.endsWith(".json"),
      );
      for (const scenario of SCENARIOS) {
        const own = files.filter((each) => each.endsWith(`-${scenario}.json`));
        assert.equal(own.length, 1, `the file of ${scenario}`);
        const fragment = JSON.parse(
          await readFile(new URL(own[0] as string, folder), "utf8"),
        ) as { scenarios?: Record<string, unknown> };
        assert.deepEqual(Object.keys(fragment.scenarios ?? {}), [scenario]);
      }
    });

    it("is read the same by the runtime's test code and by the page scripts", () => {
      assert.deepEqual(stacked.readGlossary(), readGlossary());
    });

    it("joins the files in the order of their names, and refuses a key or a text that two of them give", async () => {
      const folder = await mkdtemp(join(tmpdir(), "glossary-"));
      try {
        const given = (file: string, body: object) =>
          writeFile(join(folder, file), JSON.stringify(body));
        await given("10-b.json", {
          about: "a",
          measures: { y: "b" },
          families: [{ says: "second" }],
        });
        await given("05-a.json", {
          measures: { x: "a" },
          families: [{ says: "first" }],
        });
        const merged = readGlossary(pathToFileURL(`${folder}/`)) as unknown as {
          measures: object;
          families: { says: string }[];
        };
        assert.deepEqual(Object.keys(merged.measures), ["x", "y"]);
        assert.deepEqual(
          merged.families.map(({ says }) => says),
          ["first", "second"],
        );
        await given("20-c.json", { measures: { x: "again" } });
        assert.throws(
          () => readGlossary(pathToFileURL(`${folder}/`)),
          /20-c\.json gives measures\.x/,
        );
        await rm(join(folder, "20-c.json"));
        await given("20-e.json", { families: [{ says: "first" }] });
        const listedTwice = /20-e\.json lists .*"first".* in families/;
        assert.throws(
          () => readGlossary(pathToFileURL(`${folder}/`)),
          listedTwice,
        );
        assert.throws(
          () => stacked.readGlossary(`${folder}/`),
          listedTwice,
          "the page script too",
        );
        await rm(join(folder, "20-e.json"));
        await given("20-f.json", {
          families: [{ says: "within" }, { says: "within" }],
        });
        assert.throws(
          () => readGlossary(pathToFileURL(`${folder}/`)),
          /20-f\.json lists .*"within".* in families/,
          "twice in one file",
        );
        await rm(join(folder, "20-f.json"));
        await given("20-d.json", { about: "twice" });
        assert.throws(
          () => readGlossary(pathToFileURL(`${folder}/`)),
          /20-d\.json gives about/,
        );
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  });

  describe("given calls of one span that overlap, as the sealing of every file of an import does", () => {
    it("takes the time some call was in progress as the span's wall time, and each call's own time into the sum", async () => {
      const { seen } = await probing(async () => {
        await Promise.all([
          timed("seal", () => sleep(80)),
          timed("seal", () => sleep(80)),
        ]);
        await timed("seal", () => sleep(40));
      });
      const seal = seen.spans.get("seal");
      assert.equal(seal?.calls, 3);
      // 80 + 80 + 40 summed, 80 + 40 in progress.
      assert.ok((seal?.ms ?? 0) >= 190, `ms ${seal?.ms}`);
      assert.ok((seal?.wallMs ?? 0) >= 115, `wallMs ${seal?.wallMs}`);
      assert.ok(
        (seal?.ms ?? 0) - (seal?.wallMs ?? 0) >= 40,
        `ms ${seal?.ms} wallMs ${seal?.wallMs}`,
      );
    });

    it("keeps the wall time of a span that never overlaps equal to its sum", async () => {
      const { seen } = await probing(async () => {
        await timed("one-at-a-time", () => sleep(30));
        await timed("one-at-a-time", () => sleep(30));
      });
      const span = seen.spans.get("one-at-a-time");
      assert.ok(
        Math.abs((span?.ms ?? 0) - (span?.wallMs ?? 0)) < 5,
        `ms ${span?.ms} wallMs ${span?.wallMs}`,
      );
    });

    it("takes a span measured elsewhere as its own wall time", async () => {
      const { seen } = await probing(async () => {
        recorded("in-a-worker", 30, 2);
      });
      assert.deepEqual(seen.spans.get("in-a-worker"), {
        calls: 2,
        ms: 30,
        wallMs: 30,
      });
    });

    it("writes the stage row with the wall time as its value and the summed time, with its calls, in what it says", () => {
      const [row] = probedRows("close-x", {
        spans: [
          { name: "files.encrypt", calls: 27253, ms: 46649000, wallMs: 540 },
        ],
        counts: {},
      });
      assert.equal(row?.name, "close-x/stage/files.encrypt");
      assert.equal(row?.value, 0.54);
      assert.match(row?.extra ?? "", /27253 calls/);
      assert.match(row?.extra ?? "", /46649\.000000 s/);
    });
  });

  describe("given a time under a millisecond, as a question answered from the database takes", () => {
    it("keeps it to the microsecond in the row, and shows it in microseconds", () => {
      const row = clockRow("x-y/question-z", "s", [0.0004, 0.0006, 0.0005], "");
      assert.deepEqual([row.value, row.range], [0.0005, "0.000400-0.000600"]);
      const text = compare.compare(
        file([row]),
        file([{ ...row, value: 0.0003, range: "0.000300-0.000300" }]),
      );
      assert.match(text, /500 us\s+300 us\s+-40%/);
    });
  });

  describe("given two files from one kind of hosted runner, taken by different jobs and on a newer kernel", () => {
    const hosted = (os: string, model: string) => ({
      ...file([]),
      env: {
        os,
        runner: `github-actions Linux; ${model}; other load: a shared hosted runner`,
        cpus: 4,
        node: "24.1.0",
      },
    });

    it("says nothing of the machines", () => {
      const text = compare.compare(
        hosted("linux 6.8.0-1017-azure", "AMD EPYC 7763"),
        hosted("linux 6.8.0-1018-azure", "AMD EPYC 7763"),
      );
      assert.doesNotMatch(text, /do not compare/);
    });

    it("says that a different processor model is a different machine", () => {
      const text = compare.compare(
        hosted("linux 6.8.0-1017-azure", "AMD EPYC 7763"),
        hosted("linux 6.8.0-1017-azure", "Intel Xeon 8370C"),
      );
      assert.match(text, /different cpu model/);
    });

    it("names no job in the environment the harness writes", () => {
      const keys = ["GITHUB_ACTIONS", "RUNNER_OS", "RUNNER_NAME"];
      const was = keys.map((key) => process.env[key]);
      process.env.GITHUB_ACTIONS = "true";
      process.env.RUNNER_OS = "Linux";
      process.env.RUNNER_NAME = "GitHub Actions 1000000312";
      try {
        const { runner } = envOf({
          scenarios: new Set(SCENARIOS),
          sizes: ["synthea-10y"],
          encryption: "auto",
          repeats: 3,
          probe: true,
        });
        assert.doesNotMatch(runner, /1000000312/);
        assert.match(runner, /^github-actions Linux;/);
      } finally {
        keys.forEach((key, at) => {
          const value = was[at];
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        });
      }
    });
  });

  describe("given main's file and a pull request's file, both taken in one job", () => {
    const EPYC = "AMD EPYC 9V74 80-Core Processor";
    const total = (seconds: number): Row[] => [
      {
        name: "fresh-first-screen-x/total",
        unit: "s",
        value: seconds,
        kind: "clock",
        samples: 3,
        range: `${seconds - 1}-${seconds + 1}`,
      },
      {
        name: "fresh-first-screen-x/import",
        unit: "s",
        value: seconds - 2,
        kind: "clock",
        samples: 3,
        range: `${seconds - 3}-${seconds - 1}`,
      },
    ];
    const taken = (
      cpu: string | undefined,
      seconds: number,
      commit: Record<string, string>,
    ) => ({
      env: {
        os: "linux 6.8.0-1017-azure",
        runner: `github-actions Linux;${cpu === undefined ? "" : ` ${cpu};`} other load: a shared hosted runner`,
        cpus: 4,
        node: "24.1.0",
      },
      commit,
      results: total(seconds),
    });
    const sha = (digit: string) => digit.repeat(40);
    const main = taken(EPYC, 10, { runtime: sha("a"), bridge: sha("b") });
    const pull = taken(EPYC, 16, { runtime: sha("c"), bridge: sha("b") });

    it("heads its table with main and this pull request, and gives the change in percent and the multiple", () => {
      const text = compare.comparison(pull, { sameJob: main });
      assert.match(text, /main\s+this pull request\s+change/);
      assert.match(
        text,
        /fresh-first-screen-x\/total\s+10\.0 s\s+16\.0 s\s+\+60% \(1\.6x slower\)/,
      );
      assert.doesNotMatch(text, /before\s+after\s+change/);
    });

    it("says in a sentence for each scenario what main took and what this pull request took", () => {
      const text = compare.comparison(pull, { sameJob: main });
      assert.match(
        text,
        /fresh-first-screen-x: main 10\.0 s, this pull request 16\.0 s: \+60% \(1\.6x slower\)/,
      );
    });

    it("says that the two were measured in one job on one runner, and names the processor once", () => {
      const text = compare.comparison(pull, { sameJob: main });
      assert.match(text, /same job/);
      assert.match(text, /both on AMD EPYC 9V74 80-Core Processor/);
      assert.doesNotMatch(text, /not comparable/);
    });

    it("says that both read the Bridge build when it is the same one", () => {
      const text = compare.comparison(pull, { sameJob: main });
      assert.match(text, /Both runs read the Bridge build bbbbbbb/);
    });

    it("says that the two read different Bridge builds when they differ, how the build picked its own, and that the headline change includes the Bridge's", () => {
      const own = taken(EPYC, 16, { runtime: sha("c"), bridge: sha("d") });
      const text = compare.comparison(own, {
        sameJob: main,
        bridgeHow: "the head of o/r/pull/5, named on a Depends-On: line",
      });
      assert.match(text, /main's run read bbbbbbb/);
      assert.match(text, /this pull request's read ddddddd/);
      assert.match(
        text,
        /picked its Bridge as the head of o\/r\/pull\/5, named on a Depends-On: line/,
      );
      const headline = text.split(/headline/i)[1] ?? "";
      assert.match(
        headline,
        /The two sides read different Bridge builds, so the change below includes the Bridge's/,
      );
    });

    it("blames no Depends-On when the file does not say how the Bridge was picked", () => {
      const own = taken(EPYC, 16, { runtime: sha("c"), bridge: sha("d") });
      const text = compare.comparison(own, { sameJob: main });
      assert.match(text, /the file does not record why/);
      assert.doesNotMatch(text, /Depends-On: line\)/);
    });

    it("says nothing of the Bridge in the headline when both read the same one", () => {
      const text = compare.comparison(pull, { sameJob: main });
      assert.doesNotMatch(text, /includes the Bridge's/);
    });

    it("calls the file this build, not this pull request, in a run that has no pull request", () => {
      const text = compare.comparison(pull, {
        sameJob: main,
        subject: "this build",
      });
      assert.doesNotMatch(text, /pull request/);
      assert.match(text, /main\s+this build\s+change/);
      assert.match(text, /main 10\.0 s, this build 16\.0 s/);
    });

    it("names the other components whose commits differ between the two", () => {
      const other = taken(EPYC, 16, {
        runtime: sha("c"),
        bridge: sha("b"),
        vocabulary: sha("e"),
      });
      const base = taken(EPYC, 10, {
        runtime: sha("a"),
        bridge: sha("b"),
        vocabulary: sha("f"),
      });
      const text = compare.comparison(other, { sameJob: base });
      assert.match(
        text,
        /They differ in: vocabulary: main fffffff, this pull request eeeeeee/,
      );
      assert.match(text, /as a push to main does/);
    });

    it("says in plain words that totals are not comparable when the two runs landed on different CPUs, and still gives the table", () => {
      const slower = taken("AMD EPYC 7763 64-Core Processor", 16, {
        runtime: sha("c"),
        bridge: sha("b"),
      });
      const text = compare.comparison(slower, { sameJob: main });
      assert.match(
        text,
        /The two runs landed on different CPUs; totals are not comparable\./,
      );
      assert.match(text, /AMD EPYC 9V74/);
      assert.match(text, /AMD EPYC 7763/);
      assert.match(text, /fresh-first-screen-x\/total\s+10\.0 s\s+16\.0 s/);
    });

    it("does not say that two runs are on one CPU when a file records none", () => {
      const unknown = taken(undefined, 16, {
        runtime: sha("c"),
        bridge: sha("b"),
      });
      const text = compare.comparison(unknown, { sameJob: main });
      assert.match(text, /records no CPU model/);
      assert.doesNotMatch(text, /both on/);
    });

    it("reads a CPU model from the runner a file names, and none from a file that names none", () => {
      assert.equal(compare.cpuModelOf(main), EPYC);
      assert.equal(compare.cpuModelOf(taken(undefined, 1, {})), undefined);
      assert.equal(compare.cpuModelOf({ results: [] }), undefined);
    });
  });

  describe("given a pull request whose job could not measure main", () => {
    const row = (value: number): Row[] => [
      {
        name: "fresh-first-screen-x/total",
        unit: "s",
        value,
        kind: "clock",
        samples: 3,
        range: `${value}-${value}`,
      },
    ];
    const pull = file(row(10));
    const latest = file(row(40));
    let folder = "";
    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "perf-main-"));
      scratch.push(folder);
      await writeFile(join(folder, "pr.json"), JSON.stringify(pull));
      await writeFile(join(folder, "latest.json"), JSON.stringify(latest));
      await writeFile(join(folder, "broken.json"), '{"results": [');
    });
    const against = async (...args: string[]) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../../../scripts/perf-compare.mjs", import.meta.url),
          ),
          "against",
          join(folder, "pr.json"),
          "--markdown",
          ...args,
        ],
        { encoding: "utf8" },
      );
      return stdout;
    };

    it("compares with the latest push to main instead, says that main's own run did not give a file, and says that it was taken on another run", () => {
      const text = compare.comparison(pull, {
        latest,
        latestName: "runtime/2026/11/20/1-aaaaaaa-push.json",
        sameJob: null,
        markdown: true,
      });
      assert.match(text, /Main's own run in this job did not give a file/);
      assert.match(
        text,
        /Against `runtime\/2026\/11\/20\/1-aaaaaaa-push\.json`/,
      );
      assert.match(text, /another machine/);
      assert.match(
        text,
        /\| fresh-first-screen-x\/total \| 40\.0 s \| 10\.0 s \|/,
      );
      assert.doesNotMatch(text, /this pull request \|/);
    });

    it("gives this pull request's own file alone when there is no file of main's at all, saying once that there is none", () => {
      const text = compare.comparison(pull, { sameJob: null });
      assert.match(
        text,
        /Main's own run in this job gave no file .*and there is no other file of main's to compare with/,
      );
      assert.doesNotMatch(text, /did not give a file|main has no performance/);
      assert.match(text, /fresh-first-screen-x\/total/);
    });

    it("does not print the pull request's summary again when the caller has put it on the page already", async () => {
      const text = compare.comparison(pull, {
        sameJob: null,
        summaryShown: true,
      });
      assert.doesNotMatch(text, /fresh-first-screen-x\/total/);
      const run = await against(
        "--same-job",
        join(folder, "missing.json"),
        "--summary-shown",
      );
      assert.match(run, /there is no other file of main's/);
      assert.doesNotMatch(run, /fresh-first-screen-x\/total/);
    });

    it("exits 0 and falls back when the file of main's run is missing", async () => {
      const text = await against(
        "--same-job",
        join(folder, "missing.json"),
        "--latest",
        join(folder, "latest.json"),
        "--latest-name",
        "runtime/latest.json",
      );
      assert.match(text, /did not give a file/);
      assert.match(text, /Against `runtime\/latest\.json`/);
    });

    it("exits 0 and falls back when the file of main's run is not a performance file", async () => {
      const text = await against(
        "--same-job",
        join(folder, "broken.json"),
        "--latest",
        join(folder, "latest.json"),
        "--latest-name",
        "runtime/latest.json",
      );
      assert.match(text, /did not give a file/);
      assert.match(text, /Against `runtime\/latest\.json`/);
    });

    it("uses main's file from the same job when it is there, and the latest push's only to say nothing of it", async () => {
      const text = await against(
        "--same-job",
        join(folder, "latest.json"),
        "--latest",
        join(folder, "latest.json"),
        "--latest-name",
        "runtime/latest.json",
      );
      assert.match(text, /same job/);
      assert.doesNotMatch(text, /Against `/);
    });
  });

  describe("given a file with sizes that the one it is compared with did not run", () => {
    const row = (name: string, value: number): Row => ({
      name,
      unit: "s",
      value,
      kind: "clock",
      samples: 1,
      range: `${value}-${value}`,
    });

    it("compares the sizes both ran and leaves out the rest, saying which", () => {
      const text = compare.compare(
        file([
          row("fresh-first-screen-small/total", 10),
          row("fresh-first-screen-large/total", 100),
        ]),
        file([row("fresh-first-screen-small/total", 5)]),
      );
      assert.match(text, /fresh-first-screen-small\/total\s+10\.0 s\s+5\.00 s/);
      assert.doesNotMatch(text, /gone/);
      assert.match(text, /Not compared.*fresh-first-screen-large/);
    });

    it("lists a probed total with the stages of its run, not among the unprobed headline rows", () => {
      const text = compare.summary(
        file([
          row("fresh-first-screen-small/total", 10),
          row("fresh-first-screen-small/probed-total", 14),
          row("fresh-first-screen-small/stage/pod.import", 9),
        ]),
      );
      const [headline = "", stages = ""] = text.split("slowest stages");
      assert.doesNotMatch(headline, /probed-total/);
      assert.match(stages, /probed total/);
    });
  });

  describe("given a file as the harness writes it", () => {
    it("holds to the Bridge spec's result schema, when its checkout is beside this one", async (t) => {
      let schema: object;
      try {
        schema = JSON.parse(
          await readFile(
            beside("cascade-bridge-spec", "bench", "result.schema.json"),
            "utf8",
          ),
        ) as object;
      } catch {
        t.skip("no cascade-bridge-spec beside this checkout");
        return;
      }
      const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
        schema,
      );
      const produced = {
        env: envOf({
          scenarios: new Set(SCENARIOS),
          sizes: ["synthea-10y"],
          encryption: "auto",
          repeats: 3,
          probe: true,
        }),
        commit: await commits(),
        results: [
          clockRow(
            "fresh-first-screen-synthea-10y/total",
            "s",
            [14, 13, 15],
            "x",
          ),
          clockRow(
            "fresh-first-screen-synthea-10y/rss",
            "By",
            [2.5e8, 2.6e8],
            "x",
          ),
          countRow("fresh-first-screen-synthea-10y/count/records", 6112, "x"),
          ...probedRows("fresh-first-screen-synthea-10y", {
            spans: [
              {
                name: "core-pod.step.rebuild:import+judge",
                calls: 1,
                ms: 9,
                wallMs: 9,
              },
              {
                name: "question:pod/My lab results",
                calls: 2,
                ms: 0.4,
                wallMs: 0.3,
              },
            ],
            counts: { "store.queries": 40 },
          }),
        ],
      };
      assert.ok(validate(produced), JSON.stringify(validate.errors));
    });

    it("names the commit of the runtime, the vocabulary, the Bridge, the fhir-r4 adapter and the reference tables, and of the kit beside it", async () => {
      const found = await commits();
      for (const key of [
        "runtime",
        "vocabulary",
        "bridge",
        "adapter-fhir-r4",
        "reference-tables",
      ])
        assert.match(found[key] ?? "", /^[0-9a-f]{40}(-dirty)?$/, key);
      if (existsSync(beside(KIT)))
        assert.match(found.kit ?? "", /^[0-9a-f]{40}(-dirty)?$/, "kit");
    });
  });

  describe("given the starter kit's own files, when its checkout is beside this one", () => {
    it("holds the questions the harness asks as the kit's first screen", async (t) => {
      let said: string;
      let api: string;
      try {
        said = await readFile(beside(KIT, "app", "said.ts"), "utf8");
        api = await readFile(beside(KIT, "app", "pod-api.ts"), "utf8");
      } catch {
        t.skip(`no ${KIT} beside this checkout`);
        return;
      }
      for (const question of FIRST_SCREEN)
        assert.ok(
          said.includes(`"${question}"`),
          `${question} is not in said.ts`,
        );
      assert.ok(api.includes(`"${THEN}"`), `${THEN} is not in pod-api.ts`);
    });
  });

  describe("given a build of the pod's database that is not probed", () => {
    it("asks the worker for no profile, which a probed one asks for", async () => {
      const whole = {} as Parameters<typeof wholeBuildJob>[1];
      assert.equal("profile" in wholeBuildJob("a-build", whole), false);
      const { result } = await probing(async () =>
        wholeBuildJob("a-build", whole),
      );
      assert.equal(result.profile, true);
    });
  });

  describe("given the files of a pod, counted by what the pod's layout says they are", () => {
    const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
    const PROV = "http://www.w3.org/ns/prov#";
    const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const uuid = (n: number) =>
      `urn:uuid:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const ni = (n: number) =>
      `ni:///sha-256;${Buffer.alloc(32, n).toString("base64url")}`;
    const triple = (subject: string, predicate: string, object: string) =>
      `<${subject}> <${predicate}> ${object} .\n`;

    it("puts each file in the kind its place gives it, tells a record, a version and a revision apart by the statements that name them, and sums each count over the kinds", async () => {
      const { layout } = await resolved();
      const folder = await mkdtemp(join(tmpdir(), "stored-kinds-"));
      scratch.push(folder);
      const wrote = new Map<StoredKind, { files: number; text: string[] }>();
      const put = async (kind: StoredKind, path: string, text: string) => {
        await mkdir(dirname(join(folder, path)), { recursive: true });
        await writeFile(join(folder, path), text);
        const written = wrote.get(kind) ?? { files: 0, text: [] };
        written.files += 1;
        written.text.push(text);
        wrote.set(kind, written);
      };
      const procedures = layout.place(`${CASCADE}MedicalProcedure`);
      await put(
        "records",
        procedures.path(uuid(1)),
        triple(uuid(1), RDF_TYPE, `<${CASCADE}MedicalProcedure>`) +
          triple(uuid(1), `${CASCADE}sourceRecordId`, '"a"'),
      );
      await put(
        "versions",
        layout.version(procedures, ni(1)),
        triple(ni(1), `${PROV}specializationOf`, `<${uuid(1)}>`) +
          triple(ni(1), `${CASCADE}procedureName`, '"x"') +
          triple(ni(1), "http://purl.org/pav/version", '"1"'),
      );
      await put(
        "revisions",
        layout.revision(procedures, ni(2)),
        triple(ni(2), `${CASCADE}revisionOf`, `<${uuid(1)}>`) +
          triple(ni(2), `${PROV}wasDerivedFrom`, `<${ni(9)}>`) +
          triple(ni(2), "http://purl.org/dc/terms/created", '"2026"') +
          triple(ni(2), RDF_TYPE, `<${CASCADE}Revision>`),
      );
      await put(
        "servers",
        layout.place(`${CASCADE}Server`).path(uuid(2)),
        triple(uuid(2), RDF_TYPE, `<${CASCADE}Server>`),
      );
      await put(
        "acts",
        layout.place(`${PROV}Activity`, [`${PROV}used`]).path(uuid(3)),
        triple(uuid(3), `${PROV}used`, `<${ni(3)}>`) +
          triple(uuid(3), RDF_TYPE, `<${PROV}Activity>`),
      );
      await put(
        "acts",
        layout.place(`${PROV}Activity`).path(uuid(4)),
        triple(uuid(4), RDF_TYPE, `<${PROV}Activity>`),
      );
      await put(
        "findings",
        layout.place(`${CASCADE}FindingForReview`).path(uuid(5)),
        triple(uuid(5), RDF_TYPE, `<${CASCADE}FindingForReview>`),
      );
      await put(
        "judgments",
        layout.place(`${CASCADE}Judgment`).path(uuid(6)),
        triple(uuid(6), RDF_TYPE, `<${CASCADE}Judgment>`),
      );
      await put(
        "judgments",
        layout.place(`${PROV}Activity`, [`${PROV}invalidated`]).path(uuid(7)),
        triple(uuid(7), `${PROV}invalidated`, `<${uuid(6)}>`),
      );
      await put(
        "matcher-output",
        layout.place(`${CASCADE}MatcherJudgmentAssertion`).path(uuid(8)),
        triple(uuid(8), RDF_TYPE, `<${CASCADE}MatcherJudgmentAssertion>`),
      );
      await put(
        "references",
        layout.place(`${CASCADE}ReferenceSeries`).path(uuid(9)),
        triple(uuid(9), RDF_TYPE, `<${CASCADE}ReferenceSeries>`),
      );
      await put(
        "documents",
        layout.place(`${PROV}Entity`).path(ni(3)),
        triple(ni(3), RDF_TYPE, `<${PROV}Entity>`),
      );
      await put(
        "stored-documents",
        layout.storedBytes.path(ni(3)),
        "x".repeat(1000),
      );
      const [view] = layout.built;
      await put(
        "views",
        view?.file as string,
        triple(uuid(1), `${CASCADE}procedureName`, '"x"') +
          triple(uuid(1), RDF_TYPE, `<${CASCADE}MedicalProcedure>`),
      );
      for (const path of [
        layout.manifest,
        layout.card,
        layout.preferences,
        layout.typeIndex,
        layout.place(`${CASCADE}Subject`).path(uuid(10)),
      ])
        await put(
          "creation-settings",
          path,
          triple("urn:x", RDF_TYPE, "<urn:y>"),
        );
      await put("other", "settings/encryption.json", '{"version":"1.4"}\n');

      const stored = await storedIn(folder, false);
      for (const kind of STORED_KINDS) {
        const given = wrote.get(kind) ?? { files: 0, text: [] };
        const text = given.text.join("");
        const lines =
          kind === "stored-documents" || kind === "other"
            ? 0
            : text.split("\n").filter(Boolean).length;
        assert.deepEqual(
          stored.kinds[kind],
          {
            files: given.files,
            statements: lines,
            bytes: Buffer.byteLength(text),
          },
          kind,
        );
      }
      assert.equal(stored.podRecords, 2, "the record and the server's");
      assert.equal(
        stored.versionLinks,
        1,
        "the one version's link to its record",
      );
      assert.deepEqual(stored.predicates, {
        cascade: 4,
        prov: 4,
        pav: 1,
        dct: 1,
        rdf: 16,
        other: 0,
      });
      const all = (pick: (each: StoredKind) => number) =>
        STORED_KINDS.reduce((sum, each) => sum + pick(each), 0);
      assert.equal(
        stored.onDisk.files,
        all((each) => stored.kinds[each].files),
      );
      assert.equal(
        stored.onDisk.bytes,
        all((each) => stored.kinds[each].bytes),
      );
      assert.ok(stored.onDisk.blocks >= stored.onDisk.files * 4096);
      assert.equal(stored.onDisk.blocks % 4096, 0);
    });

    it("counts a real pod's files, statements and bytes as the folder holds them, whichever kinds they are in", async () => {
      const claimProfiles = await profileOf("first");
      const folder = await mkdtemp(join(tmpdir(), "stored-plain-"));
      scratch.push(folder);
      const pod = await openedAt(join(folder, "pod"), false);
      await pod.import(syntheticPull(20), { claimProfiles });
      await pod.close();
      const stored = await storedIn(join(folder, "pod"), false);
      // The oracle: the folder walked, with no notion of kinds.
      const found: { path: string; bytes: Buffer }[] = [];
      const walk = async (at: string): Promise<void> => {
        for (const entry of await readdir(at, { withFileTypes: true }))
          if (entry.isDirectory()) await walk(join(at, entry.name));
          else
            found.push({
              path: join(at, entry.name)
                .slice(join(folder, "pod").length + 1)
                .replaceAll("\\", "/"),
              bytes: await readFile(join(at, entry.name)),
            });
      };
      await walk(join(folder, "pod"));
      const sum = (pick: (each: Stored["kinds"][StoredKind]) => number) =>
        STORED_KINDS.reduce(
          (total, kind) => total + pick(stored.kinds[kind]),
          0,
        );
      assert.equal(
        sum((each) => each.files),
        found.length,
      );
      assert.equal(
        sum((each) => each.bytes),
        found.reduce((total, { bytes }) => total + bytes.length, 0),
      );
      assert.equal(
        sum((each) => each.statements),
        found
          .filter(({ path }) => !path.startsWith("attachments/"))
          .reduce(
            (total, { bytes }) =>
              total + bytes.toString("utf8").split("\n").filter(Boolean).length,
            0,
          ),
      );
      assert.deepEqual(stored.onDisk.files, found.length);
      assert.equal(
        stored.kinds.other.files,
        0,
        "every file of a plain pod is placed",
      );
      for (const kind of [
        "records",
        "versions",
        "revisions",
        "acts",
        "views",
        "creation-settings",
      ] as const)
        assert.ok(stored.kinds[kind].files > 0, kind);
      assert.equal(stored.kinds["stored-documents"].files, 1);
      assert.equal(stored.kinds["stored-documents"].statements, 0);
      assert.equal(
        stored.versionLinks,
        stored.kinds.versions.files,
        "a version file states one link to its record",
      );
      assert.ok(stored.podRecords >= stored.kinds.records.files);
      assert.ok(
        stored.podRecords <=
          stored.kinds.records.files + stored.kinds.servers.files,
        "a pod record is a record's file, a server's included",
      );
      assert.equal(
        Object.values(stored.predicates).reduce((a, b) => a + b, 0),
        sum((each) => each.statements),
      );
      assert.ok((stored.database?.file ?? 0) > 0);
      assert.equal(
        (await stat(join(folder, ".answers", "pod", "pod.db"))).size,
        stored.database?.file,
      );
      assert.ok(stored.beside.bytes >= (stored.database?.file ?? 0));
      assert.ok((stored.database?.statements ?? 0) > 0);
      const { tables = 0, indexes = 0 } = stored.database ?? {};
      assert.ok(tables > 0 && indexes > 0);
      assert.ok(tables + indexes <= (stored.database?.file ?? 0));
      const [first, second] = stored.database?.largest ?? [];
      assert.ok(
        first !== undefined &&
          second !== undefined &&
          first.bytes >= second.bytes,
      );
    });

    it("counts an encrypted pod's files by what they are once opened, as many files of each kind as the same pull makes in a plain pod, and reads no database it cannot open", async () => {
      const claimProfiles = await profileOf("first");
      const folder = await mkdtemp(join(tmpdir(), "stored-sealed-"));
      scratch.push(folder);
      for (const [name, encrypted] of [
        ["plain", false],
        ["sealed", true],
      ] as const) {
        const pod = await openedAt(join(folder, name, "pod"), encrypted);
        await pod.import(syntheticPull(20), { claimProfiles });
        await pod.close();
      }
      const plain = await storedIn(join(folder, "plain", "pod"), false);
      const sealed = await storedIn(join(folder, "sealed", "pod"), true);
      for (const kind of STORED_KINDS) {
        assert.equal(sealed.kinds[kind].files, plain.kinds[kind].files, kind);
        assert.equal(
          sealed.kinds[kind].statements,
          plain.kinds[kind].statements,
          kind,
        );
      }
      assert.equal(sealed.podRecords, plain.podRecords);
      assert.equal(sealed.versionLinks, plain.versionLinks);
      assert.ok(
        sealed.onDisk.bytes >
          Object.values(sealed.kinds).reduce((a, each) => a + each.bytes, 0),
        "sealing adds to every file, and the pod's sealed index is a file the kinds do not hold",
      );
      assert.equal(sealed.database, undefined);
      assert.ok(sealed.beside.files > 0);
    });
  });

  describe("given a database whose build has no dbstat table", () => {
    it("gives the file's size and what it holds, and no split by table and index", () => {
      const db = {
        prepare: (sql: string) => {
          if (sql.includes("dbstat")) throw new Error("no such table: dbstat");
          const n = sql.includes("quad") ? 5 : 3;
          return { get: () => ({ n }), all: () => [] };
        },
      } as unknown as Database;
      assert.deepEqual(databaseFigures(db, 4096), {
        file: 4096,
        statements: 5,
        terms: 3,
      });
    });
  });

  describe("given the counts of a pod written as rows", () => {
    it("names every row as the result schema takes it, once, with a sentence of the glossary, and leaves no kind out", () => {
      const rows = rowsOfHeld();
      assert.ok(rows.length > 40);
      assert.deepEqual(
        rows.filter((row) => refused(row) !== undefined),
        [],
      );
      assert.equal(new Set(rows.map(({ name }) => name)).size, rows.length);
      assert.deepEqual(
        rows
          .filter(({ name }) => explain(name) === undefined)
          .map(({ name }) => name),
        [],
      );
      assert.ok(rows.every(({ kind }) => kind === "output"));
      const value = (name: string) =>
        rows.find((row) => row.name === `stored-synthea-10y/${name}`)?.value;
      for (const kind of STORED_KINDS) {
        assert.notEqual(value(`files/${kind}`), undefined, kind);
        assert.notEqual(value(`statements/${kind}`), undefined, kind);
        assert.notEqual(value(`bytes/${kind}`), undefined, kind);
      }
      assert.equal(value("files/all"), 41);
      assert.equal(value("statements/all"), 1000);
      assert.equal(value("bytes/all"), 10485760);
      assert.equal(value("count/entries"), 647);
      assert.equal(value("count/pod-records"), 10);
      assert.equal(value("count/version-links"), 10);
      assert.equal(value("statements/versions"), 600);
      assert.equal(value("predicates/cascade"), 700);
      assert.equal(value("database/file"), 2097152);
      assert.equal(value("bytes/in-4k-blocks"), 12582912);
      assert.equal(
        rows.find((row) => row.name.endsWith("bytes/versions"))?.unit,
        "By",
      );
    });

    it("leaves out the database's rows for a pod whose database was not read, and its split for a build with no dbstat", () => {
      const sealed = { ...held(), database: undefined };
      assert.equal(
        rowsOfHeld(sealed).some(({ name }) => name.includes("/database/")),
        false,
      );
      const bare = { ...held(), database: { file: 4096 } };
      const names = rowsOfHeld(bare).map(({ name }) => name);
      assert.ok(names.includes("stored-synthea-10y/database/file"));
      assert.ok(
        !names.some((name) => /database\/(tables|indexes|terms)/.test(name)),
      );
    });
  });

  describe("given the plan's scenarios", () => {
    it("lists the counts of a pod as a scenario of its own, which a run may name alone", () => {
      assert.ok((SCENARIOS as readonly string[]).includes("stored"));
      const { plan } = parsed([
        "--scenario",
        "stored",
        "--size",
        "synthea-10y",
      ]);
      assert.deepEqual([...plan.scenarios], ["stored"]);
    });
  });

  const heldFile = (stored = held()) => file(rowsOfHeld(stored));

  describe("given a performance file that holds the rows of a pod's counts", () => {
    it("reads back the kinds, the pod records and the source entries, and groups the kinds into what the source said, history, bookkeeping and what is derived", () => {
      assert.deepEqual(stored$.storedKeys(heldFile()), ["stored-synthea-10y"]);
      const page = stored$.storedOf(
        heldFile(),
        "stored-synthea-10y",
      ) as StoredPage;
      assert.equal(page.entries, 647);
      assert.equal(page.podRecords, 10);
      assert.deepEqual(
        page.kinds.map(({ id }) => id),
        [
          "records",
          "versions",
          "revisions",
          "acts",
          "stored-documents",
          "views",
          "creation-settings",
        ],
        "the kinds the pod holds, in the glossary's order",
      );
      const by = (name: string) =>
        page.classes.find((each) => each.class === name);
      assert.deepEqual(by("data"), {
        class: "data",
        files: 11,
        statements: 590,
        bytes: 3145728 + 5242880,
      });
      assert.equal(by("history")?.statements, 310);
      assert.equal(by("bookkeeping")?.statements, 20);
      assert.equal(by("derived")?.statements, 80);
    });

    it("keeps the version-to-record links in history and every class adding up to the total, whichever class the versions are given", async () => {
      const { readGlossary } = (await import(
        pathToFileURL(
          fileURLToPath(
            new URL("../../../../scripts/perf-glossary.mjs", import.meta.url),
          ),
        ).href
      )) as {
        readGlossary(): { storedKinds: { versions: { class: string } } };
      };
      const links = held().versionLinks;
      assert.ok(links > 0);
      const asBuilt = stored$.storedOf(
        heldFile(),
        "stored-synthea-10y",
      ) as StoredPage;
      for (const reclassed of ["data", "history", "bookkeeping", "derived"]) {
        const glossary = readGlossary();
        glossary.storedKinds.versions.class = reclassed;
        const page = stored$.storedOf(
          heldFile(),
          "stored-synthea-10y",
          glossary,
        ) as StoredPage;
        assert.equal(
          page.classes.reduce((all, each) => all + each.statements, 0),
          1000,
          `versions as ${reclassed}: the classes add up to the total`,
        );
        const history = page.classes.find((each) => each.class === "history");
        const versions = page.kinds.find((each) => each.id === "versions");
        const others = page.kinds
          .filter((each) => each.class === "history" && each.id !== "versions")
          .reduce((all, each) => all + each.statements, 0);
        assert.equal(
          history?.statements,
          others +
            links +
            (reclassed === "history" ? (versions?.statements ?? 0) - links : 0),
          `versions as ${reclassed}: the links are history`,
        );
      }
      assert.equal(asBuilt.versionLinks, links);
    });

    it("says in one line what a fresh import left, per pod record and per source entry, and how much of it is the source's own data", () => {
      const page = stored$.storedOf(
        heldFile(),
        "stored-synthea-10y",
      ) as StoredPage;
      const line = stored$.storedLine(page);
      assert.match(
        line,
        /A fresh import of 647 source entries left 10 pod records in 41 files \(10\.0 MiB\) and 1,000 statements/,
      );
      assert.match(
        line,
        /59% of the statements are the source's own data, 31% history/,
      );
      assert.match(line, /4\.1 files and 100 statements for each pod record/);
      assert.match(line, /1\.5 statements for each source entry/);
    });

    it("is read by the summary and the comparison, which list the counts apart from the headline times and say what is new against a file with none", () => {
      const lines = compare.summary(heldFile(), { markdown: true });
      assert.match(lines, /What a pod holds/);
      assert.match(
        lines,
        /\| [^|\n]*[Vv]ersion[^|\n]* \| data \| 10 \| 600 \| [\d.,]+ \| 60%/,
      );
      assert.doesNotMatch(
        lines,
        /\| stored-synthea-10y\/files/,
        "not among the headline rows",
      );
      const against = compare.compare(file([]), heldFile(), {
        markdown: true,
        sameJob: true,
      });
      assert.match(against, /What a pod holds/);
      assert.match(against, /main's file holds no counts of what a pod holds/);
      const changed = {
        ...held(),
        kinds: {
          ...held().kinds,
          versions: { files: 10, statements: 650, bytes: 3145728 },
        },
      };
      const moved = compare.compare(heldFile(), heldFile(changed), {
        markdown: true,
        sameJob: true,
      });
      assert.match(
        moved,
        /647 source entries: statements, Versions: what the source said \| 600 \| 650 \| \+8\.3% \(1\.1x\)/,
      );
      assert.doesNotMatch(moved, /stored-synthea-10y\//, "plain names only");
      const grown = compare.compare(
        heldFile(),
        heldFile({
          ...held(),
          kinds: {
            ...held().kinds,
            versions: { files: 10, statements: 600, bytes: 4194304 },
          },
        }),
        { markdown: true, sameJob: true },
      );
      assert.match(
        grown,
        /647 source entries: size, Versions: what the source said \| 3\.00 MiB \| 4\.00 MiB \|/,
      );
      assert.doesNotMatch(grown, /\d By\b/, "sizes are not raw bytes");
      assert.doesNotMatch(
        moved,
        /stored-synthea-10y\/files\/versions/,
        "only what changed",
      );
    });
  });

  interface Entry {
    fullUrl: string;
    resource: {
      resourceType: string;
      id: string;
      category?: { coding: { code: string }[] }[];
      meta?: { versionId?: string; lastUpdated?: string };
      valueQuantity?: { value: number };
      effectiveDateTime?: string;
      issued?: string;
    };
  }
  interface Bundled {
    resourceType: "Bundle";
    entry: Entry[];
  }
  const DAY = 86_400_000;
  /**
   * A Bundle of a patient, 45 Observations (every third with no number; of the others, 6 vital signs, which the pod does not keep
   * as records, and 24 laboratory results) and a Condition.
   */
  const bundleOf = (): Bundled => ({
    resourceType: "Bundle",
    entry: [
      {
        fullUrl: "https://h.invalid/fhir/Patient/p1",
        resource: { resourceType: "Patient", id: "p1" },
      },
      ...Array.from({ length: 45 }, (_, n): Entry => {
        const id = `o${n}`;
        return {
          fullUrl: `https://h.invalid/fhir/Observation/${id}`,
          resource: {
            resourceType: "Observation",
            id,
            category: [
              {
                coding: [{ code: n % 5 === 4 ? "vital-signs" : "laboratory" }],
              },
            ],
            meta: {
              versionId: "1",
              lastUpdated: `2017-02-${String(10 + (n % 10))}T07:29:38.825Z`,
            },
            effectiveDateTime: "2017-02-13T07:29:38+00:00",
            issued: "2017-02-13T07:29:38.825+00:00",
            ...(n % 3 !== 2 && { valueQuantity: { value: 5 + n } }),
          },
        };
      }),
      {
        fullUrl: "https://h.invalid/fhir/Condition/c1",
        resource: { resourceType: "Condition", id: "c1" },
      },
    ],
  });
  const numbered = (bundle: Bundled) =>
    bundle.entry.flatMap(({ resource }, at) =>
      resource.resourceType === "Observation" &&
      resource.valueQuantity !== undefined &&
      resource.category?.[0]?.coding[0]?.code === "laboratory"
        ? [at]
        : [],
    );

  describe("given a Bundle that is imported again with ten of its source entries changed", () => {
    it("changes exactly ten laboratory Observations that carry a number, spread evenly through the Bundle, each in its value, version and change time and nothing else, and leaves the Bundle it was given as it was", () => {
      const bundle = bundleOf();
      const before = structuredClone(bundle);
      const edited = changedBundle(bundle);
      assert.deepEqual(bundle, before, "the given Bundle is not touched");
      const after = edited.bundle as Bundled;
      assert.equal(after.entry.length, bundle.entry.length);
      const differing = after.entry.flatMap((entry, at) =>
        JSON.stringify(entry) === JSON.stringify(bundle.entry[at]) ? [] : [at],
      );
      const eligible = numbered(bundle);
      assert.equal(eligible.length, 24, "the vital signs are left out");
      assert.equal(CHANGED_ENTRIES, 10);
      assert.deepEqual(
        differing,
        Array.from(
          { length: CHANGED_ENTRIES },
          (_, i) =>
            eligible[Math.floor((i * eligible.length) / CHANGED_ENTRIES)],
        ),
      );
      for (const at of differing) {
        const was = bundle.entry[at]?.resource as Entry["resource"];
        const now = (after.entry[at] as Entry).resource;
        assert.equal(
          now.valueQuantity?.value,
          (was.valueQuantity?.value ?? 0) + 1,
        );
        assert.equal(now.meta?.versionId, "2");
        assert.equal(
          Date.parse(now.meta?.lastUpdated ?? "") -
            Date.parse(was.meta?.lastUpdated ?? ""),
          DAY,
        );
        assert.deepEqual(
          {
            ...now,
            valueQuantity: was.valueQuantity,
            meta: was.meta,
          },
          was,
          "nothing but those three fields differs",
        );
        assert.equal(
          (after.entry[at] as Entry).fullUrl,
          bundle.entry[at]?.fullUrl,
        );
      }
      assert.equal(edited.changed, 10);
      assert.equal(edited.added, 0);
    });

    it("gives the same Bundle on every call, says in a sentence what it changed, and refuses a Bundle with fewer Observations to change than that", () => {
      assert.deepEqual(changedBundle(bundleOf()), changedBundle(bundleOf()));
      const { says } = changedBundle(bundleOf());
      assert.match(says, /10 of the 24 laboratory Observations/);
      for (const field of [
        "valueQuantity.value",
        "meta.versionId",
        "meta.lastUpdated",
      ])
        assert.ok(says.includes(field), field);
      const small = { ...bundleOf(), entry: bundleOf().entry.slice(0, 8) };
      assert.throws(() => changedBundle(small), /fewer than 10/);
    });
  });

  describe("given a Bundle that is imported again with one more source entry", () => {
    it("adds one Observation at the end, a copy of the last laboratory result that carries a number with a new id and a day later, and changes no other entry", () => {
      const bundle = bundleOf();
      const before = structuredClone(bundle);
      const edited = oneMoreBundle(bundle);
      assert.deepEqual(bundle, before);
      const after = edited.bundle as Bundled;
      assert.equal(after.entry.length, bundle.entry.length + 1);
      assert.deepEqual(after.entry.slice(0, -1), bundle.entry);
      const last = numbered(bundle).at(-1) as number;
      const copied = (bundle.entry[last] as Entry).resource;
      const added = after.entry.at(-1) as Entry;
      assert.equal(added.resource.resourceType, "Observation");
      assert.notEqual(added.resource.id, copied.id);
      assert.ok(
        !bundle.entry.some(({ resource }) => resource.id === added.resource.id),
        "a new id",
      );
      assert.ok(added.fullUrl.endsWith(`/Observation/${added.resource.id}`));
      assert.equal(
        added.resource.valueQuantity?.value,
        copied.valueQuantity?.value,
      );
      for (const field of ["effectiveDateTime", "issued"] as const)
        assert.equal(
          Date.parse(added.resource[field] ?? "") -
            Date.parse(copied[field] ?? ""),
          DAY,
          field,
        );
      assert.equal(
        Date.parse(added.resource.meta?.lastUpdated ?? "") -
          Date.parse(copied.meta?.lastUpdated ?? ""),
        DAY,
      );
      assert.equal(edited.added, 1);
      assert.equal(edited.changed, 0);
      assert.match(edited.says, /one Observation/);
      assert.deepEqual(oneMoreBundle(bundleOf()), oneMoreBundle(bundleOf()));
    });
  });

  describe("given the jobs of every day", () => {
    it("lists each as a scenario of its own that a run may name alone", () => {
      for (const scenario of [
        "reimport-identical",
        "reimport-changed",
        "add-one-record",
        "reopen-after-kill",
        "question-after-update",
      ]) {
        assert.ok(
          (SCENARIOS as readonly string[]).includes(scenario),
          scenario,
        );
        const { plan } = parsed(["--scenario", scenario]);
        assert.deepEqual([...plan.scenarios], [scenario]);
      }
    });

    it("explains every row the jobs write, in the glossary, with a sentence of the job's own for its total", () => {
      const names = rowsOfJobs().map(({ name }) => name);
      assert.deepEqual(
        names.filter((name) => explain(name) === undefined),
        [],
      );
      assert.deepEqual(
        rowsOfJobs().flatMap((row) => refused(row) ?? []),
        [],
      );
      assert.match(
        explain("reimport-identical-synthea-10y/total") ?? "",
        /same file/i,
      );
      assert.match(
        explain("reopen-after-kill-synthea-10y/total") ?? "",
        /stopped|closed/i,
      );
    });

    it("is said by the summary and the comparison in one line for each job, and a file of main's with none of them does not stop it", () => {
      const jobs = file(rowsOfJobs());
      const summary = compare.summary(jobs, { markdown: true });
      assert.match(summary, /What people do after the first import/);
      assert.match(
        summary,
        /- Importing the same file again took 800 ms \(0\.3 x the first import\) and wrote 0 files; the document was not converted again\./,
      );
      const against = compare.compare(file([]), jobs, {
        markdown: true,
        sameJob: true,
      });
      assert.match(against, /What people do after the first import/);
      assert.match(
        against,
        /- Opening a pod after an update, and asking its first question, took 600 ms/,
      );
      assert.doesNotMatch(
        compare.summary(file([]), { markdown: true }),
        /after the first import/,
      );
    });

    it("measures importing the same file again, with ten source entries changed, with one more, reopening after a kill and the first question after an update, each on a copy of the pod the first import left, which stays as it was", async () => {
      const plan = (...scenarios: Scenario[]): Plan => ({
        scenarios: new Set(scenarios),
        sizes: ["synthea-10y"],
        encryption: "plain",
        repeats: 1,
        probe: false,
      });
      const alone = (await perfFile(plan("fresh-first-screen", "stored")))
        .results;
      const { results } = await perfFile(
        plan(
          "fresh-first-screen",
          "reimport-identical",
          "reimport-changed",
          "add-one-record",
          "reopen-after-kill",
          "question-after-update",
          "stored",
        ),
      );
      const at = (rows: readonly Row[], name: string): number | undefined =>
        rows.find((row) => row.name === name)?.value;
      const value = (scenario: string, measure: string) =>
        at(results, `${scenario}-synthea-10y/${measure}`);
      assert.deepEqual(
        results.filter((row) => refused(row) !== undefined),
        [],
      );
      assert.deepEqual(
        results
          .filter(({ name }) => explain(name) === undefined)
          .map(({ name }) => name),
        [],
      );
      // The pod the first import left was counted last and is what a first import alone leaves: no job wrote into it.
      for (const measure of [
        "files/all",
        "statements/all",
        "count/pod-records",
      ])
        assert.equal(
          value("stored", measure),
          at(alone, `stored-synthea-10y/${measure}`),
          measure,
        );
      const identical = (measure: string) =>
        value("reimport-identical", measure);
      assert.equal(
        identical("count/converts"),
        0,
        "the document is skipped by its hash",
      );
      assert.equal(identical("count/files-written"), 0);
      assert.equal(identical("count/versions-added"), 0);
      assert.equal(identical("count/revisions-added"), 0);
      const changed = (measure: string) => value("reimport-changed", measure);
      assert.equal(changed("count/converts"), 1);
      assert.equal(changed("count/entries-changed"), 10);
      assert.equal(changed("count/versions-added"), 10);
      assert.equal(changed("count/revisions-added"), 10);
      assert.equal(changed("count/records-added"), 0);
      assert.ok((changed("count/files-written") ?? 0) >= 20);
      assert.ok((changed("count/statements-added") ?? 0) > 0);
      const added = (measure: string) => value("add-one-record", measure);
      assert.equal(added("count/converts"), 1);
      assert.equal(added("count/entries-added"), 1);
      assert.equal(added("count/records-added"), 1);
      assert.equal(added("count/versions-added"), 1);
      assert.equal(added("count/revisions-added"), 1);
      for (const scenario of [
        "reimport-identical",
        "reimport-changed",
        "add-one-record",
      ])
        for (const measure of [
          "total",
          "open",
          "import",
          "first-answer",
          "close",
        ])
          assert.ok(
            (value(scenario, measure) ?? 0) > 0,
            `${scenario} ${measure}`,
          );
      const killed = (measure: string) => value("reopen-after-kill", measure);
      assert.equal(
        killed("count/database-found"),
        0,
        "the process was killed before the database was built",
      );
      assert.ok((killed("count/files-read") ?? 0) > 1000);
      assert.ok((killed("count/statements-read") ?? 0) > 10000);
      for (const scenario of ["reopen-after-kill", "question-after-update"])
        for (const measure of ["total", "open", "first-read", "second-read"])
          assert.ok(
            (value(scenario, measure) ?? 0) > 0,
            `${scenario} ${measure}`,
          );
    });
  });
});
