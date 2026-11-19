import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openPod } from "cascade-runtime";
import { explain, glossaryMarkdown } from "./perf-glossary.js";
import { probing, type Seen } from "@cascade-runtime/runtime/probe";
import { profileOf, syntheticPull } from "./import-bench.js";
import {
  clockRow,
  tabulated,
  FIRST_SCREEN,
  PAGES,
  part,
  probedRows,
  refused,
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
}

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
          { name: "core-pod.step.rebuild:import+judge", calls: 1, ms: 1500 },
          {
            name: "matcher.rule:https://ns.cascadeprotocol.org/cascade#SameCodeAndDay",
            calls: 3,
            ms: 20,
          },
          { name: "question:pod/My lab results", calls: 1, ms: 12 },
          { name: "bridge.stage:records", calls: 1, ms: 9 },
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
        [2, 3, "1.000-3.000"],
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
});
