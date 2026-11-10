import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-given-"));
const missing = join(folder, "missing");
process.env.CASCADE_EVALS_TABLES = missing;
const { configureTables } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { referenceTables } = await import("../src/reference-tables.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

describe("Giving every case's pod the reference tables · referenceTables(), giveTables()", () => {
  describe("with `CASCADE_EVALS_TABLES` naming a folder that holds no tables", () => {
    let thrown: Error | undefined;

    before(async () => {
      thrown = await referenceTables().then(
        () => undefined,
        (error: Error) => error,
      );
    });

    it("refuses, naming the variable and the folder", () => {
      assert.match(thrown?.message ?? "", /CASCADE_EVALS_TABLES.*missing/s);
    });

    it("copies no starter tables into it", () => {
      assert.equal(existsSync(missing), false);
    });
  });
});
