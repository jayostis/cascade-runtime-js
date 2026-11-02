import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-fetch-"));
process.env.CASCADE_EVALS_WORK = join(folder, "work");
delete process.env.CASCADE_EVALS_TABLES;
const { configureTables } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { REFERENCE_TABLES } = await import("../src/paths.js");
const { referenceTables } = await import("../src/reference-tables.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

test("the reference tables are held in the work folder, so one override of it isolates a test", () => {
  assert.equal(REFERENCE_TABLES, join(folder, "work", "reference-tables"));
});

test("a feed fetch that did not finish leaves no reference tables to be taken for complete", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("the network went away"));
  try {
    await assert.rejects(referenceTables());
  } finally {
    globalThis.fetch = real;
  }
  await assert.rejects(access(join(REFERENCE_TABLES, ".tables")));
});
