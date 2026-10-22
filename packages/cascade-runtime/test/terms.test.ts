import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as oxigraph from "oxigraph";
import {
  findRoot,
  readConfig,
  resolveVocabulary,
} from "@cascade-runtime/runtime/node";
import { terms as main } from "cascade-runtime";
import { terms } from "cascade-runtime/terms";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

test("every IRI of terms is a term the vocabulary the runtime reads declares, and the subpath is the main entry's", async () => {
  assert.equal(terms, main);
  const { folder } = await resolveVocabulary(ROOT, await readConfig(ROOT));
  const ontologies = join(folder, "ontologies");
  const declared = new Set<string>();
  for (const path of await readdir(ontologies, { recursive: true }))
    if (path.endsWith(".ttl") && !path.endsWith(".shapes.ttl"))
      for (const quad of oxigraph.parse(
        await readFile(join(ontologies, path), "utf8"),
        {
          format: "text/turtle",
          base_iri: pathToFileURL(join(ontologies, path)).href,
        },
      ))
        if (quad.predicate.value === TYPE) declared.add(quad.subject.value);
  const { statusOf, ...named } = terms;
  assert.deepEqual(
    [...Object.values(named), ...Object.values(statusOf)].filter(
      (iri) => !declared.has(iri),
    ),
    [],
  );
});
