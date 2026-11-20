import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  probing,
  recorded,
  type SpanEvent,
  timed,
  timedAside,
  timedSync,
} from "@cascade-runtime/runtime/probe";
import { explainSpan, explain } from "./perf-glossary.js";
import { keptCpu, part, probedRows, tabulated } from "./perf-report.js";
import { chromeTrace, selfTimes } from "./perf-trace.js";

const script = async <T>(name: string): Promise<T> =>
  (await import(
    pathToFileURL(
      fileURLToPath(new URL(`../../../../scripts/${name}`, import.meta.url)),
    ).href
  )) as T;

interface Flame {
  summary(flame: object, options?: object): string;
  openIn(viewer: string, file: string, title: string): string;
}
interface Runs {
  runsIn(data: string): { folder: string; id: string; event: string }[];
  pages(options: object): { id: string; kept: Set<string> }[];
}
interface Compare {
  compare(before: object, after: object, options?: object): string;
  summary(file: object, options?: object): string;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const event = (
  name: string,
  start: number,
  end: number,
  parent = -1,
  track?: string,
): SpanEvent => ({ name, start, end, parent, ...(track && { track }) });

const scratch: string[] = [];
const folder = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), "perf-flame-test-"));
  scratch.push(made);
  return made;
};

/**
 * The flame graphs of a build: a traced probe that gives every call with the call it ran inside, the trace file and the
 * own times drawn from those calls, the CPU profiles kept with their workers' beside them, and the pages that serve
 * them.
 */
describe("Flame graphs of a build · perf-trace.ts, perf-flame.mjs, perf-runs.mjs", () => {
  after(async () => {
    await Promise.all(
      scratch.map((each) => rm(each, { recursive: true, force: true })),
    );
  });

  describe("given spans that run at the same time, inside one that began first", () => {
    it("gives each call the span it was called inside of, not the last one begun, and a worker's step as the child of the span that waited for it", async () => {
      const { seen } = await probing(
        async () => {
          await timed("outer", async () => {
            await Promise.all([
              timed("a", async () => {
                await sleep(20);
                await timedAside("a.inner", () => sleep(10));
              }),
              timed("b", () => sleep(15)),
            ]);
            await timedAside("waits", async () => {
              await sleep(5);
              recorded("elsewhere", 3, 1, {
                track: "a worker",
                start: performance.now(),
              });
            });
            timedSync("sync", () => undefined);
          });
        },
        { trace: true },
      );
      const events = seen.events ?? [];
      const at = (name: string) => events.findIndex((e) => e.name === name);
      const parentOf = (name: string) =>
        events[(events[at(name)] as SpanEvent).parent]?.name;
      assert.equal(parentOf("outer"), undefined);
      assert.equal(parentOf("a"), "outer");
      assert.equal(parentOf("b"), "outer");
      assert.equal(parentOf("a.inner"), "a");
      assert.equal(parentOf("elsewhere"), "waits");
      assert.equal(parentOf("sync"), "outer");
      assert.equal(events[at("elsewhere")]?.track, "a worker");
      assert.ok(events.every((each) => each.end >= each.start));
    });

    it("keeps no event when the run is not traced, and the same times as before", async () => {
      const { seen } = await probing(() => timed("x", () => sleep(5)));
      assert.equal(seen.events, undefined);
      assert.equal(seen.spans.get("x")?.calls, 1);
    });
  });

  describe("given calls that overlap and calls inside calls", () => {
    // outer 0-100 holds a 10-30 and b 20-50, which overlap; c 60-70 is alone.
    const events = [
      event("outer", 0, 100),
      event("a", 10, 30, 0),
      event("b", 20, 50, 0),
      event("c", 60, 70, 0),
      event("c", 80, 90, 0),
    ];

    it("takes a span's own time as the time none of the calls inside it were running, once where its calls overlap", () => {
      const own = selfTimes(events);
      assert.equal(own.get("outer"), 100 - 40 - 10 - 10);
      assert.equal(own.get("a"), 20);
      assert.equal(own.get("b"), 30);
      assert.equal(own.get("c"), 20);
    });

    it("counts the time some call of a name was running once when two calls of it run together", () => {
      const own = selfTimes([
        event("seal", 0, 80),
        event("seal", 0, 80),
        event("seal", 100, 140),
      ]);
      assert.equal(own.get("seal"), 120);
    });

    it("puts calls that nest on one track and a call that does not nest on a track beside it, each track properly nested", () => {
      const { file } = chromeTrace(events, { title: "t", says: () => "s" });
      const drawn = file.traceEvents.filter(
        (
          each,
        ): each is {
          ph: "X";
          tid: number;
          ts: number;
          dur: number;
          name: string;
        } => (each as { ph: string }).ph === "X",
      );
      assert.equal(drawn[0]?.name, "t");
      assert.ok(new Set(drawn.map(({ tid }) => tid)).size >= 2);
      // a (10-30) and b (20-50) overlap without nesting, so they are on two tracks.
      const track = (name: string) => drawn.find((e) => e.name === name)?.tid;
      assert.notEqual(track("a"), track("b"));
      assert.equal(track("outer"), track("a"));
      for (const tid of new Set(drawn.map((each) => each.tid))) {
        const open: number[] = [];
        for (const each of drawn.filter((e) => e.tid === tid)) {
          while (open.length > 0 && (open.at(-1) as number) <= each.ts)
            open.pop();
          assert.ok(
            open.length === 0 || each.ts + each.dur <= (open.at(-1) as number),
            `${each.name} does not nest on track ${tid}`,
          );
          open.push(each.ts + each.dur);
        }
      }
    });

    it("writes whole microseconds, no args that would split one step into many frames in speedscope, and the glossary's words once in otherData", () => {
      const { file } = chromeTrace(
        events.map((each) => ({
          ...each,
          start: each.start + 0.0004,
          end: each.end + 0.0004,
        })),
        { title: "t", says: (name) => `says ${name}` },
      );
      for (const each of file.traceEvents as Record<string, unknown>[]) {
        assert.ok(!("args" in each) || each.ph === "M");
        if (each.ph === "X")
          assert.ok(Number.isInteger(each.ts) && Number.isInteger(each.dur));
      }
      assert.deepEqual(file.otherData.says, {
        outer: "says outer",
        a: "says a",
        b: "says b",
        c: "says c",
      });
    });

    it("leaves out the shortest calls past a limit and says so, their time staying their parent's own", () => {
      const trace = chromeTrace(events, {
        title: "t",
        says: () => undefined,
        maxEvents: 3,
      });
      assert.equal(trace.seen, 5);
      assert.ok(trace.kept <= 3 && trace.kept >= 2);
      assert.ok(trace.shortestMs >= 10);
      assert.match(String(trace.file.otherData.leftOut), /not drawn/);
    });

    it("draws a call measured elsewhere on a track of its own name", () => {
      const { file } = chromeTrace(
        [event("outer", 0, 100), event("step", 10, 40, 0, "a worker")],
        { title: "t", says: () => undefined },
      );
      const names = (
        file.traceEvents as { name: string; args?: { name: string } }[]
      )
        .filter((each) => each.name === "thread_name")
        .map((each) => each.args?.name);
      assert.ok(names.includes("a worker"), names.join());
    });
  });

  describe("given a probed run with its calls", () => {
    it("writes a row of own time for each span, under the name its stage row has, and says what it is", async () => {
      const { seen } = await probing(
        async () => {
          await timed("question:pod/My lab results", async () => {
            await sleep(15);
            await timedAside("files.read.file", () => sleep(10));
          });
        },
        { trace: true },
      );
      const rows = probedRows("close-synthea-10y", tabulated(seen));
      const self = rows.find(
        ({ name }) =>
          name === "close-synthea-10y/self/question-pod-my-lab-results",
      );
      assert.ok(self !== undefined, rows.map(({ name }) => name).join());
      assert.ok(self.value >= 0.012 && self.value < 0.05, String(self.value));
      const stage = rows.find(
        ({ name }) =>
          name === "close-synthea-10y/stage/question-pod-my-lab-results",
      );
      assert.ok((stage?.value ?? 0) > self.value);
      assert.ok(explain(self.name) !== undefined);
      assert.match(explain(self.name) ?? "", /Own time/);
    });

    it("says what a span is in the glossary's words, by its name as a row has it", () => {
      assert.ok(explainSpan(part("core-pod.step.commit")) !== undefined);
    });

    it("has no own-time row for a run that was not traced", async () => {
      const { seen } = await probing(() => timed("x", () => sleep(2)));
      assert.ok(
        probedRows("close-x", tabulated(seen)).every(
          ({ name }) => !name.includes("/self/"),
        ),
      );
    });
  });

  describe("given the profiles node wrote for a process and its worker threads", () => {
    it("keeps the main thread's as <name>.cpuprofile and each worker's by the script it ran, numbered when one script ran twice", async () => {
      const from = await folder();
      const into = await folder();
      const profile = (url: string) =>
        JSON.stringify({
          nodes: [{ callFrame: { url: `file:///x/dist/${url}` } }],
        });
      await writeFile(
        join(from, "CPU.20261120.1.77.0.001.cpuprofile"),
        profile("test/perf-report.js"),
      );
      await writeFile(
        join(from, "CPU.20261120.2.77.2.002.cpuprofile"),
        profile("src/node/wasm-worker.js"),
      );
      await writeFile(
        join(from, "CPU.20261120.3.77.3.003.cpuprofile"),
        profile("src/node/wasm-worker.js"),
      );
      await writeFile(
        join(from, "CPU.20261120.4.77.10.004.cpuprofile"),
        profile("src/node/pod-database-worker.js"),
      );
      const note = await keptCpu(from, into, "fresh-first-screen-synthea-10y");
      assert.equal(note.file, "fresh-first-screen-synthea-10y.cpuprofile");
      assert.deepEqual(
        note.workers.map(({ file }) => file),
        [
          "fresh-first-screen-synthea-10y.wasm-worker.cpuprofile",
          "fresh-first-screen-synthea-10y.wasm-worker-2.cpuprofile",
          "fresh-first-screen-synthea-10y.pod-database-worker.cpuprofile",
        ],
      );
      assert.ok(existsSync(join(into, note.workers[2]?.file as string)));
    });
  });

  describe("given the list of a build's flame graph files", () => {
    const build = (scenario: string, dataset = "synthea-10y") => ({
      name: `${scenario}-${dataset}`,
      scenario,
      dataset,
      encrypted: false,
      trace: {
        file: `${scenario}-${dataset}.trace.json`,
        bytes: 1_500_000,
        calls: 100,
        drawn: 100,
        shortestMs: 0,
        top: [1, 2, 3, 4, 5, 6].map((at) => ({
          name: `step.${at}`,
          selfMs: 1000 - at * 100,
          calls: at,
        })),
      },
      cpu: {
        file: `${scenario}-${dataset}.cpuprofile`,
        bytes: 700_000,
        workers: [],
      },
    });
    const flame = { builds: [build("fresh-first-screen"), build("close")] };

    it("names each scenario's five longest steps and, for a pull request, says to download the files and drop them in the viewer", async () => {
      const { summary } = await script<Flame>("perf-flame.mjs");
      const text = summary(flame, {
        markdown: true,
        download: "https://example.test/artifact/1",
        viewer: "https://site.test/perf/speedscope/",
      });
      assert.match(text, /\*\*fresh-first-screen on synthea-10y\*\*/);
      assert.equal((text.match(/`step\.\d`/g) ?? []).length, 10);
      assert.doesNotMatch(text, /step\.6/);
      assert.match(text, /\| `step\.1` \| 900 ms \| 1 \|/);
      assert.match(text, /\(https:\/\/example\.test\/artifact\/1\)/);
      assert.match(text, /drop a `\.trace\.json`/);
    });

    it("links each file for a build on main straight into the viewer, the file's address encoded as speedscope reads it", async () => {
      const { summary, openIn } = await script<Flame>("perf-flame.mjs");
      const files =
        "https://raw.example.test/runtime/2026/11/20/1-abcdef0-push";
      const viewer = "https://site.test/perf/speedscope/";
      const text = summary(flame, { markdown: true, files, viewer });
      const link = openIn(
        viewer,
        `${files}/fresh-first-screen-synthea-10y.trace.json`,
        "Where the time went: fresh-first-screen on synthea-10y",
      );
      assert.ok(text.includes(`[Where the time went](${link})`));
      assert.match(
        link,
        /#profileURL=https%3A%2F%2Fraw\.example\.test%2F.*&title=/,
      );
      assert.doesNotMatch(text, /drop a/);
    });

    it("says that a close's CPU profile is the whole fresh run", async () => {
      const { summary } = await script<Flame>("perf-flame.mjs");
      const text = summary(
        {
          builds: [
            {
              ...build("close"),
              cpu: {
                ...build("close").cpu,
                file: "fresh-first-screen-synthea-10y.cpuprofile",
                processOf: "fresh-first-screen",
              },
            },
          ],
        },
        { markdown: true },
      );
      assert.match(text, /whole fresh run; the close is its last step/);
    });
  });

  describe("given the perf-data branch holding the builds' folders", () => {
    const put = async (
      data: string,
      day: string,
      id: string,
      event: string,
      datasets: string[],
    ) => {
      const dir = join(data, "runtime", day, `${id}-${event}`);
      await mkdir(dir, { recursive: true });
      const builds = datasets.map((dataset) => ({
        name: `close-${dataset}`,
        scenario: "close",
        dataset,
        encrypted: false,
        trace: {
          file: `close-${dataset}.trace.json`,
          bytes: 10,
          calls: 1,
          drawn: 1,
          shortestMs: 0,
          top: [],
        },
        cpu: { file: `close-${dataset}.cpuprofile`, bytes: 10, workers: [] },
      }));
      await writeFile(join(dir, "flame.json"), JSON.stringify({ builds }));
      for (const dataset of datasets) {
        await writeFile(join(dir, `close-${dataset}.trace.json`), "{}");
        await writeFile(join(dir, `close-${dataset}.cpuprofile`), "{}");
      }
      await writeFile(`${dir}.json`, JSON.stringify({ results: [] }));
    };

    it("lists them newest first and serves the viewer, the newest builds' files, an index of them, and a link to it from the history page", async () => {
      const { runsIn, pages } = await script<Runs>("perf-runs.mjs");
      const data = await folder();
      const out = await folder();
      const viewer = await folder();
      await writeFile(join(viewer, "index.html"), "<html></html>");
      await writeFile(join(viewer, "perf-vertx-stacks-01.txt"), "a sample");
      await writeFile(join(viewer, "LICENSE-given"), "MIT");
      await writeFile(
        join(out, "index.html"),
        '<body><header id="header"></header></body>',
      );
      await put(data, "2026/11/19", "100-aaaaaaa", "push", ["synthea-10y"]);
      await put(data, "2026/11/20", "300-ccccccc", "push", ["synthea-10y"]);
      await put(data, "2026/11/20", "200-bbbbbbb", "schedule", [
        "synthea-10y",
        "synthea-lifetime",
      ]);
      assert.deepEqual(
        runsIn(data).map(({ id }) => id),
        ["300-ccccccc", "200-bbbbbbb", "100-aaaaaaa"],
      );
      const kept = pages({
        data,
        out,
        viewerFolder: viewer,
        viewerLicense: join(viewer, "LICENSE-given"),
        repo: "owner/repo",
        pagesAt: "https://owner.github.io/repo/perf",
        keep: 2,
        keepLarge: 0,
      });
      assert.deepEqual(
        kept.map(({ id }) => id),
        ["300-ccccccc", "200-bbbbbbb"],
      );
      assert.ok(existsSync(join(out, "speedscope", "index.html")));
      assert.ok(existsSync(join(out, "speedscope", "LICENSE")));
      assert.ok(
        !existsSync(join(out, "speedscope", "perf-vertx-stacks-01.txt")),
      );
      assert.ok(
        existsSync(
          join(out, "runs", "300-ccccccc", "close-synthea-10y.trace.json"),
        ),
      );
      assert.ok(
        existsSync(
          join(out, "runs", "200-bbbbbbb", "close-synthea-10y.cpuprofile"),
        ),
      );
      assert.ok(
        !existsSync(
          join(out, "runs", "200-bbbbbbb", "close-synthea-lifetime.trace.json"),
        ),
      );
      assert.ok(!existsSync(join(out, "runs", "100-aaaaaaa")));
      const index = await readFile(join(out, "runs", "index.html"), "utf8");
      assert.ok(index.indexOf("run 300") !== -1);
      assert.ok(index.indexOf("run 300") < index.indexOf("run 200"));
      assert.match(
        index,
        /#profileURL=https%3A%2F%2Fowner\.github\.io%2Frepo%2Fperf%2Fruns%2F300-ccccccc%2Fclose-synthea-10y\.trace\.json/,
      );
      assert.match(index, /not kept, it is large/);
      assert.match(
        await readFile(join(out, "index.html"), "utf8"),
        /<a href="runs\/">/,
      );
    });
  });

  describe("given two files with the own time of a step", () => {
    const row = (name: string, value: number) => ({
      name,
      unit: "s",
      value,
      kind: "clock",
      samples: 1,
      range: `${value}-${value}`,
    });
    const file = (own: number) => ({
      env: { os: "linux", runner: "ci; cpu", cpus: 4, node: "24.0.0" },
      commit: {},
      results: [
        row("close-synthea-10y/total", 1),
        row("close-synthea-10y/stage/a", 1),
        row("close-synthea-10y/self/a", own),
        row("close-synthea-10y/self/b", 0.1),
      ],
    });

    it("ranks the steps whose own time moved, apart from the stages, in a comparison and in a summary", async () => {
      const { compare, summary } = await script<Compare>("perf-compare.mjs");
      const text = compare(file(0.5), file(0.25));
      assert.match(text, /Steps whose own time moved most/i);
      assert.match(text, /close-synthea-10y\/self\/a\s+500 ms\s+250 ms\s+-50%/);
      const listed = summary(file(0.5));
      assert.match(listed, /longest own time/i);
      assert.match(listed, /a\s+500 ms/);
    });

    it("keeps the longest own times for the history page beside the longest stages", async () => {
      const { forHistory } = await script<{
        forHistory(file: object, options?: object): { name: string }[];
      }>("perf-history.mjs");
      const names = forHistory(file(0.5), { stages: 1 }).map(
        ({ name }) => name,
      );
      assert.deepEqual(names, [
        "close-synthea-10y/total",
        "close-synthea-10y/stage/a",
        "close-synthea-10y/self/a",
      ]);
    });
  });
});
