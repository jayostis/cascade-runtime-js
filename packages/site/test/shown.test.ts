import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type CodeSystem,
  literal,
  OxigraphStore,
  tableTerms,
  XSD,
} from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { markup } from "../src/html.js";
import { code, codePage, shown } from "../src/terms.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Whatever a pod holds reaches a page through these: a pod is written by other software, so its text is never trusted as
 * HTML, a time is shown in one zone, and a code is shown as a person would say it.
 */
describe("Text, times and codes as a page shows them · markup, shown(), code(), codePage()", () => {
  let codeSystems: readonly CodeSystem[];

  before(async () => {
    const vocabulary = await localVocabulary(ROOT);
    ({ codeSystems } = await tableTerms(
      vocabulary.files,
      () => new OxigraphStore(),
    ));
  });

  describe("`markup`", () => {
    it("escapes text put inside an element and inside an attribute", () => {
      const label = `<script>alert(1)</script> " onmouseover="x' & y`;
      const page = markup`<p title="${label}">${label}</p>`.text;
      assert.ok(!page.includes("<script>"));
      assert.ok(!page.includes(`"x`));
      assert.match(
        page,
        /&lt;script&gt;alert\(1\)&lt;\/script&gt; &#34; onmouseover=&#34;x&#39; &amp; y/,
      );
    });
  });

  describe("`shown()`", () => {
    const time = (value: string) => shown(literal(value, `${XSD}dateTime`));

    it("shows an `xsd:dateTime` in UTC to the minute, whatever its offset", () => {
      assert.equal(time("2027-01-01T09:00:00+05:00"), "2027-01-01 04:00 UTC");
    });

    it("reads an `xsd:dateTime` with no offset as UTC", () => {
      assert.equal(time("2027-01-01T09:00:00"), "2027-01-01 09:00 UTC");
    });

    it("shows an `xsd:date` and a plain literal as written", () => {
      assert.equal(shown(literal("2027-01-01", `${XSD}date`)), "2027-01-01");
      assert.equal(
        shown(literal("2027-01-01T09:00:00Z")),
        "2027-01-01T09:00:00Z",
      );
    });
  });

  describe("`code()`", () => {
    it("shows a code as its code system's label and the code, for each code system the vocabulary registers", () => {
      assert.ok(codeSystems.length > 0);
      for (const { label, uriSpace } of codeSystems)
        assert.deepEqual(
          code(`${uriSpace}373270004`, codeSystems),
          [label, "373270004"],
          label,
        );
    });

    it("gives nothing for an IRI in no code system", () => {
      assert.equal(code("http://example.org/x/1", codeSystems), undefined);
    });
  });

  describe("`codePage()`", () => {
    it("links a code's page where its code system gives a template for one", () => {
      assert.equal(
        codePage("https://identifiers.org/clinvar:9", codeSystems),
        "https://www.ncbi.nlm.nih.gov/clinvar/variation/9/",
      );
      assert.equal(
        codePage("http://id.nlm.nih.gov/mesh/D010406", codeSystems),
        "https://id.nlm.nih.gov/mesh/D010406.html",
      );
      assert.equal(
        codePage("http://loinc.org/rdf/2345-7", codeSystems),
        "https://loinc.org/2345-7",
      );
    });

    it("gives no page where the code system gives none, or the IRI is in no code system", () => {
      for (const iri of [
        "https://ns.cascadeprotocol.org/codes/rxnorm/10180",
        "https://ns.cascadeprotocol.org/codes/cvx/150",
        "http://snomed.info/id/91936005",
        "http://example.org/x/1",
      ])
        assert.equal(codePage(iri, codeSystems), undefined, iri);
    });
  });
});
