import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-tables-"));
process.env.CASCADE_EVALS_WORK = join(folder, "work");
const { podInputs } = await import("../src/plan.js");
const { giveTables } = await import("../src/reference-tables.js");
const { sessionInputsHash } = await import("../src/sessions.js");
const { loadCase } = await import("../src/cases.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const held = (id: string) => ({ folder: join(folder, id), id, versions: [id] });

test("a pod folder is given the reference tables as a copy: its own record of the pods, the source left as it was", async () => {
  const source = join(folder, "source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "tables.json"), '{"current":["v1"]}');
  await writeFile(join(source, "v1.ttl"), "rows");
  const pods = join(folder, "pods");
  await mkdir(join(pods, ".tables"), { recursive: true });
  await writeFile(join(pods, ".tables", "stale.ttl"), "from an earlier build");
  await giveTables(pods, { folder: source });
  assert.equal(await readFile(join(pods, ".tables", "v1.ttl"), "utf8"), "rows");
  await assert.rejects(readFile(join(pods, ".tables", "stale.ttl")));
  await writeFile(join(pods, ".tables", "tables.json"), "changed by a pod");
  assert.equal(
    await readFile(join(source, "tables.json"), "utf8"),
    '{"current":["v1"]}',
  );
});

test("a session is answered on the tables its pod was built with: other tables, another hash", async () => {
  const found = await loadCase("tamsin-vale");
  const hash = (tables: string) =>
    sessionInputsHash({
      found,
      session: found.sessions[0]!,
      downloads: "d",
      arm: "pod",
      model: "m",
      effort: undefined,
      repeat: 1,
      pod: podInputs({ packages: {}, components: [] }, held(tables)),
    });
  assert.equal(hash("a"), hash("a"));
  assert.notEqual(hash("a"), hash("b"));
});
