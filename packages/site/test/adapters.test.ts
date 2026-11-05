import assert from "node:assert/strict";
import { before, test } from "node:test";
import { type Files, MemoryFiles } from "@cascade-runtime/runtime";
import { hubFiles } from "../src/front-page.js";
import type { AdapterRead, PagesContext } from "../src/hub/context.js";
import { adaptersSection } from "../src/hub/adapters.js";
import { termHref } from "../src/links.js";
import { buildTree } from "../src/sections.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const FHIR_REPOSITORY =
  "https://github.com/jayostis/cascade-bridge-adapter-fhir-r4";
const CCDA_REPOSITORY =
  "https://github.com/jayostis/cascade-bridge-adapter-ccda";
const COMMIT = "4aeb5230a1b2c3d4e5f60718293a4b5c6d7e8f90";
const FHIR_TREE = `${FHIR_REPOSITORY}/tree/${COMMIT}/`;
const FHIR_BLOB = `${FHIR_REPOSITORY}/blob/${COMMIT}/`;
const INDEX = "adapters/index.html";
const FHIR_PAGE = "adapters/fhir-r4/index.html";
const TERMS = "../../terms/";

const ONTOLOGY = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .

cascade:ProblemOrDiagnosis a owl:Class .
cascade:AllergyOrIntolerance a owl:Class .
cascade:snomedCode a owl:DatatypeProperty .
cascade:onsetDate a owl:DatatypeProperty .
cascade:allergen a owl:DatatypeProperty .
`;

const PREFIXES = `@prefix bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#> .
@prefix fhirr4: <https://ns.cascadeprotocol.org/adapter/fhir-r4/v1-draft#> .
@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
`;

/** Two paths sharing a term across two resource types, a path in all four forms, one in the form of a bundle entry alone, and a path of each verdict. */
const ACCOUNTING = `${PREFIXES}
[] a bridge:PathEntry ;
  bridge:sourcePath "/code/coding/code" ;
  bridge:verdict bridge:carried ;
  bridge:carriedAs
    [ bridge:inSourceRecordType "Condition" ; bridge:inRecordClass cascade:ProblemOrDiagnosis ; bridge:asProperty cascade:snomedCode ] ,
    [ bridge:inSourceRecordType "AllergyIntolerance" ; bridge:inRecordClass cascade:AllergyOrIntolerance ; bridge:asProperty cascade:snomedCode ] ,
    [ bridge:inSourceRecordType "Condition" ; bridge:inRecordClass cascade:ProblemOrDiagnosis ; bridge:asProperty cascade:icd10Code ] .

[] a bridge:PathEntry ;
  bridge:sourcePath "/reaction/substance/coding/code" ;
  bridge:verdict bridge:carried ;
  bridge:carriedAs
    [ bridge:inSourceRecordType "AllergyIntolerance" ; bridge:inRecordClass cascade:AllergyOrIntolerance ; bridge:asProperty cascade:snomedCode ] .

[] a bridge:PathEntry ; bridge:sourcePath "/onsetDateTime" ; bridge:verdict bridge:carried ;
  bridge:carriedAs [ bridge:inSourceRecordType "Condition" ; bridge:inRecordClass cascade:ProblemOrDiagnosis ; bridge:asProperty cascade:onsetDate ] .
[] a bridge:PathEntry ; bridge:sourcePath "/resource/onsetDateTime" ; bridge:verdict bridge:carried ;
  bridge:carriedAs [ bridge:inSourceRecordType "Condition" ; bridge:inRecordClass cascade:ProblemOrDiagnosis ; bridge:asProperty cascade:onsetDate ] .
[] a bridge:PathEntry ; bridge:sourcePath "/contained/onsetDateTime" ; bridge:verdict bridge:carried ;
  bridge:carriedAs [ bridge:inSourceRecordType "Condition" ; bridge:inRecordClass cascade:ProblemOrDiagnosis ; bridge:asProperty cascade:onsetDate ] .
[] a bridge:PathEntry ; bridge:sourcePath "/resource/contained/onsetDateTime" ; bridge:verdict bridge:carried ;
  bridge:carriedAs [ bridge:inSourceRecordType "Condition" ; bridge:inRecordClass cascade:ProblemOrDiagnosis ; bridge:asProperty cascade:onsetDate ] .

[] a bridge:PathEntry ;
  bridge:sourcePath "/note/text" ;
  bridge:verdict bridge:carriedInPart ;
  bridge:namesGap fhirr4:onlyTheFirstNote ;
  bridge:carriedAs
    [ bridge:inSourceRecordType "AllergyIntolerance" ; bridge:inRecordClass cascade:AllergyOrIntolerance ; bridge:asProperty cascade:allergen ] .

[] a bridge:PathEntry ;
  bridge:sourcePath "/recordedDate" ;
  bridge:verdict bridge:noHome ;
  bridge:namesGap fhirr4:recordedDate .
[] a bridge:PathEntry ;
  bridge:sourcePath "/contained/recordedDate" ;
  bridge:verdict bridge:noHome ;
  bridge:namesGap fhirr4:recordedDate .

[] a bridge:PathEntry ;
  bridge:sourcePath "/meta/profile" ;
  bridge:verdict bridge:ignored ;
  bridge:because "A profile claim says what the server validated, which the record does not keep." .

[] a bridge:PathEntry ;
  bridge:sourcePath "/resourceType" ;
  bridge:verdict bridge:consumed .

[] a bridge:PathEntry ;
  bridge:sourcePath "/code/coding/display" ;
  bridge:verdict bridge:redundantWith ;
  bridge:sameFactAs "/code/text" .
`;

const GAPS = `${PREFIXES}
fhirr4:recordedDate a skos:Concept ;
  skos:prefLabel "A resource carries the date it was first recorded, and no Cascade predicate carries it."@en .
fhirr4:onlyTheFirstNote a skos:Concept ;
  skos:prefLabel "Only the first note of a resource is carried."@en .
`;

const CRATE = JSON.stringify({
  "@graph": [
    {
      "@id": "ro-crate-metadata.json",
      "@type": "CreativeWork",
      about: { "@id": "./" },
    },
    {
      "@id": "./",
      "@type": ["Dataset", "bridge:Adapter"],
      identifier: "fhir-r4",
      name: "FHIR R4 JSON",
      "bridge:gapScheme": { "@id": "vocab/fhir-gaps.ttl" },
      "bridge:sourceAccounting": { "@id": "vocab/fhir-accounting.ttl" },
    },
  ],
});

const FORMAT = `# FHIR R4 JSON, as the adapter sees it

A record is one **resource**, as [the accounting](../vocab/fhir-accounting.ttl) says.

## What a record is

A resource whose type is mapped.
`;

const encoder = new TextEncoder();

async function adapter(without: readonly string[] = []): Promise<AdapterRead> {
  const files = new MemoryFiles(FHIR_TREE);
  const put = async (path: string, text: string) => {
    if (!without.includes(path)) await files.write(path, encoder.encode(text));
  };
  await put("ro-crate-metadata.json", CRATE);
  await put("vocab/fhir-accounting.ttl", ACCOUNTING);
  await put("vocab/fhir-gaps.ttl", GAPS);
  await put("docs/format.md", FORMAT);
  return { repository: FHIR_REPOSITORY, files, commit: COMMIT };
}

async function vocabulary(): Promise<Files> {
  const files = new MemoryFiles(
    "https://github.com/jayostis/cascade-vocabulary/tree/abc123/",
  );
  await files.write("ontologies/cascade.ttl", encoder.encode(ONTOLOGY));
  return files;
}

async function built(adapters: readonly AdapterRead[]) {
  const files = await vocabulary();
  const { tree } = await buildTree({
    sections: [adaptersSection],
    ctx: {
      adapters: async () => adapters,
      vocabulary: async () => ({ files, builtFrom: [], at: "2026-11-04" }),
      log: () => undefined,
    } as unknown as PagesContext,
    front: (rows) => hubFiles(["Records"], rows),
  });
  const read = (path: string): string => {
    const bytes = tree.get(path);
    assert.ok(bytes, `${path} is written`);
    return new TextDecoder().decode(bytes);
  };
  return Object.assign(read, { has: (path: string) => tree.has(path) });
}

const plain = (markup: string): string =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

interface Row {
  readonly cells: readonly string[];
  readonly hrefs: readonly string[];
}

/** The body rows of the first table after the element with the id. */
function rowsAfter(markup: string, id: string): Row[] {
  const part = markup.split(` id="${id}"`)[1];
  assert.ok(part !== undefined, `no element has the id ${id}`);
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(part)?.[1] ?? "";
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) => ({
    // A source path's cell may say after the path which forms it is in; the path is its first code.
    cells: [...(row ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
      ([, cell], at) =>
        plain(
          (at === 0
            ? /<code>[\s\S]*?<\/code>/.exec(cell ?? "")?.[0]
            : undefined) ??
            cell ??
            "",
        ),
    ),
    hrefs: [...(row ?? "").matchAll(/href="([^"]*)"/g)].map(
      ([, href]) => href ?? "",
    ),
  }));
}

let fhir: string;
let index: string;

before(async () => {
  const read = await built([
    await adapter(),
    { repository: CCDA_REPOSITORY, unavailable: "the fetch failed" },
  ]);
  fhir = read(FHIR_PAGE);
  index = read(INDEX);
});

test("the adapters page gives one row to each adapter: the one built says the commit it was built from and links its page, the one missing says it is not available", () => {
  const rows = rowsAfter(index, "adapters");
  assert.equal(rows.length, 2);
  const [built, missing] = rows;
  assert.ok(built?.cells.join(" ").includes("FHIR R4 JSON"));
  assert.ok(built?.cells.join(" ").includes(COMMIT.slice(0, 7)));
  assert.ok(built?.hrefs.includes("fhir-r4/index.html"));
  assert.ok(missing?.cells.join(" ").includes("cascade-bridge-adapter-ccda"));
  assert.match(missing?.cells.join(" ") ?? "", /not available/i);
  assert.ok(missing?.cells.join(" ").includes("the fetch failed"));
  assert.ok(!missing?.hrefs.some((href) => href.startsWith("ccda")));
});

test("the crosswalk groups its rows by source record type, one row to a path, property and class, each linked to the term's entry where the vocabulary has one", () => {
  const condition = rowsAfter(fhir, "type-Condition");
  const named = (row: Row) => row.cells.slice(0, 3);
  assert.deepEqual(condition.map(named), [
    ["/code/coding/code", "cascade:icd10Code", "cascade:ProblemOrDiagnosis"],
    ["/code/coding/code", "cascade:snomedCode", "cascade:ProblemOrDiagnosis"],
    ["/onsetDateTime", "cascade:onsetDate", "cascade:ProblemOrDiagnosis"],
  ]);
  const allergy = rowsAfter(fhir, "type-AllergyIntolerance");
  assert.deepEqual(allergy.map(named), [
    ["/code/coding/code", "cascade:snomedCode", "cascade:AllergyOrIntolerance"],
    ["/note/text", "cascade:allergen", "cascade:AllergyOrIntolerance"],
    [
      "/reaction/substance/coding/code",
      "cascade:snomedCode",
      "cascade:AllergyOrIntolerance",
    ],
  ]);
  const snomed = termHref(`${CASCADE}snomedCode`, TERMS);
  const [icd10, ...linked] = condition;
  assert.deepEqual(icd10?.hrefs, [
    termHref(`${CASCADE}ProblemOrDiagnosis`, TERMS),
  ]);
  assert.deepEqual(linked[0]?.hrefs, [
    snomed,
    termHref(`${CASCADE}ProblemOrDiagnosis`, TERMS),
  ]);
  assert.equal(snomed, "../../terms/#cascade:snomedCode");
});

test("a path in all four forms is one row that does not name its forms, the page says once what the forms are, and a path in some forms only says which", () => {
  const onsets = rowsAfter(fhir, "type-Condition").filter(
    ({ cells }) => cells[0] === "/onsetDateTime",
  );
  assert.equal(onsets.length, 1);
  assert.doesNotMatch(plain(fhir), /\/resource\/onsetDateTime/);
  assert.doesNotMatch(plain(fhir), /\/contained\/onsetDateTime/);
  assert.equal(fhir.split('id="forms"').length - 1, 1);
  const line = (code: string) =>
    fhir.split("\n").find((one) => one.includes(`<code>${code}</code>`)) ?? "";
  assert.ok(line("/onsetDateTime") !== "");
  assert.doesNotMatch(line("/onsetDateTime"), /only as/);
  assert.match(plain(line("/recordedDate")), /only as \/x ?, \/contained\/x/);
});

test("what is not carried is grouped by verdict: a noHome path with its gap's label, a path carried in part with its gap and what it does carry, an ignored one with why, a consumed one, and one that restates another", () => {
  const gap =
    "A resource carries the date it was first recorded, and no Cascade predicate carries it.";
  assert.deepEqual(
    rowsAfter(fhir, "noHome").map(({ cells }) => cells.slice(0, 2)),
    [["/recordedDate", gap]],
  );
  const [part] = rowsAfter(fhir, "carriedInPart");
  assert.equal(part?.cells[0], "/note/text");
  assert.match(part?.cells[1] ?? "", /Only the first note of a resource/);
  assert.ok(part?.cells.join(" ").includes("cascade:allergen"));
  assert.ok(part?.hrefs.includes(termHref(`${CASCADE}allergen`, TERMS)));
  assert.deepEqual(
    rowsAfter(fhir, "ignored").map(({ cells }) => cells.slice(0, 2)),
    [
      [
        "/meta/profile",
        "A profile claim says what the server validated, which the record does not keep.",
      ],
    ],
  );
  assert.deepEqual(
    rowsAfter(fhir, "consumed").map(({ cells }) => cells[0]),
    ["/resourceType"],
  );
  const [same] = rowsAfter(fhir, "redundantWith");
  assert.equal(same?.cells[0], "/code/coding/display");
  assert.match(same?.cells[1] ?? "", /\/code\/text/);
});

test("the page says the commit it was built from, links the accounting file on GitHub at that commit, and shows the format notes with their relative links on GitHub at it", () => {
  const said = plain(fhir);
  assert.ok(said.includes(COMMIT.slice(0, 7)));
  assert.ok(fhir.includes(`href="${FHIR_TREE}"`));
  assert.ok(fhir.includes(`href="${FHIR_BLOB}vocab/fhir-accounting.ttl"`));
  assert.ok(said.includes("A resource whose type is mapped."));
  assert.equal((fhir.match(/<h1[\s>]/g) ?? []).length, 1);
});

test("an adapter whose accounting cannot be read is listed as not available, with no page, and the build goes on", async () => {
  const read = await built([await adapter(["vocab/fhir-accounting.ttl"])]);
  const said = plain(read(INDEX));
  assert.match(said, /not available/i);
  assert.match(said, /fhir-accounting\.ttl/);
  assert.equal(read.has(FHIR_PAGE), false);
});
