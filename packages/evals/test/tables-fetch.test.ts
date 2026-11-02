import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-fetch-"));
process.env.CASCADE_EVALS_WORK = join(folder, "work");
delete process.env.CASCADE_EVALS_TABLES;
const { configureTables } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { REFERENCE_TABLES } = await import("../src/paths.js");
const { refuseIncomplete } = await import("../src/reference-tables.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

test("the reference tables are held in the work folder, so one override of it isolates a test", () => {
  assert.equal(REFERENCE_TABLES, join(folder, "work", "reference-tables"));
});

test("tables are taken for complete only when every feed came whole: a version put off or refused is not", () => {
  const feed = "https://example.org/feed.ttl";
  refuseIncomplete([{ feed, refused: [] }], 1);
  assert.throws(
    () => refuseIncomplete([{ feed, later: "offline", refused: [] }], 9),
    /offline/,
  );
  assert.throws(
    () =>
      refuseIncomplete(
        [{ feed, refused: [{ version: "v", reason: "bad" }] }],
        9,
      ),
    /v: bad/,
  );
  assert.throws(() => refuseIncomplete([{ feed, refused: [] }], 0));
});
