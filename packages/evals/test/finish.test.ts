import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-finish-"));
process.env.CASCADE_EVALS_TRANSCRIPTS = join(folder, "transcripts");
const { openPod } = await import("cascade-runtime");
const { finish } = await import("../src/record.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

test("finish checks and writes a run of two cases in one process, opening each case's pod", async () => {
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
      jobs: [],
      estimate: { tokens: 0, usd: 0 },
      fitsCap: true,
    }),
  );
  await finish(run, () => undefined);
  const results = JSON.parse(
    await readFile(join(run, "results.json"), "utf8"),
  ) as { cases: { id: string }[] };
  assert.deepEqual(
    results.cases.map(({ id }) => id),
    ["tamsin-vale", "priya-natarajan"],
  );
  for (const page of ["index.html", "how_it_works.html"])
    assert.ok(existsSync(join(run, "site", page)), page);
});
