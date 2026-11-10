import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
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

/**
 * A record's code joins the reference tables and the matcher's rules as an IRI: its code system's URI space, then the
 * code percent-encoded as SPARQL's `ENCODE_FOR_URI` does. `codeIri()` writes that IRI, so a code this runtime encodes is
 * the IRI a query of the vocabulary gives the same code.
 * @rule runtime/matcher.feature M4
 */
describe("Writing a code as an IRI · codeIri()", () => {
  /** The vocabulary's `tests/vectors/clinvar/code-iris.json`: a code system, a code, and the IRI each runtime must write. */
  describe("given the vocabulary's vectors (`tests/vectors/clinvar/code-iris.json`)", () => {
    let vectors: readonly Code[];
    let spaceOf: (system: string) => string;

    before(async () => {
      const files = await vocabulary();
      const bytes = await files.read("tests/vectors/clinvar/code-iris.json");
      assert.ok(bytes !== undefined, "the vocabulary has no code-iris.json");
      vectors = JSON.parse(new TextDecoder().decode(bytes)) as Code[];
      const { codeSystems } = await tableTerms(
        files,
        () => new OxigraphStore(),
      );
      spaceOf = (system) => {
        const found = codeSystems.find(
          ({ iri }) => iri === `${CASCADE}${system}`,
        );
        assert.ok(found !== undefined, `${system} is no code system`);
        return found.uriSpace;
      };
    });

    it("returns each vector's IRI, those of a code holding `(` and of one holding `*` among them", () => {
      const coded = vectors.filter(
        (vector): vector is Code & { literal: string; iri: string } =>
          vector.literal !== null && vector.iri !== null,
      );
      assert.ok(
        coded.some(({ literal }) => literal.includes("(")),
        "no vector holds a code with `(`",
      );
      assert.ok(
        coded.some(({ literal }) => literal.includes("*")),
        "no vector holds a code with `*`",
      );
      for (const { system, literal, iri } of coded)
        assert.equal(codeIri(spaceOf(system), literal), iri, `${system} ${literal}`);
    });
  });
});
