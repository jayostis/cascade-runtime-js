import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { errorsOf } from "../src/schemas.js";
import { buildSite } from "../src/site.js";

/** The smoke run of the harness's first build: Tamsin Vale, one run per arm, programs only. */
const SMOKE = fileURLToPath(
  new URL("../../test/fixtures/smoke-run/", import.meta.url),
);
const out = await mkdtemp(join(tmpdir(), "cascade-evals-site-"));
after(() => rm(out, { recursive: true, force: true, maxRetries: 5 }));

test("the smoke run's results.json holds to its schema, and its site gives both arms a column and the case a page", async () => {
  const results = JSON.parse(
    await readFile(join(SMOKE, "results.json"), "utf8"),
  ) as unknown;
  assert.deepEqual(errorsOf("results", results), []);
  const index = await readFile(
    await buildSite({ run: SMOKE }, join(out, "run")),
    "utf8",
  );
  for (const column of ["pod · opus-5-5", "records · opus-5-5"])
    assert.ok(index.includes(column), `the index has the ${column} column`);
  assert.match(index, /href="cases\/tamsin-vale\.html"/);
  const page = await readFile(
    join(out, "run", "cases", "tamsin-vale.html"),
    "utf8",
  );
  for (const said of [
    "Tamsin Vale",
    "the model&#39;s own knowledge",
    "pod (cascade-mcp)",
    "records (pasted)",
  ])
    assert.ok(
      page.includes(said.replace("&#39;", "'")),
      `the case page shows ${said}`,
    );
});
