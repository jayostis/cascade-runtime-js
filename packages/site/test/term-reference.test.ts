import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  type Files,
  MemoryFiles,
  OxigraphStore,
  RDF,
} from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
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

let page: string;

before(async () => {
  page = await termReference(await fixture());
});

test("each term cascade.ttl declares has an entry whose heading's id is the anchor termHref links, its own and the copied ones alike", () => {
  const { ids } = readPage(page);
  for (const iri of [
    VACCINATION,
    VACCINE_CODE,
    `${CASCADE}vaccineCodeSystem`,
    `${CASCADE}Given`,
    FOAF_NAME,
  ])
    assert.ok(ids.has(termId(iri)), `no anchor for ${iri}`);
  assert.ok(!ids.has(CASCADE), "the ontology itself is no term");
});

test("a term's entry says what it is, its shape and every query and rule that names it, matching cascade:x and <...#x> and nothing longer", () => {
  const vaccineCode = entry(page, termId(VACCINE_CODE));
  const shown = readPage(vaccineCode);
  assert.match(shown.said, /Vaccine Code/);
  assert.match(shown.said, /owl:ObjectProperty/);
  assert.ok(shown.hrefs.includes(termHref(VACCINATION, "")), "its domain");
  assert.match(shown.said, /Range none stated/);
  assert.match(shown.said, /cascade:VaccinationShape/);
  assert.match(shown.said, /maxCount 1/);
  assert.match(shown.said, /A vaccine code is one IRI\./);
  assert.ok(
    shown.hrefs.includes(termHref(CVX_SHAPE, "")) &&
      readPage(page).ids.has(termId(CVX_SHAPE)),
    "a shape another shape sends a value to has its own anchor, and is linked",
  );
  assert.ok(shown.hrefs.includes(`${BLOB}queries/views/vaccines.rq`));
  assert.ok(shown.hrefs.includes(`${BLOB}queries/questions/latest-vaccine.rq`));
  assert.ok(
    !shown.hrefs.includes(`${BLOB}queries/views/vaccine-systems.rq`),
    "a longer name, or a comment, does not name it",
  );
  assert.ok(
    shown.hrefs.includes(ruleHref("runtime/vaccines.feature", "V1", SPEC)),
  );
  assert.ok(
    !shown.hrefs.includes(ruleHref("runtime/vaccines.feature", "V2", SPEC)),
  );
  const vaccination = readPage(entry(page, termId(VACCINATION)));
  assert.ok(
    vaccination.hrefs.includes(
      ruleHref("runtime/vaccines.feature", "V2", SPEC),
    ),
    "a rule naming the whole IRI uses it",
  );
  assert.match(vaccination.said, /A vaccine given to the person\./);
  assert.ok(
    vaccination.hrefs.includes("https://hl7.org/fhir/R4/immunization.html"),
  );
  assert.ok(vaccination.hrefs.includes("https://example.org/health.ttl"));
  assert.ok(
    vaccination.hrefs.includes("https://creativecommons.org/licenses/by/4.0/"),
  );
  assert.match(vaccination.said, /No query names it\./);
});

test("an IRI on ns.cascadeprotocol.org is shown as text and never linked, and a copied term shows its source", () => {
  const { hrefs, said } = readPage(page);
  assert.deepEqual(
    hrefs.filter((href) => /^https?:\/\/ns\.cascadeprotocol\.org/i.test(href)),
    [],
  );
  assert.ok(said.includes(VACCINE_CODE), "the IRI as text");
  assert.ok(
    said.includes("https://ns.cascadeprotocol.org/bridge/v1-draft#Run"),
  );
  const name = readPage(entry(page, termId(FOAF_NAME)));
  assert.ok(name.hrefs.includes("http://xmlns.com/foaf/spec/20140114.rdf"));
  assert.ok(page.includes(TREE), "the page names the commit it was read at");
});

test("the term reference is a section of the hub, and the front page links it", async () => {
  const files = await fixture();
  const ctx = {
    root: "",
    log: () => undefined,
    vocabulary: async () => ({ files, builtFrom: [], at: "" }),
  } as unknown as PagesContext;
  const { tree } = await buildTree({
    sections: [termsSection],
    ctx,
    front: (rows) => hubFiles([], rows),
  });
  assert.ok(tree.has(TERMS_PAGE));
  const front = readPage(new TextDecoder().decode(tree.get(FRONT_PAGE)));
  assert.ok(
    front.hrefs.includes("terms/"),
    "the base termHref takes from the front page",
  );
});

test("over the real vocabulary, every cascade# term has an anchor, vaccineCode names a query that uses it, and every rule link lands on a rule", async () => {
  const { files } = await localVocabulary(
    findRoot(dirname(fileURLToPath(import.meta.url))),
  );
  const real = await termReference(files);
  const { ids, hrefs } = readPage(real);
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
  const blob = files.iri.replace("/tree/", "/blob/");
  const vaccineCode = readPage(entry(real, termId(VACCINE_CODE)));
  assert.ok(
    vaccineCode.hrefs.some(
      (href) => href.startsWith(`${blob}queries/`) && href.endsWith(".rq"),
    ),
    "vaccineCode's entry names a query",
  );
  const spec = await specPages({
    vocabulary: files,
    report: { results: new Map(), ranWith: [], repeated: [] },
    builtFrom: [],
    at: "2026-11-04T00:00:00Z",
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
  for (const href of hrefs.filter((href) => href.startsWith("#")))
    assert.ok(
      ids.has(decodeURIComponent(href.slice(1))),
      `${href} lands nowhere`,
    );
});
