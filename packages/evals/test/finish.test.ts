import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Prepared } from "../src/cases.js";
import type { pinnedPod } from "../src/pinned.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-finish-"));
process.env.CASCADE_EVALS_TRANSCRIPTS = join(folder, "transcripts");
const { openPod } = await import("cascade-runtime");
const { askerOf, finish } = await import("../src/record.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

test("finish checks and writes a run of two cases in one process, opening each case's pod, and records each case's person and description and each subject job's opening prompt", async () => {
  const run = join(folder, "run");
  await mkdir(run, { recursive: true });
  const cases = [];
  for (const id of ["tamsin-vale", "priya-natarajan"]) {
    const pods = join(folder, id);
    await (await openPod(join(pods, id), { title: id })).close();
    cases.push({
      id,
      downloadsSha256: "",
      keySha256: "",
      prepared: {
        case: id,
        downloads: join(folder, "downloads"),
        downloadsSha256: "",
        pods,
        pod: id,
        components: [],
        imports: [],
        documents: [],
      },
    });
  }
  await writeFile(
    join(run, "plan.json"),
    JSON.stringify({
      run: "two-cases",
      folder: run,
      created: new Date().toISOString(),
      config: {
        tier: "custom",
        cases: ["tamsin-vale", "priya-natarajan"],
        arms: ["pod", "records"],
        subjects: ["claude-opus-5-5"],
        repeats: 1,
        judges: [],
        cap: { usd: 1 },
      },
      configSha256: "",
      harness: { commit: "0000000", uncommitted: 0 },
      podCommits: { packages: {}, components: [] },
      prompts: {},
      cases,
      jobs: [
        {
          id: "tamsin-vale.checkup.pod",
          role: "subject",
          case: "tamsin-vale",
          arm: "pod",
          model: "claude-opus-5-5",
          tag: "two-cases/tamsin-vale.checkup.pod",
          status: "done",
          estimate: { tokens: 0, usd: 0 },
          session: "checkup",
          questions: [],
          prompt: "prompts/tamsin-vale.checkup.pod.txt",
        },
      ],
      estimate: { tokens: 0, usd: 0 },
      fitsCap: true,
    }),
  );
  await mkdir(join(run, "prompts"), { recursive: true });
  await writeFile(
    join(run, "prompts", "tamsin-vale.checkup.pod.txt"),
    "You are answering Tamsin Vale.\n",
  );
  await finish(run, () => undefined);
  const results = JSON.parse(
    await readFile(join(run, "results.json"), "utf8"),
  ) as {
    cases: {
      id: string;
      today: string;
      person: { name: string; pronoun: string };
      description: Record<string, string>;
    }[];
    jobs: { id: string; promptText?: string }[];
  };
  assert.deepEqual(
    results.cases.map(({ id }) => id),
    ["tamsin-vale", "priya-natarajan"],
  );
  const [tamsin] = results.cases;
  assert.deepEqual(tamsin!.person, { name: "Tamsin Vale", pronoun: "her" });
  assert.match(tamsin!.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(tamsin!.description).sort(), [
    "planted",
    "sources",
    "summary",
    "who",
  ]);
  assert.match(tamsin!.description.who!, /^Tamsin Vale, born 1957-09-30/);
  assert.equal(
    results.jobs.find((it) => it.id === "tamsin-vale.checkup.pod")?.promptText,
    "You are answering Tamsin Vale.\n",
  );
  for (const page of ["index.html", "how_it_works.html"])
    assert.ok(existsSync(join(run, "site", page)), page);
});

test("finish numbers an answer's items by their place before it stores the answer and its evidence", async () => {
  const run = join(folder, "numbers");
  const id = "tamsin-vale";
  const job = "tamsin-vale.checkup.pod";
  const pods = join(folder, "numbers-pods");
  await (await openPod(join(pods, id), { title: id })).close();
  await mkdir(join(run, "answers", job), { recursive: true });
  await mkdir(join(run, "prompts"), { recursive: true });
  await writeFile(join(run, "prompts", `${job}.txt`), "Ask.\n");
  await writeFile(
    join(run, "answers", job, "checkup.json"),
    await readFile(
      new URL(
        "../../test/fixtures/smoke-answers/pod-blood-clot.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await writeFile(
    join(run, "plan.json"),
    JSON.stringify({
      run: "numbers",
      folder: run,
      created: new Date().toISOString(),
      config: {
        tier: "custom",
        cases: [id],
        arms: ["pod"],
        subjects: ["claude-opus-5-5"],
        repeats: 1,
        judges: [],
        cap: { usd: 1 },
      },
      configSha256: "",
      harness: { commit: "0000000", uncommitted: 0 },
      podCommits: { packages: {}, components: [] },
      prompts: {},
      cases: [
        {
          id,
          downloadsSha256: "",
          keySha256: "",
          prepared: {
            case: id,
            downloads: join(folder, "downloads"),
            downloadsSha256: "",
            pods,
            pod: id,
            components: [],
            imports: [],
            documents: [],
          },
        },
      ],
      jobs: [
        {
          id: job,
          role: "subject",
          case: id,
          arm: "pod",
          model: "claude-opus-5-5",
          tag: `numbers/${job}`,
          status: "done",
          estimate: { tokens: 0, usd: 0 },
          session: "checkup",
          questions: ["checkup"],
          answers: `answers/${job}`,
          prompt: `prompts/${job}.txt`,
        },
      ],
      estimate: { tokens: 0, usd: 0 },
      fitsCap: true,
    }),
  );
  await finish(run, () => undefined);
  const results = JSON.parse(
    await readFile(join(run, "results.json"), "utf8"),
  ) as {
    answers: Record<string, Record<string, { items: { n: number }[] }>>;
    evidence: { item: number }[];
  };
  assert.deepEqual(
    results.answers[job]!.checkup!.items.map((it) => it.n),
    [1, 2, 3, 4, 5],
  );
  assert.ok(results.evidence.some((it) => it.item === 2));
});

test("a pinned run's checks ask its runtime every question they read", async () => {
  let asked: readonly string[] = [];
  const answers = { "entry/What it shows": [{ entry: "x" }] };
  const reader = await askerOf(
    { runtime: "built/runtime", pods: "pods", pod: "p" } as Prepared,
    ((_env, _command, _pod, questions) => {
      asked = questions;
      return answers;
    }) as typeof pinnedPod,
  );
  assert.deepEqual(
    [...asked].sort(),
    ["entry/What it shows", "pod/The person this pod is about"],
    "the list handed to the pinned call",
  );
  assert.deepEqual(await reader.ask("entry/What it shows"), [{ entry: "x" }]);
});
