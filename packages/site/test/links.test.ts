import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noteHref, noteLinkOf, ruleHref, termHref } from "../src/links.js";

const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const HOST = "https://ns.cascadeprotocol.org/";
const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/abc123";

/** Asserts that `call` refuses each base that is the vocabulary's host, however it is written. */
function refusesHost(call: (base: string) => unknown): void {
  for (const base of [
    "http://ns.cascadeprotocol.org/terms/",
    "https://ns.cascadeprotocol.org",
    "HTTPS://NS.CASCADEPROTOCOL.ORG/x",
    HOST,
  ])
    assert.throws(() => call(base), /ns\.cascadeprotocol\.org/, base);
}

/**
 * Every page of the site links what it names through these four, so a vocabulary term, a rule and a decision note each
 * have one address. None of them links `ns.cascadeprotocol.org`, the host of the vocabulary's names, which serves no page.
 */
describe("Linking a vocabulary term, a rule or a decision note · termHref(), ruleHref(), noteHref(), noteLinkOf()", () => {
  describe("`termHref()`", () => {
    it("keeps the namespace's prefix in the anchor, as in `terms/#foaf:name`", () => {
      const known: [string, string][] = [
        [FOAF_NAME, "terms/#foaf:name"],
        ["http://purl.org/pav/version", "terms/#pav:version"],
        [
          "http://www.w3.org/ns/prov#wasDerivedFrom",
          "terms/#prov:wasDerivedFrom",
        ],
        ["http://www.w3.org/ns/solid/terms#account", "terms/#solid:account"],
        ["https://ns.cascadeprotocol.org/cascade#name", "terms/#cascade:name"],
        [
          "https://ns.cascadeprotocol.org/bridge/v1-draft#Source",
          "terms/#bridge:Source",
        ],
        [
          "http://www.w3.org/2004/02/skos/core#prefLabel",
          "terms/#skos:prefLabel",
        ],
        ["http://www.w3.org/2004/02/skos/core#Concept", "terms/#skos:Concept"],
        ["http://www.w3.org/2002/07/owl#sameAs", "terms/#owl:sameAs"],
        [
          "http://purl.obolibrary.org/obo/BFO_0000050",
          "terms/#obo:BFO_0000050",
        ],
        ["http://rdfs.org/ns/void#inDataset", "terms/#void:inDataset"],
        [
          "https://w3id.org/sssom/mapping_justification",
          "terms/#sssom:mapping_justification",
        ],
        ["http://www.w3.org/ns/org#identifier", "terms/#org:identifier"],
        ["http://www.w3.org/ns/dcat#Dataset", "terms/#dcat:Dataset"],
      ];
      for (const [iri, href] of known)
        assert.equal(termHref(iri, "terms/"), href, iri);
    });

    it("gives two vocabulary terms of one name two anchors, one for each namespace", () => {
      assert.notEqual(
        termHref(FOAF_NAME, "terms/"),
        termHref("https://ns.cascadeprotocol.org/cascade#name", "terms/"),
      );
    });

    it("writes a vocabulary term of a namespace it does not know as its whole IRI, escaped", () => {
      assert.equal(
        termHref("http://example.org/a b#c", "terms/"),
        "terms/#http%3A%2F%2Fexample.org%2Fa%20b%23c",
      );
    });

    it("takes the address of whichever page holds the term reference as its base", () => {
      assert.equal(
        termHref("http://www.w3.org/ns/prov#wasDerivedFrom", "../"),
        "../#prov:wasDerivedFrom",
      );
      assert.equal(
        termHref("http://www.w3.org/ns/solid/terms#account", ""),
        "#solid:account",
      );
    });

    it("refuses `ns.cascadeprotocol.org` as a base, on either scheme, however it is capitalised", () => {
      refusesHost((base) => termHref(FOAF_NAME, base));
    });
  });

  describe("`ruleHref()`", () => {
    it("links a rule to its feature's page and its number's anchor", () => {
      assert.equal(
        ruleHref("runtime/matcher.feature", "R19", "spec/"),
        "spec/matcher.html#r19",
      );
    });

    it("links a kit's check to the page named for the kit's folder", () => {
      assert.equal(
        ruleHref("conformance/alex-rivera/alex-rivera.feature", "Check 3", ""),
        "alex-rivera.html#check-3",
      );
    });

    it("refuses `ns.cascadeprotocol.org` as a base", () => {
      assert.throws(
        () => ruleHref("runtime/matcher.feature", "R1", `${HOST}spec/`),
        /ns\.cascadeprotocol\.org/,
      );
    });
  });

  describe("`noteHref()`", () => {
    it("links a note's file on GitHub when the base is GitHub's address, with or without slashes", () => {
      const file = `${BLOB}/decisions/identity.md`;
      assert.equal(noteHref("decisions/identity.md", BLOB), file);
      assert.equal(noteHref("decisions/identity.md", `${BLOB}/`), file);
      assert.equal(noteHref("/decisions/identity.md", BLOB), file);
    });

    it("links a note's page when the base is the folder that holds `decisions/`", () => {
      assert.equal(
        noteHref("decisions/identity.md", "../"),
        "../decisions/identity.html",
      );
    });

    it("links `decisions/README.md` as the folder's index page", () => {
      assert.equal(noteHref("decisions/README.md", ""), "decisions/index.html");
    });

    it("refuses a path that is no decision note, when asked for a page", () => {
      assert.throws(() => noteHref("queries/a.rq", "../"), /no decision note/);
      assert.throws(
        () => noteHref("decisions/a/b.md", "../"),
        /no decision note/,
      );
    });

    it("refuses `ns.cascadeprotocol.org` as a base", () => {
      assert.throws(
        () => noteHref("decisions/identity.md", HOST),
        /ns\.cascadeprotocol\.org/,
      );
    });
  });

  describe("`noteLinkOf()`", () => {
    const links = {
      blob: "https://github.com/jayostis/cascade-vocabulary/blob/abc/",
      tree: "https://github.com/jayostis/cascade-vocabulary/tree/abc/",
    };
    /** A link written in `decisions/currency.md`, as the note's page or, with no `notes`, as GitHub's. */
    const at = (href: string, notes?: string) =>
      noteLinkOf(
        href,
        "decisions/currency.md",
        notes === undefined ? links : { ...links, notes },
      );

    it("sends a link to another note to that note's page, keeping its anchor", () => {
      assert.equal(at("naming.md#why", "../"), "../decisions/naming.html#why");
      assert.equal(at("README.md", "../"), "../decisions/index.html");
    });

    it("keeps a link to another note on GitHub when the notes have no pages", () => {
      assert.equal(at("naming.md"), `${links.blob}decisions/naming.md`);
    });

    it("sends a link to another file of the vocabulary to GitHub, and one to a folder to its listing there", () => {
      assert.equal(
        at("../queries/a.rq?x=1", "../"),
        `${links.blob}queries/a.rq?x=1`,
      );
      assert.equal(at("../queries/", "../"), `${links.tree}queries/`);
    });

    it("leaves an `https:` link as written", () => {
      assert.equal(at("https://example.org/a"), "https://example.org/a");
    });

    it("gives no address for a `javascript:` or `data:` link, however it is spaced", () => {
      assert.equal(at("javascript:alert(1)"), undefined);
      assert.equal(at(" jav\tascript:alert(1)"), undefined);
      assert.equal(at("data:text/html,x", "../"), undefined);
    });
  });
});
