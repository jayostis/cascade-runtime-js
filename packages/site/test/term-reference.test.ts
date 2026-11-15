import assert from "node:assert/strict";
import { dirname, posix } from "node:path";
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
import { ruleHref, termHref, termId, termPage } from "../src/links.js";
import { buildTree } from "../src/sections.js";
import { specPages } from "../src/spec.js";
import {
  GLOSS_LIMIT,
  TERMS_JSON,
  TERMS_PAGE,
  gloss,
  termPages,
  termReference,
  termsJson,
} from "../src/term-reference.js";
import { readPage } from "./page.js";

const TREE = "https://github.com/jayostis/cascade-vocabulary/tree/abc123/";
const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/abc123/";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const VACCINE_CODE = `${CASCADE}vaccineCode`;
const VACCINATION = `${CASCADE}Vaccination`;
const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const PROV = "http://www.w3.org/ns/prov#";
const CVX_SHAPE = `${CASCADE}CvxCodeShape`;
const SPEC = "../../spec/";

const ONTOLOGY = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .

cascade:Immunize a owl:Class ;
    rdfs:label "Immunize"@en ;
    rdfs:comment "Giving a vaccine. It happens once."@en ;
    rdfs:subClassOf prov:Activity .

cascade:Standalone a owl:Class ;
    rdfs:label "Standalone"@en ;
    rdfs:comment "Something else entirely. More words follow."@en .

prov:Entity a owl:Class ;
    rdfs:label "Entity" ;
    rdfs:isDefinedBy <http://www.w3.org/ns/prov-o#> ;
    dct:source <https://www.w3.org/ns/prov-o-20130430> .

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
    skos:prefLabel "Given"@en ;
    skos:inScheme cascade:Outcomes .

cascade:Outcomes a skos:ConceptScheme ;
    skos:prefLabel "Outcomes"@en .

cascade:Refused a skos:Concept ;
    skos:prefLabel "Refused"@en ;
    skos:inScheme cascade:Outcomes .

cascade:Alone a skos:Concept ;
    skos:prefLabel "Alone"@en .

foaf:name a owl:DatatypeProperty ;
    rdfs:isDefinedBy <http://xmlns.com/foaf/0.1/> ;
    dct:source <http://xmlns.com/foaf/spec/20140114.rdf> .
`;

const SHAPES = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

cascade:VaccinationShape a sh:NodeShape ;
    sh:targetClass cascade:Vaccination ;
    sh:targetSubjectsOf cascade:vaccineCode ;
    sh:property [
        sh:path cascade:vaccineCode ;
        sh:node cascade:CvxCodeShape ;
        sh:maxCount 1 ;
        sh:message "A vaccine code is one IRI."@en
    ] ;
    sh:property [
        sh:path cascade:vaccineCodeSystem ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
        sh:maxCount 3
    ] .

cascade:CvxCodeShape a sh:NodeShape ;
    sh:nodeKind sh:IRI .
`;

const LAYOUT = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .

[] a cascade:Placement ; solid:forClass cascade:Vaccination ; solid:instanceContainer <records/immunizations/> ; cascade:holdsRecords true .
[] a cascade:Placement ; solid:forClass cascade:Immunize ; solid:instanceContainer <records/acts/> .
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

const PROPERTIES = new Set([
  VACCINE_CODE,
  `${CASCADE}vaccineCodeSystem`,
  FOAF_NAME,
]);

const text = (value: string) => new TextEncoder().encode(value);

async function fixture(): Promise<Files> {
  const files = new MemoryFiles(TREE);
  await files.write("ontologies/cascade.ttl", text(ONTOLOGY));
  await files.write("ontologies/cascade.shapes.ttl", text(SHAPES));
  await files.write("queries/views/vaccines.rq", text(PREFIXED));
  await files.write("queries/questions/latest-vaccine.rq", text(WHOLE));
  await files.write("queries/views/vaccine-systems.rq", text(NEITHER));
  await files.write("runtime/vaccines.feature", text(FEATURE));
  await files.write("runtime/pod-layout.ttl", text(LAYOUT));
  return files;
}

/** The markup of the part of a page from the heading with the id to the next heading of its level. */
function partOf(page: string, id: string): string {
  const from = page.split(`id="${id}"`)[1];
  assert.ok(from !== undefined, `no heading has the id ${id}`);
  return from.split(/<h2[ >]/)[0] ?? "";
}

/** The text of that part. */
const part = (page: string, id: string): string =>
  readPage(partOf(page, id)).said;

/** The markup of the page of the term with the IRI. */
function entry(pages: ReadonlyMap<string, string>, iri: string): string {
  const found = pages.get(termPage(iri, PROPERTIES.has(iri)));
  assert.ok(found !== undefined, `no page for ${iri}`);
  return found;
}

/**
 * The term reference is an index and a page for every vocabulary term: what it is, the shapes that check it, and each
 * query and rule that names it. Every other page's link to a vocabulary term lands on its page.
 */
describe("The term reference · termReference(), termsSection", () => {
  let page: string;
  let pages: ReadonlyMap<string, string>;
  /** The pages of a vocabulary with one more shape, and eleven more queries that name `cascade:vaccineCodeSystem`. */
  let many: ReadonlyMap<string, string>;
  let manyFiles: Files;

  before(async () => {
    page = await termReference(await fixture(), PLAIN);
    pages = await termPages(await fixture(), PLAIN);
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
    manyFiles = files;
    many = await termPages(files, PLAIN);
  });

  describe("`termPages()`", () => {
    it("gives each vocabulary term a page at the address `termHref()` links, one copied from elsewhere too", () => {
      const { ids } = readPage(page);
      for (const iri of [
        VACCINATION,
        VACCINE_CODE,
        `${CASCADE}vaccineCodeSystem`,
        `${CASCADE}Given`,
        FOAF_NAME,
      ]) {
        assert.ok(
          pages.has(termHref(iri, "", PROPERTIES.has(iri))),
          `no page for ${iri}`,
        );
        assert.ok(ids.has(termId(iri)), `the index has no row for ${iri}`);
      }
      assert.ok(pages.has("cascade/Vaccination.html"));
      assert.ok(pages.has("foaf/properties/name.html"));
      assert.ok(pages.has("cascade/properties/vaccineCode.html"));
    });

    it("gives the vocabulary's own namespace no page", () => {
      assert.ok(!readPage(page).ids.has(CASCADE));
      assert.ok(![...pages.keys()].some((path) => path.endsWith("/.html")));
    });

    it("gives each page the id of its term on its heading, so a search row lands on it", () => {
      assert.match(
        entry(pages, VACCINE_CODE),
        /<h1 id="cascade:vaccineCode"><code>cascade:vaccineCode<\/code> Vaccine Code<\/h1>/,
      );
    });

    it("shows a vocabulary term's name, its type and its domain as a link, and no row for a range it lacks", () => {
      const shown = readPage(entry(pages, VACCINE_CODE));
      assert.match(shown.said, /Vaccine Code/);
      assert.match(shown.said, /owl:ObjectProperty/);
      assert.ok(
        shown.hrefs.includes(termHref(VACCINATION, "../../")),
        "its domain",
      );
      assert.doesNotMatch(shown.said, /Range|Subproperty of|License/);
      assert.match(
        readPage(entry(pages, `${CASCADE}vaccineCodeSystem`)).said,
        /Range/,
      );
    });

    it("says none stated nowhere", () => {
      assert.doesNotMatch(readPage(page).said, /none stated|no property/i);
    });

    it('says "No definition yet" of its own term with no comment, and of no term copied from another vocabulary', () => {
      assert.match(
        readPage(entry(pages, VACCINE_CODE)).said,
        /No definition yet/,
      );
      const copied = readPage(entry(pages, `${PROV}Entity`)).said;
      assert.doesNotMatch(copied, /No definition yet/);
      assert.match(copied, /from PROV-O/);
    });

    it("shows a vocabulary term's comment, its see-also link, its source and its licence", () => {
      const vaccination = readPage(entry(pages, VACCINATION));
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
      const name = readPage(entry(pages, FOAF_NAME));
      assert.ok(name.hrefs.includes("http://xmlns.com/foaf/spec/20140114.rdf"));
    });

    it("shows the shape that checks a vocabulary term: its name, its limits and its message", () => {
      const { said } = readPage(entry(pages, VACCINE_CODE));
      assert.match(said, /cascade:VaccinationShape/);
      assert.match(said, /maxCount 1/);
      assert.match(said, /A vaccine code is one IRI\./);
    });

    it("links a shape that another shape sends a value to, at an anchor of its own on the index", () => {
      const shown = readPage(entry(pages, VACCINE_CODE));
      assert.ok(shown.hrefs.includes(`../../index.html#${termId(CVX_SHAPE)}`));
      assert.ok(readPage(page).ids.has(termId(CVX_SHAPE)));
    });

    it("shows a class's shape as a table of each property, its value type, how many and what it says when it is not met", () => {
      const { said, hrefs } = readPage(entry(pages, VACCINATION));
      assert.match(said, /Property.*Value type.*How many.*When it is not met/);
      assert.match(
        said,
        /cascade:vaccineCode.*cascade:CvxCodeShape.*at most 1.*A vaccine code is one IRI\./,
      );
      assert.match(said, /cascade:vaccineCodeSystem.*xsd:string.*1 to 3/);
      assert.ok(hrefs.includes(termHref(VACCINE_CODE, "../", true)));
    });

    it("labels each cell of a shape's table with its column, which the stylesheet shows on a narrow screen", () => {
      const cells = [...entry(pages, VACCINATION).matchAll(/<td([^>]*)>/g)].map(
        ([, attributes]) => attributes,
      );
      assert.equal(cells.length, 8);
      assert.deepEqual(cells.slice(0, 4), [
        ' data-label="Property"',
        ' data-label="Value type"',
        ' data-label="How many"',
        ' data-label="When it is not met"',
      ]);
      for (const attributes of cells)
        assert.match(attributes ?? "", /^ data-label="/);
    });

    it("leaves out what a term has none of, so a term with no query, rule or source has no closed section", () => {
      assert.doesNotMatch(
        readPage(entry(pages, `${CASCADE}vaccineCodeSystem`)).said,
        /No query|No rule|Source|License/,
      );
      assert.doesNotMatch(
        entry(pages, `${CASCADE}Standalone`),
        /Where it comes from/,
      );
    });

    it("puts the rules, what a class is a subclass of, its source and its licence in a section that is closed", () => {
      const html = entry(pages, VACCINATION);
      assert.ok(!/<details open/.test(html));
      const [open = "", closed = ""] = html.split("<details>");
      assert.match(closed, /Where it comes from/);
      for (const label of ["Rules", "Source", "License"]) {
        assert.ok(closed.includes(`<dt>${label}</dt>`), label);
        assert.ok(!open.includes(`<dt>${label}</dt>`), label);
      }
      assert.match(
        entry(pages, `${CASCADE}Immunize`).split("<details>")[1] ?? "",
        /Subclass of/,
      );
    });

    it("lists the other members of the scheme a named thing is in, and the members on the scheme's own page", () => {
      const given = readPage(entry(pages, `${CASCADE}Given`));
      assert.match(given.said, /In the scheme.*cascade:Outcomes/);
      assert.match(
        given.said,
        /Other members of cascade:Outcomes.*cascade:Refused/,
      );
      assert.ok(given.hrefs.includes("../cascade/Refused.html"));
      assert.doesNotMatch(given.said, /Other members.*cascade:Given/);
      const scheme = readPage(entry(pages, `${CASCADE}Outcomes`));
      assert.match(scheme.said, /Members.*cascade:Given.*cascade:Refused/);
      assert.doesNotMatch(
        readPage(entry(pages, `${CASCADE}Alone`)).said,
        /scheme|Members/,
      );
    });

    it("links each query that names the vocabulary term, by prefix or by whole IRI", () => {
      const { hrefs } = readPage(entry(pages, VACCINE_CODE));
      assert.ok(hrefs.includes(`${BLOB}queries/views/vaccines.rq`));
      assert.ok(hrefs.includes(`${BLOB}queries/questions/latest-vaccine.rq`));
    });

    it("leaves out a query that names only a longer name, or names it in a comment", () => {
      const { hrefs } = readPage(entry(pages, VACCINE_CODE));
      assert.ok(!hrefs.includes(`${BLOB}queries/views/vaccine-systems.rq`));
    });

    it("links each rule whose text names the vocabulary term, by prefix or by whole IRI", () => {
      const v1 = ruleHref("runtime/vaccines.feature", "V1", `../${SPEC}`);
      const v2 = ruleHref("runtime/vaccines.feature", "V2", SPEC);
      const vaccineCode = readPage(entry(pages, VACCINE_CODE));
      assert.ok(vaccineCode.hrefs.includes(v1));
      assert.ok(!vaccineCode.hrefs.includes(v2));
      assert.ok(readPage(entry(pages, VACCINATION)).hrefs.includes(v2));
    });

    it("shows an IRI on `ns.cascadeprotocol.org` as text, never as a link", () => {
      for (const html of [page, ...pages.values()])
        assert.deepEqual(
          readPage(html).hrefs.filter((href) =>
            /^https?:\/\/ns\.cascadeprotocol\.org/i.test(href),
          ),
          [],
        );
      assert.ok(
        readPage(entry(pages, VACCINE_CODE)).said.includes(VACCINE_CODE),
        "the IRI as text",
      );
      assert.ok(
        readPage(entry(pages, VACCINATION)).said.includes(
          "https://ns.cascadeprotocol.org/bridge/v1-draft#Run",
        ),
      );
    });

    it("names the commit of the vocabulary it was read at", () => {
      assert.ok(page.includes(TREE));
    });
  });

  describe("with its index of classes", () => {
    it("opens the page's lists, before the properties", () => {
      const { said } = readPage(page);
      assert.ok(
        said.indexOf("What a pod holds") < said.indexOf("Properties"),
        "classes first",
      );
    });

    it("lists under what a pod holds each class the pod layout says holds records, with its label, its name and its first sentence", () => {
      const held = part(page, "what-a-pod-holds");
      assert.match(
        held,
        /Vaccination.*cascade:Vaccination.*A vaccine given to the person\./,
      );
      assert.doesNotMatch(held, /Immunize|Standalone/);
      assert.ok(
        readPage(partOf(page, "what-a-pod-holds")).hrefs.includes(
          termHref(VACCINATION, ""),
        ),
      );
    });

    it("lists the subclasses of prov:Activity under acts, with only the first sentence of their comment", () => {
      const acts = part(page, "acts");
      assert.match(acts, /Immunize.*cascade:Immunize.*Giving a vaccine\./);
      assert.doesNotMatch(acts, /It happens once/);
      assert.doesNotMatch(acts, /Vaccination|Standalone/);
    });

    it("cuts a gloss at the first colon or semicolon, or at a word before the limit, and ends a cut with an ellipsis", () => {
      assert.equal(gloss("A vaccine given. It is once."), "A vaccine given.");
      assert.equal(gloss("A set: the first and more."), "A set…");
      assert.equal(gloss("A thing; or another."), "A thing…");
      assert.equal(
        gloss("Time 10:30 is not a cut."),
        "Time 10:30 is not a cut.",
      );
      const long = `${"word ".repeat(40)}end.`;
      const cut = gloss(long);
      assert.ok(cut.length <= GLOSS_LIMIT, `${cut.length} characters`);
      assert.ok(cut.endsWith("…"));
      assert.ok(long.startsWith(cut.slice(0, -1)), "a prefix of the sentence");
      assert.equal(
        gloss(`${"x".repeat(150)}.`),
        `${"x".repeat(GLOSS_LIMIT - 1)}…`,
      );
    });

    it("does not end a gloss's sentence at an abbreviation's full stop", () => {
      assert.equal(
        gloss("Any cast, e.g. a plaster one. More follows."),
        "Any cast, e.g. a plaster one.",
      );
      assert.equal(
        gloss("A form, i.e. a paper one. More."),
        "A form, i.e. a paper one.",
      );
    });

    it("lists the other classes of the vocabulary's own under other classes, and none copied from elsewhere", () => {
      const other = part(page, "other-classes");
      assert.match(other, /Standalone/);
      assert.doesNotMatch(other, /Vaccination|Immunize|Entity/);
    });

    it("gives a class with no comment the line that it has no definition yet", async () => {
      const files = await fixture();
      await files.write(
        "ontologies/cascade.ttl",
        text(`${ONTOLOGY}\ncascade:Bare a owl:Class .\n`),
      );
      assert.match(
        part(await termReference(files, PLAIN), "other-classes"),
        /cascade:Bare.*No definition yet/,
      );
    });

    it("links every name of a list to the page of a term", () => {
      for (const id of ["what-a-pod-holds", "acts", "other-classes"]) {
        const linked = readPage(partOf(page, id)).hrefs;
        assert.ok(linked.length > 0, id);
        for (const href of linked) assert.ok(pages.has(href), href);
      }
    });

    it("gives every term a row with the id its anchor had, so an old link to `terms/#cascade:Name` lands on the row", () => {
      const { ids } = readPage(page);
      for (const path of pages.keys()) {
        const found = /<h1 id="([^"]+)"/.exec(pages.get(path) ?? "")?.[1] ?? "";
        assert.ok(ids.has(found), `${path}: the index has no row ${found}`);
      }
      assert.match(page, /<li id="cascade:Vaccination">/);
      assert.match(
        page,
        /<a id="cascade:vaccineCode" href="cascade\/properties\/vaccineCode\.html">/,
      );
    });
  });

  describe("with the old anchors of the shapes", () => {
    it("keeps each shape's old id on the row of the term it is at home on, and `#classes` on the index of classes", async () => {
      const { ids } = readPage(page);
      assert.ok(ids.has(termId(`${CASCADE}VaccinationShape`)));
      assert.ok(ids.has("classes"));
      assert.ok(
        readPage(await termReference(manyFiles, PLAIN)).ids.has(
          termId(`${CASCADE}SystemShape`),
        ),
      );
    });
  });

  describe("with two terms whose names differ only by the case of the first letter", () => {
    it("writes a class's page and a property's page at two paths that differ by more than case", async () => {
      const files = await fixture();
      await files.write(
        "ontologies/cascade.ttl",
        text(
          `${ONTOLOGY}\ncascade:Subject a owl:Class .\ncascade:subject a owl:ObjectProperty .\n`,
        ),
      );
      const written = [...(await termPages(files, PLAIN)).keys()];
      assert.ok(written.includes("cascade/Subject.html"));
      assert.ok(written.includes("cascade/properties/subject.html"));
      assert.equal(
        new Set(written.map((path) => path.toLowerCase())).size,
        written.length,
      );
    });
  });

  describe("with the neighbours of a named thing", () => {
    const BASIS = `${CASCADE}basis`;
    let things: ReadonlyMap<string, string>;

    before(async () => {
      const files = await fixture();
      await files.write(
        "ontologies/cascade.ttl",
        text(`${ONTOLOGY}
cascade:Source a owl:Class .
cascade:basis a owl:ObjectProperty .
cascade:fromPrescription a owl:NamedIndividual, cascade:Source .
cascade:fromList a owl:NamedIndividual, cascade:Source .
cascade:fromScan a owl:NamedIndividual .
cascade:Orphan a owl:NamedIndividual .
`),
      );
      await files.write(
        "ontologies/cascade.shapes.ttl",
        text(`${SHAPES}
cascade:BasisShape a sh:NodeShape ;
    sh:targetSubjectsOf cascade:basis ;
    sh:property [
        sh:path cascade:basis ;
        sh:in ( cascade:fromPrescription cascade:fromList cascade:fromScan )
    ] .
`),
      );
      things = await termPages(files, PLAIN);
    });

    it("names the property whose `sh:in` list holds it, linked, with the other values of that list", () => {
      const scan = readPage(entry(things, `${CASCADE}fromScan`));
      assert.match(scan.said, /Allowed value of.*cascade:basis/);
      assert.ok(scan.hrefs.includes(termHref(BASIS, "../", true)));
      assert.match(
        scan.said,
        /Other values of cascade:basis.*cascade:fromList.*cascade:fromPrescription/,
      );
      assert.doesNotMatch(scan.said, /Other values of cascade:basis.*fromScan/);
    });

    it("lists the other instances of its type when that type is a class of the vocabulary", () => {
      const prescription = readPage(
        entry(things, `${CASCADE}fromPrescription`),
      );
      assert.match(
        prescription.said,
        /Other instances of cascade:Source.*cascade:fromList/,
      );
      assert.doesNotMatch(
        readPage(entry(things, `${CASCADE}fromScan`)).said,
        /Other instances/,
      );
    });

    it("lists no neighbours of a thing that is in no list and has no class of the vocabulary", () => {
      assert.doesNotMatch(
        readPage(entry(things, `${CASCADE}Orphan`)).said,
        /Other (?:values|instances)|Allowed value/,
      );
    });
  });

  describe("with a shape that checks the subjects of a property, and no class", () => {
    const system = `${CASCADE}vaccineCodeSystem`;
    const alone = `${CASCADE}SystemShape`;

    it("shows the shape whole in that property's entry", () => {
      const shown = entry(many, system);
      assert.ok(shown.includes(`id="${termId(alone)}"`), "the shape's anchor");
      assert.match(
        readPage(shown).said,
        /SystemShape checks the subject of any/,
      );
    });

    it("leaves it out of the list of shapes that only another shape reaches", async () => {
      const part =
        (await termReference(manyFiles, PLAIN)).split('id="shapes"')[1] ?? "";
      assert.ok(!part.includes(`id="${termId(alone)}"`));
      assert.ok(part.includes(`id="${termId(CVX_SHAPE)}"`));
    });
  });

  describe("with more than ten queries that name one vocabulary term", () => {
    it("folds them under their count", () => {
      assert.match(
        entry(many, `${CASCADE}vaccineCodeSystem`),
        /<details><summary>12 queries<\/summary>/,
      );
    });
  });

  describe("with two queries that name one vocabulary term", () => {
    it("lists them unfolded", () => {
      assert.doesNotMatch(entry(many, VACCINE_CODE), /<summary>\d+ queries/);
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

    it("writes a page for each term under `terms/<prefix>/<Name>.html`", () => {
      for (const path of [
        "terms/cascade/Vaccination.html",
        "terms/cascade/properties/vaccineCode.html",
        "terms/prov/Entity.html",
        "terms/foaf/properties/name.html",
      ])
        assert.ok(tree.has(path), path);
    });

    it("writes `terms/terms.json` with every term's fields, and the vocabulary's two files beside it", () => {
      const { terms } = JSON.parse(
        new TextDecoder().decode(tree.get(TERMS_JSON)),
      ) as { terms: Record<string, unknown>[] };
      const code = terms.find(({ id }) => id === "cascade:vaccineCode");
      assert.equal(code?.["page"], "cascade/properties/vaccineCode.html");
      assert.equal(code?.["label"], "Vaccine Code");
      assert.deepEqual(code?.["domain"], [VACCINATION]);
      assert.equal(terms.length, 11);
      assert.equal(
        new TextDecoder().decode(tree.get("terms/cascade.ttl")),
        ONTOLOGY,
      );
      assert.equal(
        new TextDecoder().decode(tree.get("terms/cascade.shapes.ttl")),
        SHAPES,
      );
      assert.ok(
        readPage(new TextDecoder().decode(tree.get(TERMS_PAGE))).hrefs.includes(
          "terms.json",
        ),
        "linked as for tools",
      );
    });

    it("writes no JSON for a term of its own", () => {
      assert.deepEqual(
        [...tree.keys()].filter(
          (path) => path.endsWith(".json") && path !== TERMS_JSON,
        ),
        [],
      );
    });

    it("links it from the front page as `terms/`", () => {
      const front = readPage(new TextDecoder().decode(tree.get(FRONT_PAGE)));
      assert.ok(front.hrefs.includes("terms/"));
    });
  });

  describe("given the vocabulary itself", () => {
    let files: Files;
    let real: string;
    let realPages: ReadonlyMap<string, string>;
    let hrefs: readonly string[];
    let ids: ReadonlySet<string>;

    before(async () => {
      ({ files } = await localVocabulary(
        findRoot(dirname(fileURLToPath(import.meta.url))),
      ));
      real = await termReference(files, PLAIN);
      realPages = await termPages(files, PLAIN);
      ({ hrefs, ids } = readPage(real));
    });

    it("keeps the index under 200 KB on disk", () => {
      assert.ok(
        Buffer.byteLength(real) < 200_000,
        `${Buffer.byteLength(real)} bytes`,
      );
    });

    it("gives every term a page of its own, and every link to one lands on a page", () => {
      assert.ok(realPages.size > 300, `${realPages.size} pages`);
      for (const [path, html] of realPages)
        for (const href of readPage(html).hrefs) {
          if (/^[a-z]+:|^#/i.test(href)) continue;
          const target = posix.normalize(posix.join(posix.dirname(path), href));
          if (target.startsWith("..")) continue;
          const file = target.replace(/#.*$/, "");
          assert.ok(
            realPages.has(file) || file === "index.html",
            `${path}: ${href} lands on no page`,
          );
        }
    });

    it("keeps on the index the id of every shape a term's page shows whole, and `#classes`", () => {
      const anchors = [...realPages.values()].flatMap((html) => [
        ...html.matchAll(/<div class="shape" id="([^"]+)"/g),
      ]);
      assert.ok(anchors.length > 50, `${anchors.length} shapes`);
      for (const [, id] of anchors)
        assert.ok(ids.has(id ?? ""), `the index has no anchor ${id}`);
      assert.ok(ids.has("classes"));
    });

    /**
     * The named things the vocabulary declares as a bare `owl:NamedIndividual` that no `sh:in` list holds: the matcher's
     * rules, the rules that name a record, the reasons a record is left out, and two others of one instance of their class.
     * Typing them is the vocabulary's to do; none has a neighbour until it is.
     */
    const ALONE = [
      "cascade:CascadeMatcher",
      "cascade:ContainedRecordNamingRule",
      "cascade:DifferentResultUnitsRule",
      "cascade:DifferentResultValuesRule",
      "cascade:DocumentNamingRule",
      "cascade:EnteredInErrorAtSource",
      "cascade:EnteredRecordNamingRule",
      "cascade:FindingNamingRule",
      "cascade:ImportJudgedErroneous",
      "cascade:JudgedErroneous",
      "cascade:MatcherJudgmentAssertionNamingRule",
      "cascade:MatcherJudgmentNamingRule",
      "cascade:NoPatient",
      "cascade:OrganizationNamingRule",
      "cascade:PatientProfileNotClaimed",
      "cascade:RecordFromCcdaNamingRule",
      "cascade:RecordFromCcdaWithoutIdNamingRule",
      "cascade:RecordFromDocumentNamingRule",
      "cascade:RecordFromServerNamingRule",
      "cascade:RefutedAtSource",
      "cascade:ReleaseRetractionNamingRule",
      "cascade:RevisionNamingRule",
      "cascade:SameBrandGenericRule",
      "cascade:SameBusinessIdentifierAndTestCodeWithinOneOrganizationRule",
      "cascade:SameCodeAndDateRule",
      "cascade:SameCodeAndPeriodRule",
      "cascade:SameCodeRule",
      "cascade:SameConvertedCodeRule",
      "cascade:SameMappedCodeAndDateRule",
      "cascade:SameMappedCodeRule",
      "cascade:SameMedicationCodeRule",
      "cascade:SameNoteOrDocumentMasterIdentifierRule",
      "cascade:SameNoteTypeAndTextGrownWithinOneOrganizationRule",
      "cascade:SameNoteTypeAndTextRule",
      "cascade:SameProductCodeRule",
      "cascade:SameResultOnOneDayRule",
      "cascade:SameResultRule",
      "cascade:SameSelfAssertedBaseUrlAndAuthorizationEndpointOnOneHostRule",
      "cascade:SameVariationRule",
      "cascade:SameVariationThroughTableRule",
      "cascade:ServerNamingRule",
      "cascade:SnapshotNamingRule",
      "cascade:TableRowNamingRule",
      "cascade:TableVersionNamingRule",
      "cascade:VersionNamingRule",
      "cascade:ViewEntryNamingRule",
      "oa:classifying",
    ];

    it("gives every named thing neighbours but those the vocabulary leaves untyped: the other values of a list that holds it, the other instances of its class, or the other members of its scheme", async () => {
      const { terms } = JSON.parse(await termsJson(files)) as {
        terms: { kind: string; page: string; id: string }[];
      };
      const things = terms.filter(({ kind }) => kind === "thing");
      assert.ok(things.length > 100, `${things.length} named things`);
      const alone = things
        .filter(
          ({ page }) =>
            !/<dt>(?:Other values of|Other instances of|Other members of|Members)[ <]/.test(
              realPages.get(page) ?? "",
            ),
        )
        .map(({ id }) => id);
      assert.deepEqual(alone, ALONE);
    });

    it("writes no two pages at paths that differ only by case", () => {
      const seen = new Map<string, string>();
      for (const path of realPages.keys()) {
        const other = seen.get(path.toLowerCase());
        assert.equal(other, undefined, `${path} and ${other}`);
        seen.set(path.toLowerCase(), path);
      }
    });

    it("lists in `terms.json` each term that has a page, and names its page", async () => {
      const { terms } = JSON.parse(await termsJson(files)) as {
        terms: { page: string }[];
      };
      assert.deepEqual(
        terms.map(({ page }) => page).sort(),
        [...realPages.keys()].sort(),
      );
    });

    it("shows no gloss over the limit, and a cut gloss with its whole sentence on hover", () => {
      const glosses = [
        ...real.matchAll(
          /<span class="gloss"( title="[^"]*")?>([^<]*)<\/span>/g,
        ),
      ];
      assert.ok(glosses.length > 20, `${glosses.length} glosses`);
      for (const [, title, escaped] of glosses) {
        const shown = (escaped ?? "").replaceAll(/&#?\w+;/g, "x");
        assert.ok(shown.length <= GLOSS_LIMIT, shown);
        if (shown.endsWith("…")) assert.ok(title !== undefined, shown);
      }
    });

    it("names no vocabulary by its address where a copied term says where it is from", () => {
      const from = [...realPages.values()].flatMap((html) => [
        ...html.matchAll(/<p class="prose about">from ([^<]*)<\/p>/g),
      ]);
      assert.ok(from.length > 0);
      for (const [, source] of from) assert.doesNotMatch(source ?? "", /:\/\//);
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

    it("lists under what a pod holds every class the pod layout says holds records", async () => {
      const layout = await new OxigraphStore().parse(
        (await files.read("runtime/pod-layout.ttl")) ?? new Uint8Array(),
        `${files.iri}runtime/pod-layout.ttl`,
      );
      const holders = new Set(
        layout
          .filter(
            ([, p, o]) =>
              p.value === `${CASCADE}holdsRecords` && o.value === "true",
          )
          .map(([s]) => s.value),
      );
      const classes = layout
        .filter(
          ([s, p]) =>
            holders.has(s.value) &&
            p.value === "http://www.w3.org/ns/solid/terms#forClass",
        )
        .map(([, , o]) => o.value);
      assert.ok(classes.length > 5);
      const held = readPage(partOf(real, "what-a-pod-holds")).hrefs;
      assert.deepEqual(
        classes.filter((iri) => !held.includes(termHref(iri, ""))),
        [],
      );
    });

    it("says none stated nowhere, and of no term copied from PROV-O that it has no definition yet", () => {
      assert.doesNotMatch(real, /<dd><span class="about">none stated/);
      const activity = readPage(entry(realPages, `${PROV}Activity`)).said;
      assert.doesNotMatch(activity, /No definition yet/);
    });

    it("links a query from the page of `cascade:vaccineCode`", () => {
      const blob = files.iri.replace("/tree/", "/blob/");
      const { hrefs: linked } = readPage(entry(realPages, VACCINE_CODE));
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
      const rules = [...realPages.values()]
        .flatMap((html) => readPage(html).hrefs)
        .filter((href) => href.startsWith(SPEC));
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
