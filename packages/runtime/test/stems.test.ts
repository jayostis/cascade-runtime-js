import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { tableTerms } from "../src/references.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { ROOT, vocabulary } from "./vocabulary.js";

const STEMS = [
  "snomed.info/sct/",
  "loinc.org/",
  "umls/rxnorm",
  "hl7.org/fhir/sid/ndc/",
  "ns.cascadeprotocol.org/codes/",
];

/** Every file under the folder whose name ends as given, by its path from the root. */
async function filesIn(folder: string, ending: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(ROOT, folder), {
    withFileTypes: true,
  })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesIn(path, ending)));
    else if (entry.name.endsWith(ending)) found.push(path);
  }
  return found;
}

test("no source writes a code system's IRI stem: the runtime reads each from the vocabulary", async () => {
  const sources = [
    ...(
      await Promise.all(
        (await readdir(join(ROOT, "packages"))).map((name) =>
          filesIn(`packages/${name}/src`, ".ts").catch(() => []),
        ),
      )
    ).flat(),
    ...(await filesIn("packages/cascade-runtime/starter", ".mjs")),
  ];
  assert.ok(sources.some((path) => path.endsWith("/words.ts")));
  const registered = (
    await tableTerms(await vocabulary(), () => new OxigraphStore())
  ).codeSystems.map(({ uriSpace }) => uriSpace.replace(/^[a-z]+:\/\//, ""));
  const writing: string[] = [];
  for (const path of sources) {
    const text = await readFile(join(ROOT, path), "utf8");
    for (const stem of [...STEMS, ...registered])
      if (text.includes(stem)) writing.push(`${path} writes ${stem}`);
  }
  assert.deepEqual(writing, []);
});
