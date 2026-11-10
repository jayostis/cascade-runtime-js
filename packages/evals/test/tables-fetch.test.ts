import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-fetch-"));
process.env.CASCADE_EVALS_WORK = join(folder, "work");
delete process.env.CASCADE_EVALS_TABLES;
const { configureTables } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { REFERENCE_TABLES } = await import("../src/paths.js");
const { holdsWholeTables, markWhole, refuseIncomplete } =
  await import("../src/reference-tables.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const feed = "https://example.org/feed.ttl";

describe("Giving every case's pod the reference tables · referenceTables(), giveTables()", () => {
  describe("with `CASCADE_EVALS_WORK` set", () => {
    it("holds the tables in `reference-tables` under that folder", () => {
      assert.equal(REFERENCE_TABLES, join(folder, "work", "reference-tables"));
    });
  });

  describe("refuseIncomplete(reports, held)", () => {
    it("takes the tables for whole when every feed came whole", () => {
      assert.doesNotThrow(() => refuseIncomplete([{ feed, refused: [] }], 1));
    });

    it("refuses, with the feed's reason, when a feed put a version off", () => {
      assert.throws(
        () => refuseIncomplete([{ feed, later: "offline", refused: [] }], 9),
        /offline/,
      );
    });

    it("refuses, naming the version and the reason, when a feed refused a version", () => {
      assert.throws(
        () =>
          refuseIncomplete(
            [{ feed, refused: [{ version: "v", reason: "bad" }] }],
            9,
          ),
        /v: bad/,
      );
    });

    it("refuses when no table is held", () => {
      assert.throws(
        () => refuseIncomplete([{ feed, refused: [] }], 0),
        /did not give every reference table/,
      );
    });
  });

  describe("holdsWholeTables(folder)", () => {
    const old = join(folder, "old");

    it("returns false for a folder with tables and no mark that the fetch finished", async () => {
      await mkdir(join(old, ".tables"), { recursive: true });
      await writeFile(join(old, ".tables", "starter.ttl"), "rows");
      assert.equal(await holdsWholeTables(old), false);
    });

    it("returns true once `markWhole(folder)` has written the mark", async () => {
      const marked = join(folder, "marked");
      await mkdir(join(marked, ".tables"), { recursive: true });
      await markWhole(marked);
      assert.equal(await holdsWholeTables(marked), true);
    });
  });
});
