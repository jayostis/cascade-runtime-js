import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-run-"));
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
const log = join(folder, "children.jsonl");
process.env.CASCADE_EVALS_TRANSCRIPTS = join(folder, "transcripts");
process.env.CASCADE_EVALS_WORK = join(folder, "work");
process.env.CASCADE_EVALS_CLAUDE = fixture("fake-claude.mjs");
process.env.FAKE_CLAUDE_LOG = log;
const { configureTables, openPod } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { childOf, giveBack, resolveClaude, runEval, showRun } =
  await import("../src/run.js");
const { loadPlan, subjectPrompt } = await import("../src/plan.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const MODEL = "claude-haiku-5-5";
const JOBS = [
  {
    id: "tamsin-vale.worries.records.haiku-5-5.r1",
    arm: "records",
    q: "allergies",
  },
  { id: "tamsin-vale.worries.pod.haiku-5-5.r1", arm: "pod", q: "blood-clot" },
] as const;

/** The one pod and the one set of downloads every planned run names: no child opens the pod and none writes the downloads. */
const pods = join(folder, "pods");
await (await openPod(join(pods, "tamsin-vale"), { title: "t" })).close();
const downloads = join(folder, "downloads");
const { reading } = JSON.parse(
  await readFile(fixture("../../cases/tamsin-vale/case.json"), "utf8"),
) as { reading: string[] };
for (const file of reading) {
  await mkdir(dirname(join(downloads, file)), { recursive: true });
  await writeFile(join(downloads, file), "{}");
}

/**
 * A planned run of the two jobs (Tamsin's worries session, one question each, on each arm), nothing run yet. It also
 * sets `FAKE_CLAUDE_FILES` for this run's tags and writes a valid `verdict.json` for a judge: both are global, so the
 * `runEval` that follows stays in the same `before`.
 */
async function planned(
  name: string,
  cap: { tokens: number },
  options: { judges?: boolean; concurrency?: number; estimate?: number } = {},
) {
  const { judges = true, concurrency = 2, estimate = 1_000_000 } = options;
  const run = join(folder, name);
  await mkdir(join(run, "prompts"), { recursive: true });
  const jobs = [];
  for (const { id, arm, q } of JOBS) {
    await mkdir(join(run, "answers", id), { recursive: true });
    await writeFile(
      join(run, "prompts", `${id}.txt`),
      subjectPrompt({
        folder: run,
        jobId: id,
        tag: `${name}/${id}`,
        arm,
        name: "Tamsin Vale",
        pronoun: "her",
        today: "2026-01-01",
        downloads,
        reading,
        pod: "tamsin-vale",
      }),
    );
    jobs.push({
      id,
      role: "subject",
      case: "tamsin-vale",
      session: "worries",
      questions: [q],
      arm,
      model: MODEL,
      alias: "haiku",
      repeat: 1,
      tag: `${name}/${id}`,
      inputsHash: id,
      status: "pending",
      estimate: { tokens: estimate, usd: 1 },
      answers: `answers/${id}`,
      prompt: `prompts/${id}.txt`,
    });
  }
  await writeFile(
    join(run, "plan.json"),
    JSON.stringify({
      run: name,
      folder: run,
      created: new Date().toISOString(),
      config: {
        tier: "custom",
        cases: ["tamsin-vale"],
        arms: ["pod", "records"],
        subjects: [MODEL],
        repeats: 1,
        judges: judges ? [MODEL] : [],
        cap: { ...cap, usd: 100 },
        concurrency,
      },
      configSha256: "",
      harness: { commit: "0000000", uncommitted: 0 },
      podCommits: { packages: {}, components: [] },
      prompts: {},
      cases: [
        {
          id: "tamsin-vale",
          downloadsSha256: "",
          keySha256: "",
          prepared: {
            case: "tamsin-vale",
            downloads,
            downloadsSha256: "",
            pods,
            pod: "tamsin-vale",
            components: [],
            imports: [],
            documents: [],
          },
        },
      ],
      jobs,
      estimate: { tokens: 2 * estimate, usd: 2 },
      fitsCap: true,
    }),
  );
  const verdict = join(folder, "verdict.json");
  await writeFile(verdict, JSON.stringify({ outputs: [] }));
  process.env.FAKE_CLAUDE_FILES = JSON.stringify({
    [`${name}/${JOBS[0].id}`]: {
      [join(run, "answers", JOBS[0].id, "allergies.json")]: fixture(
        "smoke-answers/records-allergies.json",
      ),
    },
    [`${name}/${JOBS[1].id}`]: {
      [join(run, "answers", JOBS[1].id, "blood-clot.json")]: fixture(
        "smoke-answers/pod-blood-clot.json",
      ),
    },
    judge: { "verdict.json": verdict },
  });
  return run;
}

interface Start {
  args: string[];
  cwd: string;
  prompt: string;
  tag: string;
  memory?: string;
}
/** Every child started so far, from the fake `claude`'s one log: read it in a `before`, never in a leaf. */
const starts = async (): Promise<Start[]> =>
  existsSync(log)
    ? (await readFile(log, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Start)
    : [];
const flag = (args: readonly string[], name: string) =>
  args[args.indexOf(`--${name}`) + 1];
/** The rules after `--allowedTools`, each its own argument, up to the next flag. */
const rulesOf = (args: readonly string[]) => {
  const rest = args.slice(args.indexOf("--allowedTools") + 1);
  const end = rest.findIndex((it) => it.startsWith("--"));
  return end < 0 ? rest : rest.slice(0, end);
};

const quiet = () => undefined;
type Shown = Awaited<ReturnType<typeof showRun>>;
type Done = Awaited<ReturnType<typeof runEval>>;
const tagOf = (name: string, at: 0 | 1) => `${name}/${JOBS[at].id}`;
const statusOf = async (run: string) =>
  (await showRun({ run, log: quiet })).jobs.map((it) => it.status);
const statuses = (done: Shown | Done) => done.jobs.map((it) => it.status);

/** What a promise rejected with, or `undefined` when it did not reject. */
const attempt = (work: Promise<unknown>): Promise<unknown> =>
  work.then(
    () => undefined,
    (error: unknown) => error,
  );
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "nothing was thrown";

/** Runs `work` with these environment variables set, and puts each back as it was, also when `work` throws. */
async function withEnv<T>(
  set: Record<string, string>,
  work: () => Promise<T>,
): Promise<T> {
  const was = Object.keys(set).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, set);
  try {
    return await work();
  } finally {
    for (const [key, value] of was)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
const exiting = (exit: Record<string, object>) => ({
  FAKE_CLAUDE_EXIT: JSON.stringify(exit),
});

interface PlanJson {
  jobs: {
    status: string;
    dispatched?: boolean;
    questions: string[];
    answers: string;
    stats?: unknown;
    abandoned?: unknown[];
  }[];
}
const readPlan = async (run: string) =>
  JSON.parse(await readFile(join(run, "plan.json"), "utf8")) as PlanJson;
const writePlan = (run: string, plan: PlanJson) =>
  writeFile(join(run, "plan.json"), JSON.stringify(plan));

/** The whole eval of two subjects and a judge, run once for the leaves of two situations. */
interface TwoJobs {
  run: string;
  plan: Awaited<ReturnType<typeof loadPlan>>;
  made: Start[];
  done: Done;
  results:
    | { jobs: { id: string; status: string; stats?: { calls: number } }[] }
    | undefined;
  startedAfterSecondGo: number;
}
let twoJobsRun: Promise<TwoJobs> | undefined;
const twoJobs = () =>
  (twoJobsRun ??= (async (): Promise<TwoJobs> => {
    await rm(log, { force: true });
    const run = await planned("two-jobs", { tokens: 10_000_000 });
    const done = await runEval({ run, log: quiet });
    const made = await starts();
    const plan = await loadPlan(run);
    const file = join(run, "results.json");
    const results = existsSync(file)
      ? (JSON.parse(await readFile(file, "utf8")) as TwoJobs["results"])
      : undefined;
    await runEval({ run, log: quiet });
    const startedAfterSecondGo = (await starts()).length;
    return { run, plan, made, done, results, startedAfterSecondGo };
  })());

/**
 * `showRun()` is `run --config <tier>`: it shows a run's jobs and their estimate against the cap. `runEval()` is the same
 * with `--go`: it runs them, in waves, through the judges to `finish`.
 */
describe("Running a whole eval with one command · showRun(), runEval()", () => {
  describe("showRun({ run })", () => {
    let shown: Shown;
    let started: Start[];
    let mismatch: unknown;

    before(async () => {
      await rm(log, { force: true });
      const run = await planned("dry", { tokens: 10_000_000 });
      shown = await showRun({ run, log: quiet });
      started = await starts();
      mismatch = await attempt(showRun({ config: "smoke", run, log: quiet }));
    });

    it("returns every job of the plan with its status, each `pending` before any `--go`", () => {
      assert.deepEqual(
        shown.jobs.map((it) => [it.id, it.status]),
        JOBS.map(({ id }) => [id, "pending"]),
      );
    });

    it("returns the run's estimate beside its cap, and whether it fits", () => {
      assert.deepEqual(shown.estimate, { tokens: 2_000_000, usd: 2 });
      assert.equal(shown.cap.tokens, 10_000_000);
      assert.equal(shown.fitsCap, true);
    });

    it("starts no child", () => {
      assert.deepEqual(started, []);
    });

    it("throws for a `config` other than the one the run was planned from", () => {
      assert.match(messageOf(mismatch), /another config/);
    });
  });

  describe("runEval({ run })", () => {
    let result: TwoJobs;

    before(async () => {
      result = await twoJobs();
    });

    it("starts one child for each subject's job and one for the judge", () => {
      const judge = result.plan.jobs.find((it) => it.role === "judge")!;
      assert.ok(judge.tag.includes(".judge."), judge.tag);
      assert.deepEqual(
        result.made.map((it) => it.tag).sort(),
        [tagOf("two-jobs", 0), tagOf("two-jobs", 1), judge.tag].sort(),
      );
    });

    it("takes every job to `done`", () => {
      assert.deepEqual(statuses(result.done), ["done", "done", "done"]);
    });

    it("writes `results.json` with every job in it, each with its model calls counted", () => {
      assert.ok(result.results !== undefined, "results.json is written");
      assert.equal(result.results.jobs.length, 3);
      assert.ok(result.results.jobs.every((it) => it.stats?.calls === 1));
    });

    it("starts no child for a run that is finished", () => {
      assert.equal(result.startedAfterSecondGo, 3);
    });
  });

  /**
   * One child at a time, each spending about 6,200 tokens against an estimate of 1,000: the second would pass 7,000.
   */
  describe("when the next job would pass the cap", () => {
    let started: Start[];
    let done: Done;

    before(async () => {
      await rm(log, { force: true });
      const run = await planned(
        "capped",
        { tokens: 7_000 },
        { judges: false, concurrency: 1, estimate: 1_000 },
      );
      done = await runEval({ run, log: quiet });
      started = await starts();
    });

    it("starts no child for that job", () => {
      assert.equal(started.length, 1);
    });

    it("marks that job `skipped`, with the cap as its reason", () => {
      assert.deepEqual(
        done.jobs.map((it) => [it.status, it.reason]),
        [
          ["done", undefined],
          ["skipped", "the cap"],
        ],
      );
    });
  });
});

/**
 * Each job runs as one `claude -p` child that is given only the tools its prompt names and none of the machine's own
 * setup, so neither arm is helped by where it ran.
 */
describe("Confining a child to its job · childOf(), resolveClaude()", () => {
  describe("given the children `runEval()` starts for a subject on each arm and a judge", () => {
    let result: TwoJobs;
    const job = (start: Start) =>
      result.plan.jobs.find((it) => it.tag === start.tag)!;
    const byTag = (tag: string) => result.made.find((it) => it.tag === tag)!;
    /** The commands a child's prompt names, once each, as `node "…" (ask|pod) --run "…" --job <id>`. */
    const named = (start: Start) => [
      ...new Set(
        [
          ...start.prompt.matchAll(
            new RegExp(
              `node "[^"]+" (?:ask|pod) --run "[^"]+" --job ${job(start).id.replaceAll(".", "\\.")}`,
              "g",
            ),
          ),
        ].map((it) => it[0]),
      ),
    ];
    const bashRules = (start: Start) =>
      rulesOf(start.args).filter((it) => it.startsWith("Bash("));

    before(async () => {
      result = await twoJobs();
    });

    it("starts each as `claude -p` with its job's model", () => {
      assert.equal(result.made.length, 3);
      for (const start of result.made) {
        assert.ok(start.args.includes("-p"), start.tag);
        assert.equal(flag(start.args, "model"), "haiku", start.tag);
      }
    });

    it("gives each only the tools of its kind: Read, Write and Bash on the records arm, Bash and Write on the pod arm, Read and Write for a judge", () => {
      assert.equal(
        flag(byTag(tagOf("two-jobs", 0)).args, "tools"),
        "Read,Write,Bash",
      );
      assert.equal(
        flag(byTag(tagOf("two-jobs", 1)).args, "tools"),
        "Bash,Write",
      );
      assert.equal(
        flag(
          result.made.find((it) => it.tag.includes(".judge."))!.args,
          "tools",
        ),
        "Read,Write",
      );
    });

    it("allows the tools it gives, and no other", () => {
      for (const start of result.made)
        assert.equal(
          [
            ...new Set(
              rulesOf(start.args).map((it) =>
                it.startsWith("Bash(") ? "Bash" : it,
              ),
            ),
          ].join(","),
          flag(start.args, "tools"),
          start.tag,
        );
    });

    it("passes every flag that keeps the machine's setup out", () => {
      for (const start of result.made)
        for (const isolating of [
          "--safe-mode",
          "--restricted",
          "--strict-mcp-config",
          "--disable-slash-commands",
        ])
          assert.ok(
            start.args.includes(isolating),
            `${start.tag} ${isolating}`,
          );
    });

    it("sets the permission mode `dontAsk`", () => {
      for (const start of result.made)
        assert.equal(flag(start.args, "permission-mode"), "dontAsk", start.tag);
    });

    it("turns Claude Code's own memory off", () => {
      for (const start of result.made)
        assert.equal(start.memory, "1", start.tag);
    });

    it("denies the tools no child may use, each by name", () => {
      for (const start of result.made) {
        const denied = flag(start.args, "disallowedTools")!.split(",");
        for (const tool of [
          "Agent",
          "WebFetch",
          "WebSearch",
          "Edit",
          "Glob",
          "Grep",
        ])
          assert.ok(denied.includes(tool), `${start.tag} denies ${tool}`);
      }
    });

    // The claude this harness runs warns in every log about a tool name it does not know.
    it("names no tool that this `claude` does not know", () => {
      for (const start of result.made) {
        const denied = flag(start.args, "disallowedTools")!.split(",");
        for (const unknown of ["MultiEdit", "SlashCommand"])
          assert.ok(!denied.includes(unknown), `${start.tag} names ${unknown}`);
      }
    });

    it("hands each child its prompt as the run holds it, opening with its tag", async () => {
      for (const start of result.made)
        assert.ok(
          start.prompt.startsWith(`eval-tag: ${start.tag}\n`),
          `${start.tag} opens with its tag`,
        );
      for (const start of result.made.filter(
        (it) => job(it).role === "subject",
      ))
        assert.equal(
          start.prompt,
          await readFile(join(result.run, job(start).prompt!), "utf8"),
          start.tag,
        );
    });

    it("runs each in a folder of its own under the harness's work folder", () => {
      for (const start of result.made)
        assert.ok(start.cwd.startsWith(join(folder, "work")), start.cwd);
      assert.equal(new Set(result.made.map((it) => it.cwd)).size, 3);
    });

    it("allows one Bash rule for each command the child's prompt names, and no other", () => {
      const seen = new Set<string>();
      for (const start of result.made) {
        for (const command of named(start)) seen.add(command);
        assert.equal(bashRules(start).length, named(start).length, start.tag);
      }
      assert.equal(seen.size, 3, "ask for both arms, and pod for one");
    });

    // The judge has no Bash tool, which "gives each only the tools of its kind" shows, so it names no command and has no rule.
    it("allows a subject its `ask` command, and a pod-arm subject its `pod` command with whatever follows", () => {
      for (const start of result.made) {
        const commands = named(start);
        assert.equal(
          commands.some((it) => / ask /.test(it)),
          job(start).role === "subject",
          `${start.tag} names ask`,
        );
        assert.equal(
          commands.some((it) => / pod /.test(it)),
          job(start).arm === "pod",
          `${start.tag} names pod`,
        );
        const rules = rulesOf(start.args);
        for (const command of commands)
          assert.ok(
            rules.includes(`Bash(${command})`) ||
              rules.includes(`Bash(${command} *)`),
            `${command} is not allowed by ${rules.join(" | ")}`,
          );
      }
    });

    it("writes no rule as wide as `Bash(node *)`, and none with a backslash", () => {
      for (const start of result.made)
        for (const rule of bashRules(start))
          assert.ok(
            !/Bash\(node \*\)/.test(rule) && !rule.includes("\\"),
            rule,
          );
    });
  });

  describe("childOf(plan, job, prompt)", () => {
    let result: TwoJobs;

    before(async () => {
      result = await twoJobs();
    });

    it("throws for a run folder with a space in its path", () => {
      assert.throws(
        () =>
          childOf(
            { ...result.plan, folder: join(result.plan.folder, "with space") },
            result.plan.jobs[0]!,
            "",
          ),
        /space/,
      );
    });
  });

  describe("with `CASCADE_EVALS_CHILD_MINUTES` set to something that is not a number", () => {
    let thrown: unknown;
    let started: Start[];

    before(async () => {
      await rm(log, { force: true });
      const run = await planned("minutes", { tokens: 10_000_000 });
      thrown = await withEnv({ CASCADE_EVALS_CHILD_MINUTES: "soon" }, () =>
        attempt(runEval({ run, log: quiet })),
      );
      started = await starts();
    });

    it("throws, naming the variable", () => {
      assert.match(messageOf(thrown), /CASCADE_EVALS_CHILD_MINUTES/);
    });

    it("starts no child", () => {
      assert.deepEqual(started, []);
    });
  });

  describe("resolveClaude(name, platform, path)", () => {
    let script: string;
    let shim: ReturnType<typeof resolveClaude>;
    let beside: ReturnType<typeof resolveClaude>;

    before(async () => {
      const bin = join(folder, "shim-bin");
      script = join(bin, "node_modules", "claude-code", "cli.js");
      await mkdir(dirname(script), { recursive: true });
      await writeFile(script, "");
      await writeFile(
        join(bin, "claude.cmd"),
        String.raw`@ECHO off
"%_prog%"  "%dp0%\node_modules\claude-code\cli.js" %*
`,
      );
      shim = resolveClaude("claude", "win32", bin);
      await writeFile(join(bin, "claude.exe"), "");
      beside = resolveClaude("claude", "win32", bin);
    });

    it("returns node and the script an npm `.cmd` shim names, with a note that says so", () => {
      assert.equal(shim.command, process.execPath);
      assert.deepEqual(shim.prefix, [script]);
      assert.match(shim.note ?? "", /\.cmd shim/);
    });

    it("returns `claude` itself where a `claude.exe` is beside the shim", () => {
      assert.deepEqual(beside, { command: "claude", prefix: [] });
    });
  });
});

/**
 * A child can end without its answers: a usage limit, a lost login, Ctrl-C. Its job is given back, to be run again from
 * the start by the next `--go`, and a wave in which every child fails stops the run.
 */
describe("Giving a job back when its child leaves it unfinished · runEval(), giveBack()", () => {
  describe("when `claude` cannot be started", () => {
    let thrown: unknown;
    let statusesAfter: string[];

    before(async () => {
      await rm(log, { force: true });
      const run = await planned("missing", { tokens: 10_000_000 });
      thrown = await withEnv(
        { CASCADE_EVALS_CLAUDE: join(folder, "no-such-claude.exe") },
        () => attempt(runEval({ run, log: quiet })),
      );
      statusesAfter = await statusOf(run);
    });

    it("throws, saying it could not start", () => {
      assert.match(messageOf(thrown), /could not start/);
    });

    it("leaves every job `pending`", () => {
      assert.deepEqual(statusesAfter, ["pending", "pending"]);
    });
  });

  describe("when one child of a wave exits in an error with nothing answered", () => {
    let done: Done;
    let started: Start[];

    before(async () => {
      await rm(log, { force: true });
      const run = await planned(
        "limit",
        { tokens: 10_000_000 },
        { judges: false },
      );
      done = await withEnv(
        exiting({ [tagOf("limit", 0)]: { code: 1, times: 1 } }),
        () => runEval({ run, log: quiet }),
      );
      started = await starts();
    });

    it("starts that job's child again in the same `--go`", () => {
      assert.equal(started.length, 3, "the failed job ran twice");
    });

    it("takes every job to `done`", () => {
      assert.deepEqual(statuses(done), ["done", "done"]);
    });
  });

  describe("when one child of a wave exits 0 with nothing answered and a refused tool call in its transcript", () => {
    let done: Done;
    let started: Start[];

    before(async () => {
      await rm(log, { force: true });
      const run = await planned(
        "refused",
        { tokens: 10_000_000 },
        { judges: false },
      );
      done = await withEnv(
        exiting({
          [tagOf("refused", 0)]: { code: 0, times: 1, refused: true },
        }),
        () => runEval({ run, log: quiet }),
      );
      started = await starts();
    });

    it("starts that job's child again in the same `--go`", () => {
      assert.equal(started.length, 3, "the refused job ran twice");
    });

    it("takes every job to `done`", () => {
      assert.deepEqual(statuses(done), ["done", "done"]);
    });
  });

  describe("when every child of a wave fails", () => {
    const examples = [
      ["exits in an error", "all-fail", { code: 1, times: 1 }],
      [
        "exits 0 with a refused tool call",
        "refused-all",
        { code: 0, times: 1, refused: true },
      ],
    ] as const;
    const outcomes = new Map<string, { thrown: unknown; statuses: string[] }>();
    let nextGo: string[];

    before(async () => {
      for (const [example, name, exit] of examples) {
        const run = await planned(
          name,
          { tokens: 10_000_000 },
          { judges: false },
        );
        const thrown = await withEnv(
          exiting({ [tagOf(name, 0)]: exit, [tagOf(name, 1)]: exit }),
          () => attempt(runEval({ run, log: quiet })),
        );
        outcomes.set(example, { thrown, statuses: await statusOf(run) });
        if (name === "all-fail")
          nextGo = statuses(await runEval({ run, log: quiet }));
      }
    });

    it("throws, saying every child of the wave failed", () => {
      for (const [example, { thrown }] of outcomes)
        assert.match(messageOf(thrown), /every child/, example);
    });

    it("leaves the wave's jobs `pending`", () => {
      for (const [example, outcome] of outcomes)
        assert.deepEqual(outcome.statuses, ["pending", "pending"], example);
    });

    it("takes them to `done` on the next `--go`", () => {
      assert.deepEqual(nextGo, ["done", "done"]);
    });
  });

  describe("when a child leaves a session part answered", () => {
    const outcomes = new Map<string, { done: Done; asked: string[] }>();

    /** Job 0 has a second question and a file for it; its child writes one answer and then leaves as `exit` says. */
    async function leavingPart(name: string, exit: object) {
      const run = await planned(
        name,
        { tokens: 10_000_000 },
        { judges: false },
      );
      const plan = await readPlan(run);
      plan.jobs[0]!.questions = ["allergies", "second"];
      await writePlan(run, plan);
      const files = JSON.parse(process.env.FAKE_CLAUDE_FILES!) as Record<
        string,
        Record<string, string>
      >;
      files[tagOf(name, 0)]![join(run, "answers", JOBS[0].id, "second.json")] =
        fixture("smoke-answers/records-allergies.json");
      process.env.FAKE_CLAUDE_FILES = JSON.stringify(files);
      const done = await withEnv(
        {
          ...exiting({ [tagOf(name, 0)]: exit }),
          FAKE_CLAUDE_ASKED: join(run, "asked.jsonl"),
        },
        () => runEval({ run, log: quiet }),
      );
      const asked = (await readFile(join(run, "asked.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((it) => JSON.parse(it) as { job: string; question: string })
        .filter((it) => it.job === JOBS[0].id)
        .map((it) => it.question)
        .sort();
      outcomes.set(name, { done, asked });
    }

    before(async () => {
      await leavingPart("partial", { code: 1, times: 1, keep: true });
      await leavingPart("partial-refused", {
        code: 0,
        times: 1,
        keep: true,
        refused: true,
      });
    });

    it("takes the job to `done` in the same `--go`", () => {
      for (const [example, { done }] of outcomes)
        assert.deepEqual(statuses(done), ["done", "done"], example);
    });

    it("hands out every question of the session again, each once", () => {
      assert.deepEqual(outcomes.get("partial")!.asked, ["allergies", "second"]);
    });

    it("counts the tokens of the attempt given back as spent", () => {
      assert.equal(outcomes.get("partial")!.done.spent.tokens, 3 * 6210);
    });
  });

  describe("when a judge's verdict fails its schema", () => {
    let thrown: unknown;
    let stopped: string[];
    let removed: { fromRun: boolean; fromJudge: boolean };
    let done: Done;
    let started: Start[];

    before(async () => {
      await rm(log, { force: true });
      const run = await planned("bad-verdict", { tokens: 10_000_000 });
      const verdict = join(folder, "verdict.json");
      await writeFile(
        verdict,
        JSON.stringify({
          outputs: [
            {
              label: "A",
              items: [],
              beyond: [{ item: -1, verdict: "fair", why: "" }],
              chains: [],
            },
          ],
        }),
      );
      await withEnv({ FAKE_CLAUDE_NO_OVERWRITE: "1" }, async () => {
        thrown = await attempt(runEval({ run, log: quiet }));
        stopped = await statusOf(run);
        const judge = (await loadPlan(run)).jobs.find(
          (it) => it.role === "judge",
        )!;
        removed = {
          fromRun: !existsSync(join(run, judge.verdict!)),
          fromJudge: !existsSync(join(judge.workdir!, "verdict.json")),
        };
        await writeFile(verdict, JSON.stringify({ outputs: [] }));
        done = await runEval({ run, log: quiet });
        started = await starts();
      });
    });

    it("throws, naming the verdict and its schema", () => {
      assert.match(messageOf(thrown), /verdict.*schema/);
    });

    it("returns the judge's job to `pending` and leaves the subjects' jobs `done`", () => {
      assert.deepEqual(stopped, ["done", "done", "pending"]);
    });

    // The judge's own copy goes too, so that a Write that refuses an existing file can write the retried verdict.
    it("removes the verdict from the run's folder and from the judge's own", () => {
      assert.deepEqual(removed, { fromRun: true, fromJudge: true });
    });

    it("starts that judge again on the next `--go`, and takes it to `done`", () => {
      assert.deepEqual(statuses(done), ["done", "done", "done"]);
      assert.equal(started.length, 4, "the judge ran twice");
    });
  });

  describe("when a run was interrupted with jobs handed out", () => {
    let done: Done;

    before(async () => {
      const run = await planned(
        "interrupted",
        { tokens: 10_000_000 },
        { judges: false },
      );
      const plan = await readPlan(run);
      plan.jobs[0]!.status = "dispatched";
      plan.jobs[1]!.status = "running";
      for (const job of plan.jobs) job.dispatched = true;
      await writePlan(run, plan);
      done = await runEval({ run, log: quiet });
    });

    it("takes each to `done` on the next `--go`", () => {
      assert.deepEqual(statuses(done), ["done", "done"]);
    });
  });

  describe("when removing one job's answers throws (`giveBack(folder, which)`)", () => {
    let thrown: unknown;
    let saved: PlanJson;
    let firstAnswer: string;

    before(async () => {
      const run = await planned(
        "giveback-throw",
        { tokens: 10_000_000 },
        { judges: false },
      );
      const plan = await readPlan(run);
      const [first, second] = plan.jobs as [
        PlanJson["jobs"][number],
        PlanJson["jobs"][number],
      ];
      for (const job of [first, second]) {
        job.status = "dispatched";
        job.questions.push("second-question");
      }
      first.stats = { tokens: { total: 7 }, cost: { usd: 1 } };
      await writePlan(run, plan);
      firstAnswer = join(run, first.answers, "allergies.json");
      await writeFile(firstAnswer, "{}");
      // An answer that is a folder cannot be removed as a file: the second job's give-back throws.
      await mkdir(join(run, second.answers, "blood-clot.json"), {
        recursive: true,
      });
      thrown = await attempt(giveBack(run, () => true));
      saved = await readPlan(run);
    });

    it("rejects", () => {
      assert.ok(thrown instanceof Error, "giveBack rejected");
    });

    it("leaves the job given back before it `pending`, with its answer removed", () => {
      assert.equal(saved.jobs[0]!.status, "pending");
      assert.equal(existsSync(firstAnswer), false);
    });

    it("records what that job's attempt spent under `abandoned`", () => {
      assert.deepEqual(saved.jobs[0]!.abandoned, [{ tokens: 7, usd: 1 }]);
    });
  });
});

/**
 * `run.lock` in the run's folder names the process running it, so two `--go` never start the same job.
 */
describe("Keeping one runner on a run · run.lock", () => {
  describe("given a lock that names a live process", () => {
    let thrown: unknown;

    before(async () => {
      const run = await planned(
        "locked-live",
        { tokens: 10_000_000 },
        { judges: false },
      );
      await writeFile(join(run, "run.lock"), String(process.pid));
      thrown = await attempt(runEval({ run, log: quiet }));
    });

    it("throws, saying the run is being run", () => {
      assert.match(messageOf(thrown), /being run/);
    });
  });

  describe("given a lock whose process is gone", () => {
    let done: Done;
    let lockLeft: boolean;

    before(async () => {
      const run = await planned(
        "locked-dead",
        { tokens: 10_000_000 },
        { judges: false },
      );
      await writeFile(join(run, "run.lock"), "2147483646");
      done = await runEval({ run, log: quiet });
      lockLeft = existsSync(join(run, "run.lock"));
    });

    it("takes the run over, to `done`", () => {
      assert.deepEqual(statuses(done), ["done", "done"]);
    });

    it("removes the lock when the run ends", () => {
      assert.equal(lockLeft, false);
    });
  });

  describe("given a lock whose process is gone and whose recorded child is alive", () => {
    let thrown: unknown;
    let started: Start[];

    before(async () => {
      await rm(log, { force: true });
      const run = await planned(
        "orphan",
        { tokens: 10_000_000 },
        { judges: false },
      );
      await writeFile(
        join(run, "run.lock"),
        JSON.stringify({ pid: 2147483646, children: [process.pid] }),
      );
      thrown = await attempt(runEval({ run, log: quiet }));
      started = await starts();
    });

    it("throws, saying a child is still running", () => {
      assert.match(messageOf(thrown), /still running/);
    });

    it("starts no child", () => {
      assert.deepEqual(started, []);
    });
  });
});

describe("Finding the transcript of a job · readTranscript(), transcriptsSince()", () => {
  describe("given children started by `runEval()`", () => {
    let done: Done;
    let made: Start[];
    let spent: number;

    before(async () => {
      await rm(log, { force: true });
      const run = await planned(
        "ids",
        { tokens: 10_000_000 },
        { judges: false },
      );
      const other = join(
        process.env.CASCADE_EVALS_TRANSCRIPTS!,
        "C--elsewhere",
      );
      await mkdir(other, { recursive: true });
      const decoy = (tag: string, model: string) =>
        [
          {
            type: "user",
            timestamp: "2030-01-01T00:00:00.000Z",
            message: { role: "user", content: `eval-tag: ${tag}\n\nhello` },
          },
          {
            type: "assistant",
            timestamp: "2030-01-01T00:00:01.000Z",
            message: {
              id: "m",
              model,
              content: [],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        ]
          .map((it) => JSON.stringify(it))
          .join("\n");
      await writeFile(
        join(other, "5e4ec0a4-0000-4000-8000-000000000001.jsonl"),
        decoy(tagOf("ids", 0), "claude-sonnet-5-5"),
      );
      await writeFile(
        join(other, "5e4ec0a4-0000-4000-8000-000000000002.jsonl"),
        decoy("ids/phantom", "claude-sonnet-5-5"),
      );
      done = await runEval({ run, log: quiet });
      made = await starts();
      spent = done.spent.tokens;
    });

    it("starts each child with a session id of its own", () => {
      const ids = made.map((it) => flag(it.args, "session-id") ?? "");
      for (const id of ids)
        assert.match(
          id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      assert.equal(new Set(ids).size, made.length);
    });

    // The two decoy transcripts, one opening with the first job's tag and one with an unknown tag, are of another session.
    it("charges a job only its own session's transcript, where a later session pasted its tag", () => {
      assert.deepEqual(
        done.jobs.map((it) => [it.id, it.status]),
        JOBS.map(({ id }) => [id, "done"]),
      );
      assert.equal(spent, 2 * 6210);
    });
  });
});
