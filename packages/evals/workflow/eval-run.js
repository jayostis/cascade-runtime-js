export const meta = {
  name: "cascade-eval-run",
  description:
    "Run a planned cascade eval: subjects in waves the cap allows, then blind judges, then the checks and results.json",
  whenToUse:
    "After `cascade-evals plan` has written a run's folder; args: { run: <run id>, folder: <run folder>, cli: <path of dist/src/cli.js> }",
  phases: [
    {
      title: "Subjects",
      detail: "each wave as the meter allows under the cap",
    },
    { title: "Judges", detail: "blind packets, then one agent per judge" },
    { title: "Finish", detail: "program checks, grades, scores, results.json" },
  ],
};

// The workflow has no file system: every step that reads or writes the run is the harness's CLI, run by a small
// agent whose prompt carries a harness tag, so its tokens are counted too.
const METER = {
  type: "object",
  required: ["next", "running", "stop"],
  properties: {
    next: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "alias", "tag", "promptPath"],
        properties: {
          id: { type: "string" },
          alias: { type: "string" },
          effort: { type: "string" },
          tag: { type: "string" },
          promptPath: { type: "string" },
        },
      },
    },
    running: { type: "array", items: { type: "string" } },
    stop: { type: "boolean" },
    blockedByCap: { type: "array", items: { type: "string" } },
  },
};

const DONE = {
  type: "object",
  required: ["stdout"],
  properties: { stdout: { type: "string" } },
};

const { run, folder, cli } = args;
let harness = 0;

function shell(command, phase, schema) {
  harness += 1;
  return agent(
    `eval-tag: ${run}/harness-${harness}\n\nRun this one command with the Bash tool, exactly as written, and return what it prints on stdout${schema === METER ? " as the structured output (the `next`, `running`, `stop` and `blockedByCap` fields of its JSON; for each `next` job only id, alias, effort, tag and promptPath)" : " verbatim in `stdout`"}. Do nothing else.\n\n${command}`,
    {
      label: `harness ${harness}`,
      phase,
      model: "haiku",
      effort: "low",
      schema: schema ?? DONE,
    },
  );
}

const promptOf = (job) =>
  `eval-tag: ${job.tag}\n\nRead ${job.promptPath} with the Read tool and do exactly what it says: it is your whole task.`;

async function waves(phase) {
  for (;;) {
    const meter = await shell(
      `node "${cli}" meter --run "${folder}"`,
      phase,
      METER,
    );
    if (meter === null) return false;
    if (meter.blockedByCap && meter.blockedByCap.length > 0)
      log(`held back by the cap: ${meter.blockedByCap.join(", ")}`);
    if (meter.next.length === 0) {
      if (meter.running.length > 0)
        log(`still writing: ${meter.running.join(", ")}`);
      return true;
    }
    log(`starting ${meter.next.map((job) => job.id).join(", ")}`);
    await parallel(
      meter.next.map(
        (job) => () =>
          agent(promptOf(job), {
            label: job.id,
            phase,
            model: job.alias,
            ...(job.effort ? { effort: job.effort } : {}),
          }),
      ),
    );
  }
}

phase("Subjects");
if (!(await waves("Subjects")))
  return "the meter did not answer; the run stopped before its judges, and finish was not run";

phase("Judges");
await shell(`node "${cli}" judges --run "${folder}"`, "Judges");
if (!(await waves("Judges")))
  return "the meter did not answer; the run stopped before finish";

phase("Finish");
const finished = await shell(
  `node "${cli}" finish --run "${folder}"`,
  "Finish",
);
return finished === null ? "finish did not report" : finished.stdout;
