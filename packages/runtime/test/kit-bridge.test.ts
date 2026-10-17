import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { kitImports } from "../src/kit-bridge.js";
import { importersNamed } from "../src/importers.js";
import { checkouts } from "../src/node/components.js";
import { iri, type Triple } from "../src/rdf.js";
import { notIsomorphic, triples } from "./graphs.js";
import { ROOT, storyFrom, vocabulary } from "./vocabulary.js";

const KIT = "conformance/tamsin-vale";
const CLI = join(ROOT, "packages/runtime/dist/src/node/cli.js");

const kitBridge = (out: string): Promise<unknown> =>
  promisify(execFile)(process.execPath, [CLI, "kit-bridge", KIT, out], {
    cwd: ROOT,
    maxBuffer: 1 << 24,
  });

test("npm run kit:bridge makes what the kit saves: the same files, and each graph and findings isomorphic to the kit's", async () => {
  const out = await mkdtemp(join(tmpdir(), "kit-bridge-"));
  try {
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
    const savedFiles: string[] = [];
    let compared = 0;
    for (const { converted, documents } of imports) {
      savedFiles.push(
        ...(await files.list(`${converted}/`))
          .filter((path) => !path.endsWith("/unaccepted.txt"))
          .map((path) => path.slice(folder.length + 1)),
      );
      for (const { stem, path, iri: named } of documents) {
        const at = `${converted}/${stem}/`;
        const saved = await files.read(`${at}graph.ttl`);
        const savedFindings = await files.read(`${at}findings.ttl`);
        assert.ok(saved && savedFindings, `${at} is saved`);
        const here = join(out, converted.slice(folder.length + 1), stem);
        const graph = await readFile(join(here, "graph.ttl"));
        const findings = await readFile(join(here, "findings.ttl"));
        assert.equal(notIsomorphic(triples(saved), triples(graph)), undefined);
        const documentIri = `${files.iri}${path}`;
        assert.equal(
          notIsomorphic(
            triples(savedFindings, `${files.iri}${at}findings.ttl`).map(
              ([s, p, o]): Triple =>
                o.termType === "NamedNode" && o.value === documentIri
                  ? [s, p, iri(named)]
                  : [s, p, o],
            ),
            triples(findings),
          ),
          undefined,
        );
        compared++;
      }
    }
    assert.equal(compared, 2);
    const written = (
      await readdir(out, { recursive: true, withFileTypes: true })
    )
      .filter((entry) => entry.isFile())
      .map((entry) =>
        join(entry.parentPath, entry.name)
          .slice(out.length + 1)
          .replaceAll("\\", "/"),
      );
    assert.deepEqual(written.sort(), savedFiles.sort());
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("npm run kit:bridge refuses a folder inside the vocabulary, and writes nothing there", async () => {
  const files = await vocabulary();
  const inside = join(files.folder, KIT, "kit-bridge-refused");
  await assert.rejects(
    kitBridge(inside),
    (error: { code?: number }) => error.code === 1,
  );
  await assert.rejects(stat(inside), { code: "ENOENT" });
});
