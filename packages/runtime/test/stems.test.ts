import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tableTerms } from "../src/references.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { ROOT, vocabulary } from "./vocabulary.js";

const STEMS = [
  "snomed.info/",
  "loinc.org/",
  "ns.cascadeprotocol.org/codes/",
  "identifiers.org/",
  "id.nlm.nih.gov/mesh/",
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

/**
 * Red means a TypeScript file under a package's `src` writes the stem of a code system's IRIs: a code system's URI
 * space, or one of the five stems above. A typed stem works until the vocabulary moves the URI space, and then joins
 * nothing. Read the URI space from the vocabulary (`tableTerms()`), or from `codeStems`, which `terms.test.ts` holds to
 * the vocabulary. The package is not at fault; the file that writes the stem is.
 */
describe("Tripwire: a code system's IRI stem typed into code", () => {
  it("finds no TypeScript file under any package's `src`, but `cascade-runtime/src/terms.ts`, that holds the stem of a code system's IRIs", async () => {
    const sources = (
      await Promise.all(
        (await readdir(join(ROOT, "packages"))).map((name) =>
          filesIn(`packages/${name}/src`, ".ts").catch(() => []),
        ),
      )
    )
      .flat()
      .filter((path) => path !== "packages/cascade-runtime/src/terms.ts");
    assert.ok(
      sources.some((path) => path.endsWith("/words.ts")),
      "the scan found no words.ts, so it looked in the wrong place",
    );
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
});
