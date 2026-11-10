import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-tables-"));
process.env.CASCADE_EVALS_WORK = join(folder, "work");
const { podInputs } = await import("../src/plan.js");
const { giveTables } = await import("../src/reference-tables.js");
const { sessionInputsHash } = await import("../src/sessions.js");
const { loadCase } = await import("../src/cases.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const held = (id: string) => ({ folder: join(folder, id), id, versions: [id] });

/**
 * The harness holds the reference tables once, in its work folder, and copies them beside each case's pods, as an app
 * holds them. A fetch that did not finish whole is never taken for the tables.
 */
describe("Giving every case's pod the reference tables · referenceTables(), giveTables()", () => {
  describe("giveTables(pods, held)", () => {
    const source = join(folder, "source");
    const pods = join(folder, "pods");
    let copied: string;
    let stale: boolean;
    let heldAfter: string;

    before(async () => {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "tables.json"), '{"current":["v1"]}');
      await writeFile(join(source, "v1.ttl"), "rows");
      await mkdir(join(pods, ".tables"), { recursive: true });
      await writeFile(
        join(pods, ".tables", "stale.ttl"),
        "from an earlier build",
      );
      await giveTables(pods, { folder: source });
      copied = await readFile(join(pods, ".tables", "v1.ttl"), "utf8");
      stale = await readFile(join(pods, ".tables", "stale.ttl")).then(
        () => true,
        () => false,
      );
      await writeFile(join(pods, ".tables", "tables.json"), "changed by a pod");
      heldAfter = await readFile(join(source, "tables.json"), "utf8");
    });

    it("copies the held tables into the pods folder's `.tables`", () => {
      assert.equal(copied, "rows");
    });

    it("removes what an earlier build left in `.tables`", () => {
      assert.equal(stale, false);
    });

    it("leaves the held tables as they were when a pod changes its copy", () => {
      assert.equal(heldAfter, '{"current":["v1"]}');
    });
  });
});

/**
 * A session is not run again when a recorded one had the same inputs, and its inputs hash is how the harness tells. What
 * follows is what that hash and a prompt's version cover, since anything left out is a change that reruns nothing.
 */
describe("Reusing a session whose inputs are unchanged · sessionInputsHash(), versionOf(), reusesPreparedPod()", () => {
  describe("sessionInputsHash()", () => {
    let hash: (tables: string) => string;

    before(async () => {
      const found = await loadCase("tamsin-vale");
      hash = (tables) =>
        sessionInputsHash({
          found,
          session: found.sessions[0]!,
          downloads: "d",
          arm: "pod",
          model: "m",
          effort: undefined,
          repeat: 1,
          pod: podInputs({ packages: {}, components: [] }, held(tables)),
          tools: ["Bash"],
          runner: "1",
        });
    });

    it("returns the same hash for a pod built with the same reference tables", () => {
      assert.equal(hash("a"), hash("a"));
    });

    it("returns another hash for a pod built with other reference tables", () => {
      assert.notEqual(hash("a"), hash("b"));
    });
  });
});
