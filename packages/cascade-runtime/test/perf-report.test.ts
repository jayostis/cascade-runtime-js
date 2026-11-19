import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { before, describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { openPod } from "cascade-runtime";
import { wholeBuildJob } from "@cascade-runtime/runtime/node";
import {
  probing,
  recorded,
  type Seen,
  timed,
} from "@cascade-runtime/runtime/probe";
import { explain, glossaryMarkdown } from "./perf-glossary.js";
import { profileOf, syntheticPull } from "./import-bench.js";
import {
  clockRow,
  commits,
  countRow,
  envOf,
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

interface Compare {
  compare(before: object, after: object, options?: object): string;
  summary(file: object, options?: object): string;
}

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

  describe("given a pod holding a small pull, imported and read with the probe on", () => {
    let spans: string[];
    const seenRuns: Seen[] = [];

    before(async () => {
      const claimProfiles = await profileOf("first");
      const pod = await openPod();
      try {
        const { seen } = await probing(async () => {
          await pod.import(syntheticPull(20), { claimProfiles });
          await pod.ask(FIRST_SCREEN[8] as string);
          await pod.askPage(PAGES[0] as string, { size: 5 });
        });
        spans = [...seen.spans.keys()];
        seenRuns.push(seen);
      } finally {
        seenRuns.push((await probing(() => pod.close())).seen);
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

    it("has a plain sentence for every stage and count the probe saw, in a row of the performance file", () => {
      const rows = seenRuns.flatMap((seen) =>
        probedRows("fresh-first-screen-synthea-10y", tabulated(seen), 100_000),
      );
      assert.ok(rows.length > 20);
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

  describe("given the glossary", () => {
    it("explains every scenario, size, headline measurement and phase row of the file", () => {
      for (const name of [
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
