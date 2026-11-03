import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
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
const { resolveClaude, runEval, showRun } = await import("../src/run.js");
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

/** A planned run of the two jobs (Tamsin's worries session, one question each, on each arm), nothing run yet. */
async function planned(
  name: string,
  cap: { tokens: number },
  options: { judges?: boolean; concurrency?: number; estimate?: number } = {},
) {
  const { judges = true, concurrency = 2, estimate = 1_000_000 } = options;
  const run = join(folder, name);
  const pods = join(folder, `${name}-pods`);
  await (await openPod(join(pods, "tamsin-vale"), { title: "t" })).close();
  await mkdir(join(run, "prompts"), { recursive: true });
  const downloads = join(folder, `${name}-downloads`);
  const { reading } = JSON.parse(
    await readFile(fixture("../../cases/tamsin-vale/case.json"), "utf8"),
  ) as { reading: string[] };
  for (const file of reading) {
    await mkdir(dirname(join(downloads, file)), { recursive: true });
    await writeFile(join(downloads, file), "{}");
  }
  const jobs = [];
  for (const { id, arm, q } of JOBS) {
    await mkdir(join(run, "answers", id), { recursive: true });
    await writeFile(
      join(run, "prompts", `${id}.txt`),
      `eval-tag: ${name}/${id}\n\nYou are a health assistant (${arm}).\n`,
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
const starts = async (): Promise<Start[]> =>
  existsSync(log)
    ? (await readFile(log, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Start)
    : [];
const flag = (args: readonly string[], name: string) =>
  args[args.indexOf(`--${name}`) + 1];

test("run without --go starts no child: it lists the jobs and the estimate against the cap", async () => {
  await rm(log, { force: true });
  const run = await planned("dry", { tokens: 10_000_000 });
  const shown = await showRun({ run, log: () => undefined });
  assert.deepEqual(
    shown.jobs.map((it) => [it.id, it.status]),
    JOBS.map(({ id }) => [id, "pending"]),
  );
  assert.deepEqual(shown.estimate, { tokens: 2_000_000, usd: 2 });
  assert.equal(shown.cap.tokens, 10_000_000);
  assert.equal(shown.fitsCap, true);
  assert.deepEqual(await starts(), []);
});

test("run --go starts one claude -p child per job with the job's model, its arm's tools and the isolation flags, takes the run through its judge to finish, and a second --go starts none", async () => {
  await rm(log, { force: true });
  const run = await planned("two-jobs", { tokens: 10_000_000 });
  const done = await runEval({ run, log: () => undefined });
  const made = await starts();
  assert.equal(made.length, 3, "two subjects and a judge");
  const tools = (start: Start) => flag(start.args, "tools");
  const byTag = (tag: string) => made.find((it) => it.tag === tag)!;
  const records = byTag(`two-jobs/${JOBS[0].id}`);
  const pod = byTag(`two-jobs/${JOBS[1].id}`);
  assert.equal(tools(records), "Read,Write,Bash");
  assert.equal(tools(pod), "Bash,Write");
  assert.equal(
    tools(made.find((it) => it.tag.includes(".judge."))!),
    "Read,Write",
  );
  for (const start of made) {
    assert.ok(start.args.includes("-p"));
    assert.equal(flag(start.args, "model"), "haiku");
    for (const isolating of [
      "--safe-mode",
      "--restricted",
      "--strict-mcp-config",
      "--disable-slash-commands",
    ])
      assert.ok(start.args.includes(isolating), isolating);
    assert.equal(flag(start.args, "permission-mode"), "dontAsk");
    assert.equal(start.memory, "1");
    assert.equal(
      flag(start.args, "allowedTools")!.replace(/Bash\(.*\)/, "Bash"),
      tools(start),
    );
    const denied = flag(start.args, "disallowedTools")!.split(",");
    for (const tool of [
      "Agent",
      "WebFetch",
      "WebSearch",
      "Edit",
      "Glob",
      "Grep",
    ])
      assert.ok(denied.includes(tool), tool);
    assert.ok(
      start.prompt.startsWith(`eval-tag: ${start.tag}\n`),
      "the prompt opens with its tag",
    );
    assert.ok(start.cwd.startsWith(join(folder, "work")), start.cwd);
  }
  assert.equal(
    records.prompt,
    await readFile(join(run, "prompts", `${JOBS[0].id}.txt`), "utf8"),
  );
  assert.deepEqual(
    done.jobs.map((it) => it.status),
    ["done", "done", "done"],
  );
  assert.ok(existsSync(join(run, "results.json")));
  const results = JSON.parse(
    await readFile(join(run, "results.json"), "utf8"),
  ) as { jobs: { id: string; status: string; stats?: { calls: number } }[] };
  assert.equal(results.jobs.length, 3);
  assert.ok(results.jobs.every((it) => it.stats?.calls === 1));

  await runEval({ run, log: () => undefined });
  assert.equal((await starts()).length, 3, "a finished run starts nothing");
});

test("run --go stops dispatching at the cap: the job that would pass it is not started and finish skips it for the cap", async () => {
  await rm(log, { force: true });
  // one child at a time, each spending about 6,200 tokens against an estimate of 1,000: the second would pass 7,000
  const run = await planned(
    "capped",
    { tokens: 7_000 },
    { judges: false, concurrency: 1, estimate: 1_000 },
  );
  const done = await runEval({ run, log: () => undefined });
  assert.equal((await starts()).length, 1);
  assert.deepEqual(
    done.jobs.map((it) => [it.status, it.reason]),
    [
      ["done", undefined],
      ["skipped", "the cap"],
    ],
  );
});

test("a claude that cannot be started stops the run and gives its jobs back, so a later --go still runs them", async () => {
  await rm(log, { force: true });
  const run = await planned("missing", { tokens: 10_000_000 });
  const fake = process.env.CASCADE_EVALS_CLAUDE;
  process.env.CASCADE_EVALS_CLAUDE = join(folder, "no-such-claude.exe");
  try {
    await assert.rejects(
      runEval({ run, log: () => undefined }),
      /could not start/,
    );
  } finally {
    process.env.CASCADE_EVALS_CLAUDE = fake;
  }
  const shown = await showRun({ run, log: () => undefined });
  assert.deepEqual(
    shown.jobs.map((it) => it.status),
    ["pending", "pending"],
  );
});

const tagOf = (name: string, at: 0 | 1) => `${name}/${JOBS[at].id}`;
const statusOf = async (run: string) =>
  (await showRun({ run, log: () => undefined })).jobs.map((it) => it.status);

test("a child that exits with an error and wrote no answer is given back, so the wave's others finish and it runs again to done", async () => {
  await rm(log, { force: true });
  const run = await planned("limit", { tokens: 10_000_000 }, { judges: false });
  process.env.FAKE_CLAUDE_EXIT = JSON.stringify({
    [tagOf("limit", 0)]: { code: 1, times: 1 },
  });
  try {
    const done = await runEval({ run, log: () => undefined });
    assert.deepEqual(
      done.jobs.map((it) => it.status),
      ["done", "done"],
    );
    assert.equal((await starts()).length, 3, "the failed job ran twice");
  } finally {
    delete process.env.FAKE_CLAUDE_EXIT;
  }
});

test("a wave in which every child fails stops the run with its jobs pending, and the next --go takes them to done", async () => {
  await rm(log, { force: true });
  const run = await planned(
    "all-fail",
    { tokens: 10_000_000 },
    { judges: false },
  );
  process.env.FAKE_CLAUDE_EXIT = JSON.stringify({
    [tagOf("all-fail", 0)]: { code: 1, times: 1 },
    [tagOf("all-fail", 1)]: { code: 1, times: 1 },
  });
  try {
    await assert.rejects(runEval({ run, log: () => undefined }), /every child/);
    assert.deepEqual(await statusOf(run), ["pending", "pending"]);
    const done = await runEval({ run, log: () => undefined });
    assert.deepEqual(
      done.jobs.map((it) => it.status),
      ["done", "done"],
    );
  } finally {
    delete process.env.FAKE_CLAUDE_EXIT;
  }
});

test("a run interrupted with jobs handed out and no child alive resumes them: --go takes each to done", async () => {
  await rm(log, { force: true });
  const run = await planned(
    "interrupted",
    { tokens: 10_000_000 },
    { judges: false },
  );
  const path = join(run, "plan.json");
  const plan = JSON.parse(await readFile(path, "utf8")) as {
    jobs: { status: string; dispatched?: boolean }[];
  };
  plan.jobs[0]!.status = "dispatched";
  plan.jobs[1]!.status = "running";
  for (const job of plan.jobs) job.dispatched = true;
  await writeFile(path, JSON.stringify(plan));
  const done = await runEval({ run, log: () => undefined });
  assert.deepEqual(
    done.jobs.map((it) => it.status),
    ["done", "done"],
  );
});

test("a child is started with its own --session-id and its transcript is that session's file: a later session pasting its tag, or an unknown tag, is not taken for the job", async () => {
  await rm(log, { force: true });
  const run = await planned("ids", { tokens: 10_000_000 }, { judges: false });
  const other = join(process.env.CASCADE_EVALS_TRANSCRIPTS!, "C--elsewhere");
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
  const done = await runEval({ run, log: () => undefined });
  assert.deepEqual(
    done.jobs.map((it) => [it.id, it.status]),
    JOBS.map(({ id }) => [id, "done"]),
  );
  for (const start of await starts())
    assert.match(
      flag(start.args, "session-id") ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
});

test("Bash is allowed only as the commands the job's prompt names, written with forward slashes", async () => {
  await rm(log, { force: true });
  const run = await planned("allow", { tokens: 10_000_000 }, { judges: false });
  await runEval({ run, log: () => undefined });
  for (const start of await starts()) {
    const allowed = flag(start.args, "allowedTools")!;
    assert.ok(!/Bash\(node \*\)/.test(allowed), allowed);
    assert.ok(!allowed.includes("\\"), allowed);
    const job = start.tag.slice("allow/".length);
    const command =
      start.tag === tagOf("allow", 0)
        ? /Bash\(node "[^"]+\/cli\.js" ask --run "[^"]+" --job (\S+)\)/
        : /Bash\(node "[^"]+\/cli\.js" pod --run "[^"]+" --job (\S+) \*\)/;
    assert.equal(command.exec(allowed)?.[1], job, allowed);
  }
});

test("a non-numeric CASCADE_EVALS_CHILD_MINUTES is an error before any child starts", async () => {
  await rm(log, { force: true });
  const run = await planned("minutes", { tokens: 10_000_000 });
  process.env.CASCADE_EVALS_CHILD_MINUTES = "soon";
  try {
    await assert.rejects(
      runEval({ run, log: () => undefined }),
      /CASCADE_EVALS_CHILD_MINUTES/,
    );
  } finally {
    delete process.env.CASCADE_EVALS_CHILD_MINUTES;
  }
  assert.deepEqual(await starts(), []);
});

test("an npm .cmd shim for claude is run through the script it names, under node", async () => {
  const bin = join(folder, "shim-bin");
  const script = join(bin, "node_modules", "claude-code", "cli.js");
  await mkdir(dirname(script), { recursive: true });
  await writeFile(script, "");
  await writeFile(
    join(bin, "claude.cmd"),
    String.raw`@ECHO off
"%_prog%"  "%dp0%\node_modules\claude-code\cli.js" %*
`,
  );
  const found = resolveClaude("claude", "win32", bin);
  assert.deepEqual(found.prefix, [script]);
  assert.match(found.note ?? "", /\.cmd shim/);
  await writeFile(join(bin, "claude.exe"), "");
  assert.deepEqual(resolveClaude("claude", "win32", bin), {
    command: "claude",
    prefix: [],
  });
});

test("--config naming another config than the run's plan is an error, not ignored", async () => {
  const run = await planned("other-config", { tokens: 10_000_000 });
  await assert.rejects(
    showRun({ config: "smoke", run, log: () => undefined }),
    /another config/,
  );
});

test("a second --go on a run being run is refused, and a lock left by a dead process is taken over", async () => {
  await rm(log, { force: true });
  const run = await planned(
    "locked",
    { tokens: 10_000_000 },
    { judges: false },
  );
  await writeFile(join(run, "run.lock"), String(process.pid));
  await assert.rejects(runEval({ run, log: () => undefined }), /being run/);
  await writeFile(join(run, "run.lock"), "2147483646");
  const done = await runEval({ run, log: () => undefined });
  assert.deepEqual(
    done.jobs.map((it) => it.status),
    ["done", "done"],
  );
  assert.equal(existsSync(join(run, "run.lock")), false);
});
