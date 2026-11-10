import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { kitImports } from "../src/kit-bridge.js";
import { importersNamed } from "../src/importers.js";
import { checkouts } from "../src/node/components.js";
import { iri, type Triple } from "../src/rdf.js";
import { notIsomorphic, triples } from "./graphs.js";
import { ROOT, storyFrom, vocabulary } from "./vocabulary.js";

const KIT = "conformance/tamsin-vale";
const ALEX = "conformance/alex-rivera";
const CLI = join(ROOT, "packages/runtime/dist/src/node/cli.js");

const kitBridge = (out: string, kit = KIT): Promise<unknown> =>
  promisify(execFile)(process.execPath, [CLI, "kit-bridge", kit, out], {
    cwd: ROOT,
    maxBuffer: 1 << 24,
  });

/** The paths of the files under `folder`, with `/`, in order, that `keep` keeps. */
async function filesUnder(
  folder: string,
  keep: (path: string) => boolean = () => true,
): Promise<string[]> {
  return (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .filter(keep)
    .sort();
}

/**
 * `npm run kit:bridge` converts every document a kit's story imports with the Bridge and writes the results as the kit
 * saves them, into a folder of the caller's. A vocabulary maintainer runs it when an adapter changes, and compares that
 * folder with the kit.
 */
describe("Writing a kit's saved output again · npm run kit:bridge", () => {
  describe("given the command run on `conformance/tamsin-vale`", () => {
    let out: string;
    /** For each document the kit's story imports: what the kit saved and where the command wrote its own. */
    let documents: {
      saved: Uint8Array;
      savedFindings: Uint8Array;
      graph: string;
      findings: string;
      findingsAt: string;
      documentIri: string;
      named: string;
    }[];
    let savedFiles: string[];

    before(async () => {
      out = await mkdtemp(join(tmpdir(), "kit-bridge-"));
      await kitBridge(out);
      const files = await vocabulary();
      const { story, folder } = await storyFrom(`${KIT}/tamsin-vale.feature`);
      const imports = await kitImports({
        vocabulary: files,
        folder,
        steps: story.steps,
        importers: importersNamed((await checkouts(ROOT)).config.importers),
        adaptersOf: () => [],
      });
      documents = [];
      savedFiles = [];
      for (const { converted, documents: imported } of imports) {
        savedFiles.push(
          ...(await files.list(`${converted}/`))
            .filter((path) => !path.endsWith("/unaccepted.txt"))
            .map((path) => path.slice(folder.length + 1)),
        );
        for (const { stem, path, iri: named } of imported) {
          const at = `${converted}/${stem}/`;
          const saved = await files.read(`${at}graph.ttl`);
          const savedFindings = await files.read(`${at}findings.ttl`);
          assert.ok(saved && savedFindings, `${at} is saved`);
          const here = join(out, converted.slice(folder.length + 1), stem);
          documents.push({
            saved,
            savedFindings,
            graph: join(here, "graph.ttl"),
            findings: join(here, "findings.ttl"),
            findingsAt: `${files.iri}${at}findings.ttl`,
            documentIri: `${files.iri}${path}`,
            named,
          });
        }
      }
      assert.equal(documents.length, 2, "the documents Tamsin's story imports");
    });

    after(async () => {
      await rm(out, { recursive: true, force: true });
    });

    it("writes the files the kit saves, and no other", async () => {
      assert.deepEqual(await filesUnder(out), savedFiles.sort());
    });

    it("writes for each document a graph and conversion findings isomorphic to the kit's", async () => {
      for (const one of documents) {
        assert.equal(
          notIsomorphic(triples(one.saved), triples(await readFile(one.graph))),
          undefined,
          `${one.named}'s graph`,
        );
        assert.equal(
          notIsomorphic(
            triples(one.savedFindings, one.findingsAt).map(
              ([s, p, o]): Triple =>
                o.termType === "NamedNode" && o.value === one.documentIri
                  ? [s, p, iri(one.named)]
                  : [s, p, o],
            ),
            triples(await readFile(one.findings)),
          ),
          undefined,
          `${one.named}'s conversion findings`,
        );
      }
    });
  });

  describe("given the command run on `conformance/alex-rivera`", () => {
    let out: string;
    let folder: string;

    before(async () => {
      out = await mkdtemp(join(tmpdir(), "kit-bridge-"));
      await kitBridge(out, ALEX);
      ({ folder } = await storyFrom(`${ALEX}/alex-rivera.feature`));
    });

    after(async () => {
      await rm(out, { recursive: true, force: true });
    });

    it("writes a document that an earlier step handed on again only under the steps the kit saves it for", async () => {
      const files = await vocabulary();
      for (const step of ["E7", "E10", "E12", "E15"]) {
        const path = `${step}/Condition-cond-htn-1/graph.ttl`;
        const saved = await files.read(`${folder}/bridge/${path}`);
        assert.ok(saved, `${path} is saved`);
        assert.equal(
          notIsomorphic(
            triples(saved),
            triples(await readFile(join(out, "bridge", path))),
          ),
          undefined,
          path,
        );
      }
    });

    it("writes a `graph.ttl` for each one the kit holds, and no other", async () => {
      const files = await vocabulary();
      const graphs = (at: string) =>
        filesUnder(at, (path) => path.endsWith("/graph.ttl"));
      assert.deepEqual(
        await graphs(join(out, "bridge")),
        await graphs(join(files.folder, folder, "bridge")),
      );
    });
  });

  describe("given a folder inside the vocabulary", () => {
    let inside: string;
    let refused: { code?: number } | undefined;

    before(async () => {
      inside = join((await vocabulary()).folder, KIT, "kit-bridge-refused");
      refused = await kitBridge(inside).then(
        () => undefined,
        (error: { code?: number }) => error,
      );
    });

    after(async () => {
      await rm(inside, { recursive: true, force: true });
    });

    it("exits with code 1", () => {
      assert.equal(refused?.code, 1);
    });

    it("writes nothing there", async () => {
      await assert.rejects(stat(inside), { code: "ENOENT" });
    });
  });
});
