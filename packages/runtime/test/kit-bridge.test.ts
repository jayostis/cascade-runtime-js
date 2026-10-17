import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

test("npm run kit:bridge saves what the kit saves: each document's graph and findings are isomorphic to the kit's, and an edited saved graph is not", async () => {
  const out = await mkdtemp(join(tmpdir(), "kit-bridge-"));
  try {
    await promisify(execFile)(
      process.execPath,
      [
        join(ROOT, "packages/runtime/dist/src/node/cli.js"),
        "kit-bridge",
        KIT,
        out,
      ],
      { cwd: ROOT, maxBuffer: 1 << 24 },
    );
    const files = await vocabulary();
    const { story, folder } = await storyFrom(`${KIT}/tamsin-vale.feature`);
    const imports = await kitImports({
      vocabulary: files,
      folder,
      steps: story.steps,
      importers: importersNamed((await checkouts(ROOT)).config.importers),
      adaptersOf: () => [],
    });
    let compared = 0;
    for (const { converted, documents } of imports)
      for (const { stem, path, iri: named } of documents) {
        const at = `${converted}/${stem}/`;
        const saved = await files.read(`${at}graph.ttl`);
        const savedFindings = await files.read(`${at}findings.ttl`);
        assert.ok(saved && savedFindings, `${at} is saved`);
        const here = join(out, converted.slice(folder.length + 1), stem);
        const graph = await readFile(join(here, "graph.ttl"));
        const findings = await readFile(join(here, "findings.ttl"));
        const savedGraph = triples(saved);
        assert.equal(notIsomorphic(savedGraph, triples(graph)), undefined);
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
        assert.notEqual(
          notIsomorphic(
            [
              ...savedGraph,
              [iri("urn:edited"), iri("urn:is"), iri("urn:so")] as Triple,
            ],
            triples(graph),
          ),
          undefined,
        );
        compared++;
      }
    assert.equal(compared, 2);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
