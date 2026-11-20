import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { explain } from "./perf-glossary.js";

const script = async <T>(name: string): Promise<T> =>
  (await import(
    pathToFileURL(
      fileURLToPath(new URL(`../../../../scripts/${name}`, import.meta.url)),
    ).href
  )) as T;

interface Column {
  id: string;
  total: number;
  runs?: number;
  measured: boolean;
  bands: number[];
  other: number;
  href?: string;
}
interface Step {
  key: string;
  label: string;
  says?: string;
  span: string;
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
  readBuilds(data: string, glossary: object, window?: number): File[];
  readGlossary(): object;
  chartSvg(chart: object, index: number): string;
}

const KEY = "fresh-first-screen-synthea-10y";
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** A build's file: the headline total, the probed run's time and an own-time row for each step given. */
const file = (
  run: number,
  total: number | undefined,
  own: Record<string, number>,
  {
    probed = total,
    key = KEY,
    runs,
  }: { probed?: number; key?: string; runs?: number } = {},
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
        : [
            {
              name: `${key}/total`,
              unit: "s",
              value: total,
              ...(runs !== undefined && { samples: runs }),
            },
          ]),
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
      assert.equal(chart.steps[0]?.label, "Opening the pod: core-pod.x");
      assert.equal(chart.steps[0]?.says, "Opening the pod: core-pod.x.");
    });
  });

  describe("given the questions of the question pages, whose sentences differ only by the question", () => {
    const ASKED = [
      "pod-my-active-conditions",
      "pod-what-each-import-brought-in",
      "profile-what-needs-review",
      "pod-which-reference-versions-are-current",
      "pod-my-reports-notes-and-documents",
    ];

    /** A build of `scenario` whose own-time rows say what the glossary says of them, as the performance file's do. */
    const asking = (scenario: string, family: string) => {
      const key = `${scenario}-synthea-10y`;
      const own = Object.fromEntries(
        ASKED.map((question, at) => [`${family}-${question}`, 5 - at]),
      );
      const built = file(1, 20, own, { key });
      for (const row of built.file.results as {
        name: string;
        extra?: string;
      }[])
        if (row.name.includes("/self/")) row.extra = explain(row.name);
      return built;
    };

    it("gives every band of the question-page chart a label of its own that names its question, and keeps the whole sentence", async () => {
      const { shape, stackedPage, readGlossary } =
        await script<Stacked>("perf-stacked.mjs");
      const charts = shape([asking("question-page", "question.page")]);
      const [chart] = charts as [Chart];
      assert.equal(chart.steps.length, ASKED.length);
      assert.equal(new Set(chart.steps.map(({ label }) => label)).size, 5);
      for (const [at, question] of ASKED.entries()) {
        const step = chart.steps[at] as Step;
        const words = question.replaceAll("-", " ");
        assert.equal(step.label, `One page of the answer to: ${words}`);
        assert.equal(step.says, `One page of the answer to: ${words}.`);
        assert.equal(step.span, `question.page-${question}`);
      }
      const page = stackedPage(charts, {
        repo: "owner/repo",
        glossary: readGlossary(),
      });
      assert.match(
        page,
        /"says":"One page of the answer to: pod which reference versions are current\."/,
      );
    });

    it("names a band of a reopened pod by its question, without the places the glossary says the question sits inside", async () => {
      const { shape } = await script<Stacked>("perf-stacked.mjs");
      const built = asking("reopen-first-answer", "question");
      assert.match(
        String(
          (built.file.results as { extra?: string }[]).find(
            ({ extra }) => extra !== undefined,
          )?.extra,
        ),
        /Sits inside scenario\.first-read or scenario\.second-read\./,
      );
      const [chart] = shape([built]) as [Chart];
      assert.equal(
        chart.steps[0]?.label,
        "The answer to: pod my active conditions",
      );
    });
  });

  describe("given the same steps with other weights", () => {
    it("gives a step the colour its name gives, however much time the steps took", async () => {
      const { shape } = await script<Stacked>("perf-stacked.mjs");
      const colours = (own: Record<string, number>) =>
        Object.fromEntries(
          (shape([file(1, 100, own)])[0] as Chart).steps.map(
            ({ key, colour }) => [key, colour],
          ),
        );
      assert.deepEqual(
        colours({ x: 5, y: 3, z: 1, w: 2 }),
        colours({ x: 1, y: 3, z: 5, w: 4 }),
      );
    });
  });

  describe("given a page of charts and a person who cannot use a pointer", () => {
    it("makes every column focusable, with its numbers spoken whether or not it opens anything, and says how many runs the headline is the median of", async () => {
      const { shape, stackedPage, readGlossary } =
        await script<Stacked>("perf-stacked.mjs");
      const page = stackedPage(
        shape([file(1, 2, { a: 1 }), file(2, 2, { a: 1 }, { runs: 5 })]),
        { repo: "owner/repo", glossary: readGlossary() },
      );
      const columns = page.match(/<a class="col"[^>]*>/g) ?? [];
      assert.equal(columns.length, 2);
      for (const column of columns) assert.match(column, /tabindex="0"/);
      assert.match(columns[0] ?? "", /role="img"/);
      assert.match(
        columns[0] ?? "",
        /aria-label="[^"]*: Opening the pod: a 1 s/,
      );
      assert.match(page, /<svg [^>]*role="group"/);
      assert.doesNotMatch(page, /<svg [^>]*role="img"/);
      assert.match(page, /the median of 5 runs/);
    });

    it("shows times under ten milliseconds with their decimals", async () => {
      const { shape, chartSvg } = await script<Stacked>("perf-stacked.mjs");
      const [chart] = shape([file(1, 0.005, { a: 0.004 })]) as [Chart];
      const svg = chartSvg({ ...chart, title: "t" }, 0);
      assert.match(svg, />1\.5 ms</);
      assert.match(svg, />4\.5 ms</);
    });
  });

  describe("given a perf-data checkout with more builds than a chart draws and a file that cannot be read", () => {
    it("reads the newest builds, cuts each file to the rows the charts use, and skips the unreadable file with a warning", async () => {
      const { readBuilds, readGlossary } =
        await script<Stacked>("perf-stacked.mjs");
      const data = await mkdtemp(join(tmpdir(), "perf-stacked-data-"));
      scratch.push(data);
      const day = join(data, "runtime", "2026", "11", "20");
      await mkdir(day, { recursive: true });
      for (const run of [1, 2, 3, 4]) {
        const built = file(run, 2, { "scenario.open": 1 });
        await writeFile(
          join(day, `${run}-aaaaaa${run}-push.json`),
          run === 3
            ? "{ not json"
            : JSON.stringify({
                ...built.file,
                results: [
                  ...built.file.results,
                  { name: `${KEY}/stage/scenario.open`, unit: "s", value: 1 },
                  {
                    name: `${KEY}/count/probe.calls`,
                    unit: "{count}",
                    value: 9,
                  },
                  { name: `${KEY}/rss`, unit: "By", value: 100 },
                ],
              }),
        );
      }
      const warned: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((text: string) => {
        warned.push(text);
        return true;
      }) as typeof process.stderr.write;
      let kept: File[];
      try {
        kept = readBuilds(data, readGlossary(), 2);
      } finally {
        process.stderr.write = write;
      }
      assert.deepEqual(
        kept.map(({ build }) => build.run),
        ["2", "4"],
      );
      assert.equal(warned.length, 1);
      assert.match(warned[0] ?? "", /3-aaaaaa3 is left out/);
      for (const { file: reducedFile } of kept)
        assert.deepEqual(
          (reducedFile.results as { name: string }[]).map(({ name }) =>
            name.slice(KEY.length + 1),
          ),
          ["total", "probed-total", "self/scenario.open"],
        );
    });
  });

  describe("given builds whose files hold the plain load of the same input and what the import handled", () => {
    const rowsOf = (run: number, imported: number, floor?: number) => [
      { name: `${KEY}/import`, unit: "s", value: imported },
      { name: `${KEY}/phase-saving`, unit: "s", value: 5 },
      { name: `${KEY}/phase-converting`, unit: "s", value: 10 },
      { name: `${KEY}/phase-judging`, unit: "s", value: 8 },
      { name: `${KEY}/count/records`, unit: "{count}", value: 647 },
      {
        name: `${KEY}/count/built.lines.total`,
        unit: "{count}",
        value: 5000,
      },
      { name: `${KEY}/count/files-written`, unit: "{count}", value: 900 },
      { name: `${KEY}/count/store.queries`, unit: "{count}", value: 120 },
      { name: `${KEY}/count/graph.quadsvisited`, unit: "{count}", value: 7000 },
      { name: `${KEY}/count/probe.calls`, unit: "{count}", value: run },
      ...(floor === undefined
        ? []
        : [
            { name: "floor-synthea-10y/total", unit: "s", value: floor },
            { name: "floor-synthea-10y/parse", unit: "s", value: floor / 4 },
            {
              name: "floor-synthea-10y/count/rows",
              unit: "{count}",
              value: 647,
            },
          ]),
    ];
    const built = (run: number, imported: number, floor?: number): File => {
      const base = file(run, imported + 2, { a: 1 });
      return {
        build: base.build,
        file: {
          results: [...base.file.results, ...rowsOf(run, imported, floor)],
        },
      };
    };

    it("keeps the rows of the import and the floor on the build's column, draws no chart of the floor, and keeps no other count", async () => {
      const { shape, readBuilds, readGlossary } =
        await script<Stacked>("perf-stacked.mjs");
      const data = await mkdtemp(join(tmpdir(), "perf-stacked-data-"));
      scratch.push(data);
      const day = join(data, "runtime", "2026", "11", "20");
      await mkdir(day, { recursive: true });
      await writeFile(
        join(day, "1-aaaaaa1-push.json"),
        JSON.stringify(built(1, 20, 1).file),
      );
      const [read] = readBuilds(data, readGlossary()) as [File];
      const names = (read.file.results as { name: string }[]).map(
        ({ name }) => name,
      );
      assert.ok(names.includes(`${KEY}/count/graph.quadsvisited`));
      assert.ok(names.includes("floor-synthea-10y/parse"));
      assert.ok(!names.includes(`${KEY}/count/probe.calls`));
      const charts = shape([read]);
      assert.deepEqual(
        charts.map(({ key }) => key),
        [KEY],
      );
      const column = (charts[0] as Chart).columns[0] as Column & {
        speed?: { imported: number; floor?: { total: number } };
      };
      assert.equal(column.speed?.imported, 20);
      assert.equal(column.speed?.floor?.total, 1);
    });

    it("writes, under the chart of the fresh import, the line of the latest build that has a floor and a table of the newest builds' counts and rates", async () => {
      const { shape, stackedPage } = await script<Stacked>("perf-stacked.mjs");
      const charts = shape([built(1, 20, 2), built(2, 30, 3), built(3, 40)]);
      const page = stackedPage(charts, { repo: "owner/repo" });
      assert.match(
        page,
        /Import takes 30\.0 s; a plain load of the same input into SQLite takes 3\.00 s \(10x\)\./,
      );
      assert.doesNotMatch(page, /Import takes 40/);
      const table =
        /<table class="speed">[\s\S]*?<\/table>/.exec(page)?.[0] ?? "";
      assert.equal((table.match(/<tr>/g) ?? []).length, 1 + 3);
      assert.match(table, /<th[^>]*>Answer-file lines<\/th>/);
      assert.match(table, /<td[^>]*>5,000<\/td>/);
      assert.match(table, /<td[^>]*>1,000<\/td>/);
      assert.match(page, /maps nothing to the Cascade vocabulary/);
      assert.doesNotMatch(page, /floor-synthea-10y/);
    });

    it("writes no line and no table for a chart none of whose builds measured the import's parts", async () => {
      const { shape, stackedPage } = await script<Stacked>("perf-stacked.mjs");
      const page = stackedPage(shape([file(1, 3, { a: 1 })]), {
        repo: "owner/repo",
      });
      assert.doesNotMatch(page, /Import takes/);
      assert.doesNotMatch(page, /class="speed"/);
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
