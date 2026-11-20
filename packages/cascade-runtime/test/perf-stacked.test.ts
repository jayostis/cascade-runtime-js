import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = async <T>(name: string): Promise<T> =>
  (await import(
    pathToFileURL(
      fileURLToPath(new URL(`../../../../scripts/${name}`, import.meta.url)),
    ).href
  )) as T;

interface Column {
  id: string;
  total: number;
  measured: boolean;
  bands: number[];
  other: number;
  href?: string;
}
interface Step {
  key: string;
  label: string;
  says?: string;
  colour: string;
}
interface Chart {
  key: string;
  steps: Step[];
  columns: Column[];
}
interface File {
  build: { id: string; date: string; sha: string; event: string; run: string };
  file: { results: object[] };
}
interface Stacked {
  BANDS: number;
  OTHER: string;
  PALETTE: string[];
  shape(files: File[], options?: object): Chart[];
  stackedPage(charts: Chart[], options: object): string;
  pages(options: object): Chart[];
  sentenceOf(extra: string | undefined): string | undefined;
  shortOf(sentence: string): string;
}

const KEY = "fresh-first-screen-synthea-10y";
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** A build's file: the headline total, the probed run's time and an own-time row for each step given. */
const file = (
  run: number,
  total: number | undefined,
  own: Record<string, number>,
  { probed = total, key = KEY }: { probed?: number; key?: string } = {},
): File => ({
  build: {
    id: `${run}-aaaaaa${run % 10}`,
    date: "2026-11-20",
    sha: `aaaaaa${run % 10}`,
    event: "push",
    run: String(run),
  },
  file: {
    results: [
      ...(total === undefined
        ? []
        : [{ name: `${key}/total`, unit: "s", value: total }]),
      ...(probed === undefined
        ? []
        : [{ name: `${key}/probed-total`, unit: "s", value: probed }]),
      ...Object.entries(own).map(([name, value]) => ({
        name: `${key}/self/${name}`,
        unit: "s",
        value,
        extra: `Opening the pod: ${name}. Sits inside scenario.open. | Own time: ... | probed run; 1 calls; ${name}`,
      })),
    ],
  },
});

const scratch: string[] = [];

/**
 * The page "Where the time goes, over time": stacked charts of each scenario's steps over the builds, shaped from the
 * performance files kept on perf-data, and drawn as a static page.
 */
describe("The stacked performance page · perf-stacked.mjs", () => {
  after(async () => {
    await Promise.all(
      scratch.map((each) => rm(each, { recursive: true, force: true })),
    );
  });

  describe("given builds whose own times are taken from one probed run", () => {
    it("scales the own times so that the bands and everything else add up to the measured total, whether the own times sum to less than the probed run or to more", async () => {
      const { shape } = await script<Stacked>("perf-stacked.mjs");
      const [chart] = shape([
        // Own times sum to 3 of a probed 4 s: they are kept as they are, the 1 s unaccounted for is everything else.
        file(1, 4, { a: 2, b: 1 }),
        // They sum to 6 of a probed 4 s, steps overlapping: scaled down to fit the 5 s measured.
        file(2, 5, { a: 4, b: 2 }, { probed: 4 }),
      ]) as [Chart];
      const [first, second] = chart.columns as [Column, Column];
      assert.ok(Math.abs(sum(first.bands) + first.other - 4) < 1e-9);
      assert.deepEqual(first.bands, [2, 1]);
      assert.ok(Math.abs(first.other - 1) < 1e-9);
      assert.ok(Math.abs(sum(second.bands) + second.other - 5) < 1e-9);
      assert.ok(Math.abs((second.bands[0] ?? 0) - 5 * (4 / 6)) < 1e-9);
      assert.ok(second.other < 1e-9);
    });

    it("gives a band to the seven steps with the most time across the builds and the rest to everything else, a step a build lacks being nothing there", async () => {
      const { shape, BANDS } = await script<Stacked>("perf-stacked.mjs");
      const steps = Object.fromEntries(
        Array.from({ length: 10 }, (_, at) => [`step-${at}`, 10 - at]),
      );
      const [chart] = shape([
        file(1, 100, steps),
        file(2, 100, { "step-0": 5, "late-step": 60 }),
      ]) as [Chart];
      assert.equal(BANDS, 7);
      assert.equal(chart.steps.length, 7);
      assert.equal(chart.steps[0]?.key, "late-step");
      assert.ok(!chart.steps.some(({ key }) => key === "step-9"));
      const late = chart.steps.findIndex(({ key }) => key === "late-step");
      assert.equal(chart.columns[0]?.bands[late], 0);
      for (const column of chart.columns)
        assert.ok(Math.abs(sum(column.bands) + column.other - 100) < 1e-9);
    });

    it("draws a build whose file has no own times, from before it had them, as all everything else, and leaves out a build that did not measure the chart", async () => {
      const { shape } = await script<Stacked>("perf-stacked.mjs");
      const [chart] = shape([
        file(1, 3, {}),
        file(2, undefined, {}, { probed: 2 }),
        file(3, 4, { a: 1 }),
      ]) as [Chart];
      assert.equal(chart.columns.length, 2);
      const [old, now] = chart.columns as [Column, Column];
      assert.equal(old.measured, false);
      assert.equal(old.other, 3);
      assert.deepEqual(old.bands, [0]);
      assert.equal(now.measured, true);
    });

    it("draws only the newest builds of a window, and one chart for each scenario and size the files measured, in the glossary's order", async () => {
      const { shape } = await script<Stacked>("perf-stacked.mjs");
      const files = Array.from({ length: 5 }, (_, at) =>
        file(at + 1, 1, { a: 1 }),
      );
      const [chart] = shape(files, { window: 3 }) as [Chart];
      assert.deepEqual(
        chart.columns.map(({ id }) => id),
        files.slice(2).map(({ build }) => build.id),
      );
      const both = shape([
        {
          ...file(1, 1, {}),
          file: {
            results: [
              ...file(1, 1, {}, { key: "close-synthea-10y" }).file.results,
              ...file(1, 1, {}, { key: KEY }).file.results,
              ...file(1, 1, {}, { key: `${KEY}-encrypted` }).file.results,
            ],
          },
        },
      ]);
      assert.deepEqual(
        both.map(({ key }) => key),
        [KEY, `${KEY}-encrypted`, "close-synthea-10y"],
      );
    });
  });

  describe("given steps charted beside one another", () => {
    it("gives a step the same colour in every chart, and two steps of a chart different ones", async () => {
      const { shape, PALETTE } = await script<Stacked>("perf-stacked.mjs");
      const own = Object.fromEntries(
        Array.from({ length: 7 }, (_, at) => [`step-${at}`, 7 - at]),
      );
      const files = [
        {
          ...file(1, 100, own),
          file: {
            results: [
              ...file(1, 100, own).file.results,
              ...file(
                1,
                100,
                { "step-3": 9, other: 1 },
                { key: "close-synthea-10y" },
              ).file.results,
            ],
          },
        },
      ];
      const charts = shape(files);
      const colourOf = (chart: Chart | undefined, key: string) =>
        chart?.steps.find((step) => step.key === key)?.colour;
      assert.equal(
        colourOf(charts[0], "step-3"),
        colourOf(charts[1], "step-3"),
      );
      assert.equal(
        new Set(charts[0]?.steps.map(({ colour }) => colour)).size,
        7,
      );
      assert.ok(
        charts[0]?.steps.every(({ colour }) => PALETTE.includes(colour)),
      );
      assert.deepEqual(
        shape(files).map((chart) => chart.steps.map(({ colour }) => colour)),
        charts.map((chart) => chart.steps.map(({ colour }) => colour)),
      );
    });
  });

  describe("given the glossary's sentences", () => {
    it("names a band by its sentence without the place it sits, cut to a label that fits, and keeps the whole sentence for the hover", async () => {
      const { sentenceOf, shortOf, shape } =
        await script<Stacked>("perf-stacked.mjs");
      assert.equal(
        sentenceOf(
          "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: more",
        ),
        "Finding which adapter accepts this document.",
      );
      assert.equal(sentenceOf(undefined), undefined);
      assert.equal(
        shortOf(
          "Questions put to the pod's fact store, many of them: the time one or more of them was in progress.",
        ),
        "Questions put to the pod's fact store, many of them",
      );
      assert.ok(
        shortOf(
          "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts.",
        ).endsWith("…"),
      );
      const [chart] = shape([file(1, 2, { "core-pod.x": 1 })]) as [Chart];
      assert.equal(chart.steps[0]?.label, "Opening the pod");
      assert.equal(chart.steps[0]?.says, "Opening the pod: core-pod.x.");
    });
  });

  describe("given the perf-data checkout and the index of builds", () => {
    it("writes a page with a column for each build that opens the build's entry only where the index has one, and the data it draws", async () => {
      const { pages } = await script<Stacked>("perf-stacked.mjs");
      const data = await mkdtemp(join(tmpdir(), "perf-stacked-data-"));
      const out = await mkdtemp(join(tmpdir(), "perf-stacked-out-"));
      scratch.push(data, out);
      const day = join(data, "runtime", "2026", "11", "20");
      await mkdir(day, { recursive: true });
      await mkdir(join(out, "runs"), { recursive: true });
      for (const [run, sha] of [
        [100, "aaaaaaa"],
        [200, "bbbbbbb"],
      ] as const)
        await writeFile(
          join(day, `${run}-${sha}-push.json`),
          JSON.stringify(file(run, 2, { "scenario.open": 1 }).file),
        );
      await writeFile(
        join(out, "runs", "index.html"),
        '<details class="build" id="200-bbbbbbb" open></details><div id="100-aaaaaaa"></div>',
      );
      const charts = pages({
        data,
        out,
        repo: "owner/repo",
        runs: join(out, "runs"),
      });
      assert.equal(charts.length, 1);
      assert.deepEqual(
        charts[0]?.columns.map(({ href }) => href),
        [undefined, "runs/#200-bbbbbbb"],
      );
      const page = await readFile(join(out, "index.html"), "utf8");
      assert.equal((page.match(/<a class="col"/g) ?? []).length, 2);
      assert.match(page, /href="runs\/#200-bbbbbbb"/);
      assert.doesNotMatch(page, /href="runs\/#100-aaaaaaa"/);
      assert.match(page, /<a href="\.\.\/">Documentation home<\/a>/);
      assert.match(page, /href="detail\/"/);
      assert.match(page, /Opening the pod: scenario\.open/);
      const json = JSON.parse(
        await readFile(join(out, "stacked.json"), "utf8"),
      ) as { charts: Chart[] };
      assert.equal(json.charts[0]?.columns.length, 2);
    });

    it("writes an empty page, not a failure, when no build was measured", async () => {
      const { pages } = await script<Stacked>("perf-stacked.mjs");
      const data = await mkdtemp(join(tmpdir(), "perf-stacked-data-"));
      const out = await mkdtemp(join(tmpdir(), "perf-stacked-out-"));
      scratch.push(data, out);
      assert.deepEqual(pages({ data, out, repo: "owner/repo" }), []);
      assert.match(
        await readFile(join(out, "index.html"), "utf8"),
        /No build has been measured yet/,
      );
    });
  });
});
