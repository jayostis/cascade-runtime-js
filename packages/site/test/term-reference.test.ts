import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import {
  type Files,
  MemoryFiles,
  OxigraphStore,
  RDF,
} from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { PagesContext } from "../src/hub/context.js";
import { termsSection } from "../src/hub/terms.js";
import { ruleHref, termHref, termId } from "../src/links.js";
import { buildTree } from "../src/sections.js";
import { specPages } from "../src/spec.js";
import { TERMS_PAGE, termReference } from "../src/term-reference.js";
import { readPage } from "./page.js";

const TREE = "https://github.com/jayostis/cascade-vocabulary/tree/abc123/";
const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/abc123/";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const VACCINE_CODE = `${CASCADE}vaccineCode`;
const VACCINATION = `${CASCADE}Vaccination`;
const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const CVX_SHAPE = `${CASCADE}CvxCodeShape`;
const SPEC = "../spec/";

const ONTOLOGY = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .

cascade:Vaccination a owl:Class ;
    rdfs:label "Vaccination"@en ;
    rdfs:comment "A vaccine given to the person."@en ;
    rdfs:seeAlso <https://hl7.org/fhir/R4/immunization.html> , <https://ns.cascadeprotocol.org/bridge/v1-draft#Run> ;
    dct:source <https://example.org/health.ttl> ;
    dct:license <https://creativecommons.org/licenses/by/4.0/> .

cascade:vaccineCode a owl:ObjectProperty ;
    rdfs:label "Vaccine Code"@en ;
    rdfs:domain cascade:Vaccination .

cascade:vaccineCodeSystem a owl:DatatypeProperty ;
    rdfs:label "Vaccine Code System"@en ;
    rdfs:domain cascade:Vaccination ;
    rdfs:range xsd:string .

cascade:Given a skos:Concept ;
    skos:prefLabel "Given"@en .

foaf:name a owl:DatatypeProperty ;
    rdfs:isDefinedBy <http://xmlns.com/foaf/0.1/> ;
    dct:source <http://xmlns.com/foaf/spec/20140114.rdf> .
`;

const SHAPES = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

cascade:VaccinationShape a sh:NodeShape ;
    sh:targetClass cascade:Vaccination ;
    sh:targetSubjectsOf cascade:vaccineCode ;
    sh:property [
        sh:path cascade:vaccineCode ;
        sh:node cascade:CvxCodeShape ;
        sh:maxCount 1 ;
        sh:message "A vaccine code is one IRI."@en
    ] .

cascade:CvxCodeShape a sh:NodeShape ;
    sh:nodeKind sh:IRI .
`;

const PREFIXED = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
SELECT ?code WHERE { ?v cascade:vaccineCode ?code }
`;
const WHOLE = `SELECT ?code WHERE { ?v <https://ns.cascadeprotocol.org/cascade#vaccineCode> ?code }
`;
const NEITHER = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
# cascade:vaccineCode is not read here
SELECT ?system WHERE { ?v cascade:vaccineCodeSystem ?system }
`;

const FEATURE = `Feature: Vaccines
  Rule: V1. A vaccine is coded
    Example: a code
      Then the pod holds
        """
        <#v> cascade:vaccineCode <http://hl7.org/fhir/sid/cvx#207> .
        """

  Rule: V2. A vaccination is dated
    Example: a date
      Then the pod holds <https://ns.cascadeprotocol.org/cascade#Vaccination>
`;

const text = (value: string) => new TextEncoder().encode(value);

async function fixture(): Promise<Files> {
  const files = new MemoryFiles(TREE);
  await files.write("ontologies/cascade.ttl", text(ONTOLOGY));
  await files.write("ontologies/cascade.shapes.ttl", text(SHAPES));
  await files.write("queries/views/vaccines.rq", text(PREFIXED));
  await files.write("queries/questions/latest-vaccine.rq", text(WHOLE));
  await files.write("queries/views/vaccine-systems.rq", text(NEITHER));
  await files.write("runtime/vaccines.feature", text(FEATURE));
  return files;
}

/** The markup of the entry whose heading carries the id. */
function entry(page: string, id: string): string {
  const found = page
    .split('<section class="term"')
    .slice(1)
    .map((part) => part.split("</section>")[0] ?? "")
    .find((part) => part.includes(` id="${id}"`));
  assert.ok(found !== undefined, `no entry has the id ${id}`);
  return found;
}

/**
 * The term reference is one page with an entry for every vocabulary term: what it is, the shapes that check it, and each
 * query and rule that names it. Every other page's link to a vocabulary term lands here.
 */
describe("The term reference · termReference(), termsSection", () => {
  let page: string;
  /** The page of a vocabulary with one more shape, and eleven more queries that name `cascade:vaccineCodeSystem`. */
  let many: string;

  before(async () => {
    page = await termReference(await fixture(), PLAIN);
    const system = `${CASCADE}vaccineCodeSystem`;
    const files = await fixture();
    await files.write(
      "ontologies/cascade.shapes.ttl",
      text(
        `${SHAPES}\ncascade:SystemShape a sh:NodeShape ;\n    sh:targetSubjectsOf cascade:vaccineCodeSystem ;\n    sh:nodeKind sh:BlankNodeOrIRI .\n`,
      ),
    );
    for (let n = 0; n < 11; n++)
      await files.write(
        `queries/views/many-${n}.rq`,
        text(`SELECT ?s WHERE { ?v <${system}> ?s } # ${n}`),
      );
    many = await termReference(files, PLAIN);
  });

  describe("`termReference()`", () => {
    it("gives each vocabulary term an entry at the anchor `termHref()` links, one copied from elsewhere too", () => {
      const { ids } = readPage(page);
      for (const iri of [
        VACCINATION,
        VACCINE_CODE,
        `${CASCADE}vaccineCodeSystem`,
        `${CASCADE}Given`,
        FOAF_NAME,
      ])
        assert.ok(ids.has(termId(iri)), `no anchor for ${iri}`);
    });

    it("gives the vocabulary's own namespace no entry", () => {
      assert.ok(!readPage(page).ids.has(CASCADE));
    });

    it('shows a vocabulary term\'s name, its type, its domain as a link, and "none stated" for a range it lacks', () => {
      const shown = readPage(entry(page, termId(VACCINE_CODE)));
      assert.match(shown.said, /Vaccine Code/);
      assert.match(shown.said, /owl:ObjectProperty/);
      assert.ok(shown.hrefs.includes(termHref(VACCINATION, "")), "its domain");
      assert.match(shown.said, /Range none stated/);
    });

    it("shows a vocabulary term's comment, its see-also link, its source and its licence", () => {
      const vaccination = readPage(entry(page, termId(VACCINATION)));
      assert.match(vaccination.said, /A vaccine given to the person\./);
      assert.ok(
        vaccination.hrefs.includes("https://hl7.org/fhir/R4/immunization.html"),
      );
      assert.ok(vaccination.hrefs.includes("https://example.org/health.ttl"));
      assert.ok(
        vaccination.hrefs.includes(
          "https://creativecommons.org/licenses/by/4.0/",
        ),
      );
      const name = readPage(entry(page, termId(FOAF_NAME)));
      assert.ok(name.hrefs.includes("http://xmlns.com/foaf/spec/20140114.rdf"));
    });

    it("shows the shape that checks a vocabulary term: its name, its limits and its message", () => {
      const { said } = readPage(entry(page, termId(VACCINE_CODE)));
      assert.match(said, /cascade:VaccinationShape/);
      assert.match(said, /maxCount 1/);
      assert.match(said, /A vaccine code is one IRI\./);
    });

    it("links a shape that another shape sends a value to, at an anchor of its own", () => {
      const shown = readPage(entry(page, termId(VACCINE_CODE)));
      assert.ok(shown.hrefs.includes(termHref(CVX_SHAPE, "")));
      assert.ok(readPage(page).ids.has(termId(CVX_SHAPE)));
    });

    it("links each query that names the vocabulary term, by prefix or by whole IRI", () => {
      const { hrefs } = readPage(entry(page, termId(VACCINE_CODE)));
      assert.ok(hrefs.includes(`${BLOB}queries/views/vaccines.rq`));
      assert.ok(hrefs.includes(`${BLOB}queries/questions/latest-vaccine.rq`));
    });

    it("leaves out a query that names only a longer name, or names it in a comment", () => {
      const { hrefs } = readPage(entry(page, termId(VACCINE_CODE)));
      assert.ok(!hrefs.includes(`${BLOB}queries/views/vaccine-systems.rq`));
    });

    it("links each rule whose text names the vocabulary term, by prefix or by whole IRI", () => {
      const v1 = ruleHref("runtime/vaccines.feature", "V1", SPEC);
      const v2 = ruleHref("runtime/vaccines.feature", "V2", SPEC);
      const vaccineCode = readPage(entry(page, termId(VACCINE_CODE)));
      assert.ok(vaccineCode.hrefs.includes(v1));
      assert.ok(!vaccineCode.hrefs.includes(v2));
      assert.ok(readPage(entry(page, termId(VACCINATION))).hrefs.includes(v2));
    });

    it("says when no query names a vocabulary term", () => {
      assert.match(
        readPage(entry(page, termId(VACCINATION))).said,
        /No query names it\./,
      );
    });

    it("shows an IRI on `ns.cascadeprotocol.org` as text, never as a link", () => {
      const { hrefs, said } = readPage(page);
      assert.deepEqual(
        hrefs.filter((href) =>
          /^https?:\/\/ns\.cascadeprotocol\.org/i.test(href),
        ),
        [],
      );
      assert.ok(said.includes(VACCINE_CODE), "the IRI as text");
      assert.ok(
        said.includes("https://ns.cascadeprotocol.org/bridge/v1-draft#Run"),
      );
    });

    it("names the commit of the vocabulary it was read at", () => {
      assert.ok(page.includes(TREE));
    });
  });

  describe("with a shape that checks the subjects of a property, and no class", () => {
    const system = `${CASCADE}vaccineCodeSystem`;
    const alone = `${CASCADE}SystemShape`;

    it("shows the shape whole in that property's entry", () => {
      const shown = entry(many, termId(system));
      assert.ok(shown.includes(`id="${termId(alone)}"`), "the shape's anchor");
      assert.match(
        readPage(shown).said,
        /SystemShape checks the subject of any/,
      );
    });

    it("leaves it out of the list of shapes that only another shape reaches", () => {
      const part = many.split('id="shapes"')[1] ?? "";
      assert.ok(!part.includes(`id="${termId(alone)}"`));
      assert.ok(part.includes(`id="${termId(CVX_SHAPE)}"`));
    });
  });

  describe("with more than ten queries that name one vocabulary term", () => {
    it("folds them under their count", () => {
      assert.match(
        entry(many, termId(`${CASCADE}vaccineCodeSystem`)),
        /<details><summary>12 queries<\/summary>/,
      );
    });
  });

  describe("with two queries that name one vocabulary term", () => {
    it("lists them unfolded", () => {
      assert.ok(!entry(many, termId(VACCINE_CODE)).includes("<details>"));
    });
  });

  describe("`termsSection`", () => {
    let tree: ReadonlyMap<string, Uint8Array>;

    before(async () => {
      const files = await fixture();
      const ctx = {
        root: "",
        log: () => undefined,
        vocabulary: async () => ({ files, builtFrom: [], at: "" }),
        chrome: PLAIN,
      } as unknown as PagesContext;
      ({ tree } = await buildTree({
        sections: [termsSection],
        ctx,
        front: (rows) => hubFiles([], rows, PLAIN),
      }));
    });

    it("writes the term reference at `terms/index.html`", () => {
      assert.ok(tree.has(TERMS_PAGE));
    });

    it("links it from the front page as `terms/`", () => {
      const front = readPage(new TextDecoder().decode(tree.get(FRONT_PAGE)));
      assert.ok(front.hrefs.includes("terms/"));
    });
  });

  describe("given the vocabulary itself", () => {
    let files: Files;
    let real: string;
    let hrefs: readonly string[];
    let ids: ReadonlySet<string>;

    before(async () => {
      ({ files } = await localVocabulary(
        findRoot(dirname(fileURLToPath(import.meta.url))),
      ));
      real = await termReference(files, PLAIN);
      ({ hrefs, ids } = readPage(real));
    });

    it("gives every vocabulary term of `cascade#` an entry", async () => {
      const ontology = await new OxigraphStore().parse(
        (await files.read("ontologies/cascade.ttl")) ?? new Uint8Array(),
        `${files.iri}ontologies/cascade.ttl`,
      );
      const declared = new Set(
        ontology
          .filter(
            ([subject, predicate]) =>
              subject.termType === "NamedNode" &&
              subject.value.startsWith(CASCADE) &&
              subject.value !== CASCADE &&
              predicate.value === `${RDF}type`,
          )
          .map(([subject]) => subject.value),
      );
      assert.ok(declared.size > 300);
      assert.deepEqual(
        [...declared].filter((iri) => !ids.has(termId(iri))),
        [],
      );
    });

    it("links a query from the entry of `cascade:vaccineCode`", () => {
      const blob = files.iri.replace("/tree/", "/blob/");
      const { hrefs: linked } = readPage(entry(real, termId(VACCINE_CODE)));
      assert.ok(
        linked.some(
          (href) => href.startsWith(`${blob}queries/`) && href.endsWith(".rq"),
        ),
      );
    });

    it("lands every rule link on a rule of the specification's pages", async () => {
      const spec = await specPages({
        vocabulary: files,
        report: { results: new Map(), ranWith: [], repeated: [] },
        builtFrom: [],
        at: "2026-11-04T00:00:00Z",
        chrome: PLAIN,
      });
      const rules = hrefs.filter((href) => href.startsWith(SPEC));
      assert.ok(rules.length > 0);
      for (const href of new Set(rules)) {
        const [file, anchor] = href.slice(SPEC.length).split("#");
        const target = spec.files.get(file ?? "");
        assert.ok(target !== undefined, `${href}: no spec page ${file}`);
        assert.ok(
          readPage(new TextDecoder().decode(target)).ids.has(anchor ?? ""),
          `${href}: no rule with that anchor`,
        );
      }
    });

    it("lands every link within the page on an id of the page", () => {
      for (const href of hrefs.filter((href) => href.startsWith("#")))
        assert.ok(
          ids.has(decodeURIComponent(href.slice(1))),
          `${href} lands nowhere`,
        );
    });
  });
});
