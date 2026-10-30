import assert from "node:assert/strict";
import { test } from "node:test";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { codeIri } from "../src/rdf.js";
import { tableTerms } from "../src/references.js";
import { CASCADE } from "../src/step.js";
import { vocabulary } from "./vocabulary.js";

interface Code {
  readonly system: string;
  readonly literal: string | null;
  readonly iri: string | null;
}

test("a code's IRI is its system's stem and the code percent-encoded as ENCODE_FOR_URI does, which encodeURIComponent alone gets wrong for ( and *", async () => {
  const files = await vocabulary();
  const bytes = await files.read("tests/vectors/clinvar/code-iris.json");
  assert.ok(bytes !== undefined);
  const vectors = JSON.parse(new TextDecoder().decode(bytes)) as Code[];
  const { codeSystems } = await tableTerms(files, () => new OxigraphStore());
  const spaceOf = (system: string): string => {
    const found = codeSystems.find(({ iri }) => iri === `${CASCADE}${system}`);
    assert.ok(found !== undefined, `${system} is no code system`);
    return found.uriSpace;
  };
  const coded = vectors.filter(
    (vector): vector is Code & { literal: string; iri: string } =>
      vector.literal !== null && vector.iri !== null,
  );
  assert.ok(coded.some(({ literal }) => literal.includes("(")));
  assert.ok(coded.some(({ literal }) => literal.includes("*")));
  assert.deepEqual(
    coded.map(({ system, literal }) => codeIri(spaceOf(system), literal)),
    coded.map(({ iri }) => iri),
  );
});
