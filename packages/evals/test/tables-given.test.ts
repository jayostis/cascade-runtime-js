import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-given-"));
process.env.CASCADE_EVALS_TABLES = join(folder, "missing");
const { configureTables } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { referenceTables } = await import("../src/reference-tables.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

test("CASCADE_EVALS_TABLES naming a folder with no tables is refused, not filled with the starter copies", async () => {
  await assert.rejects(referenceTables(), /CASCADE_EVALS_TABLES.*missing/s);
});
