import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { flatten, loadPlainly } from "./perf-floor.js";
import { profileOf, syntheticPull } from "./import-bench.js";
import {
  clockRow,
  commits,
  folderFingerprint,
  openedAt,
  PINNED,
  pinClock,
  countRow,
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
  THEN,
  type Row,
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
  summary(file: object, options?: object): string;
  speedOf(file: object, key: string): Speed | undefined;
  floorLine(speed: Speed | undefined): string | undefined;
  shown(value: number | undefined, unit: string): string;
}

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

    it("is a row in bytes where the name ends in .bytes, and a count of things otherwise", () => {
      const count = countRow("x-y/count/handoff.2-answer.bytes", 19_600_000);
      assert.deepEqual([count.unit, count.kind], ["By", "cost"]);
      assert.equal(refused(count), undefined);
      assert.equal(
        countRow("x-y/count/handoff.2-answer.items", 4).unit,
        "{count}",
      );
      assert.equal(countRow("x-y/count/bytesome", 4).unit, "{count}");
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
        /\| Records \| Answer-file lines \| Files written \| Questions put to the fact store \| Individual facts looked at \| Saving: answer-file lines\/s \| Saving: files\/s \|/,
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
});
