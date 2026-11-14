import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Files, MemoryFiles } from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { readOneFact } from "../src/one-fact.js";
import { hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { AdapterRead, PagesContext } from "../src/hub/context.js";
import { adaptersSection } from "../src/hub/adapters.js";
import { termHref } from "../src/links.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";

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
  bridge:sourcePath "/meta/profile" ;
  bridge:verdict bridge:ignored ;
  bridge:because "A profile claim in a contained resource says what the server validated, which the record does not keep." .

[] a bridge:PathEntry ;
  bridge:sourcePath "/resourceType" ;
  bridge:verdict bridge:consumed .

[] a bridge:PathEntry ;
  bridge:sourcePath "/fullUrl" ;
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

const DOWNLOADS = "conformance/priya-natarajan/scripted-input/priya/downloads/";
const FHIR_ALLERGY = `${DOWNLOADS}x-e2/apple_health_export/clinical-records/AllergyIntolerance-alg-aspirin-1.json`;
const KESTREL = `${DOWNLOADS}kestrel-harbor-health-summary.xml`;
const FERNHILL = `${DOWNLOADS}fernhill-family-clinic-summary.xml`;
const RECORD = "conformance/priya-natarajan/expected/allergies.ttl";

const allergy = (
  substance: string,
  reaction: string | undefined,
) => `<observation classCode="OBS" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.7"/>
<templateId root="2.16.840.1.113883.10.20.22.4.7" extension="2014-06-09"/>
<participant typeCode="CSM"><participantRole classCode="MANU"><playingEntity classCode="MMAT">
<code code="${substance}" displayName="substance" codeSystem="2.16.840.1.113883.6.88" codeSystemName="RxNorm"/>
</playingEntity></participantRole></participant>${
  reaction === undefined
    ? ""
    : `<entryRelationship typeCode="MFST"><observation classCode="OBS" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.9"/>
<templateId root="2.16.840.1.113883.10.20.22.4.9" extension="2014-06-09"/><code code="ASSERTION" codeSystem="2.16.840.1.113883.5.4"/>
<value xsi:type="CD" code="${reaction}" displayName="Urticaria" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT"/></observation></entryRelationship>`
}</observation>`;

const ccda = (substance: string, reaction: string) =>
  allergy(substance, reaction);

/** Priya's aspirin allergy as the vocabulary's conformance folder holds it: in FHIR, in two C-CDAs, and as the record. */
const PRIYA: Readonly<Record<string, string>> = {
  [FHIR_ALLERGY]: JSON.stringify({
    resourceType: "AllergyIntolerance",
    code: {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: "1191",
          display: "aspirin",
        },
      ],
    },
    reaction: [
      {
        manifestation: [
          {
            coding: [{ system: "http://snomed.info/sct", code: "126485001" }],
          },
        ],
      },
    ],
  }),
  [KESTREL]: ccda("1191", "126485001"),
  [FERNHILL]: ccda("1191", "126485001"),
  [RECORD]: `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .

[] a cascade:AllergyOrIntolerance ;
  cascade:allergen "Aspirin" ;
  cascade:allergenCode <https://ns.cascadeprotocol.org/codes/rxnorm/1191> ;
  cascade:reactionManifestationCode <http://snomed.info/id/126485001> .
`,
};

async function adapter(
  without: readonly string[] = [],
  changed: Readonly<Record<string, string>> = {},
): Promise<AdapterRead> {
  const files = new MemoryFiles(FHIR_TREE);
  const put = async (path: string, text: string) => {
    if (!without.includes(path))
      await files.write(path, encoder.encode(changed[path] ?? text));
  };
  await put("ro-crate-metadata.json", CRATE);
  await put("vocab/fhir-accounting.ttl", ACCOUNTING);
  await put("vocab/fhir-gaps.ttl", GAPS);
  await put("docs/format.md", FORMAT);
  return { repository: FHIR_REPOSITORY, files, commit: COMMIT };
}

async function vocabulary(
  changed: Readonly<Record<string, string | undefined>> = {},
): Promise<Files> {
  const files = new MemoryFiles(
    "https://github.com/jayostis/cascade-vocabulary/tree/abc123/",
  );
  await files.write("ontologies/cascade.ttl", encoder.encode(ONTOLOGY));
  for (const [path, text] of Object.entries({ ...PRIYA, ...changed }))
    if (text !== undefined) await files.write(path, encoder.encode(text));
  return files;
}

async function built(
  adapters: readonly AdapterRead[],
  changed: Readonly<Record<string, string | undefined>> = {},
) {
  const files = await vocabulary(changed);
  const { tree } = await buildTree({
    sections: [adaptersSection],
    ctx: {
      adapters: async () => adapters,
      vocabulary: async () => ({ files, builtFrom: [], at: "2026-11-04" }),
      log: () => undefined,
      chrome: PLAIN,
    } as unknown as PagesContext,
    front: (rows) => hubFiles(["Records"], rows, PLAIN),
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

/** The line of `page` that holds the source path `code`. */
const line = (page: string, code: string): string =>
  page.split("\n").find((one) => one.includes(`<code>${code}</code>`)) ?? "";

/** The adapters page and the accounting of one adapter, built from `changed` files of an adapter that has all four. */
async function pagesOf(
  without: readonly string[] = [],
  changed: Readonly<Record<string, string>> = {},
) {
  const read = await built([await adapter(without, changed)]);
  return { read, said: plain(read(INDEX)) };
}

/** A crate whose one node has `identifier`, and names `accounting` as its accounting when one is given. */
const crate = (identifier: string, accounting?: string) =>
  JSON.stringify({
    "@graph": [
      {
        "@id": "./",
        identifier,
        name: "X",
        ...(accounting === undefined
          ? {}
          : { "bridge:sourceAccounting": { "@id": accounting } }),
      },
    ],
  });

/**
 * An adapter keeps an accounting: for every source path of its format, whether the value is carried into a record, and as
 * which vocabulary term. The site shows each accounting as a crosswalk, so a developer sees where a field of FHIR or C-CDA
 * ends up, and what is left behind and why.
 */
describe("The adapters page and an adapter's crosswalk · adaptersSection", () => {
  let fhir: string;

  before(async () => {
    fhir = (await built([await adapter()]))(FHIR_PAGE);
  });

  describe("with `adapters/index.html`", () => {
    it("counts a source path once for a verdict, whatever forms and reasons the accounting writes it with", () => {
      // carried whole, carried in part, not carried: /recordedDate, /meta/profile, /resourceType, /fullUrl, /code/coding/display
      assert.match(plain(fhir), /5 not carried/);
      assert.match(plain(fhir), /Deliberately not carried 1 path\b/);
    });
  });

  describe("with an adapter's crosswalk", () => {
    const named = (row: Row) => row.cells.slice(0, 3);

    it("groups what is carried by the source's record type, one line to a source path, property and class", () => {
      assert.deepEqual(rowsAfter(fhir, "type-Condition").map(named), [
        [
          "/code/coding/code",
          "cascade:icd10Code",
          "cascade:ProblemOrDiagnosis",
        ],
        [
          "/code/coding/code",
          "cascade:snomedCode",
          "cascade:ProblemOrDiagnosis",
        ],
        ["/onsetDateTime", "cascade:onsetDate", "cascade:ProblemOrDiagnosis"],
      ]);
      assert.deepEqual(rowsAfter(fhir, "type-AllergyIntolerance").map(named), [
        [
          "/code/coding/code",
          "cascade:snomedCode",
          "cascade:AllergyOrIntolerance",
        ],
        ["/note/text", "cascade:allergen", "cascade:AllergyOrIntolerance"],
        [
          "/reaction/substance/coding/code",
          "cascade:snomedCode",
          "cascade:AllergyOrIntolerance",
        ],
      ]);
    });

    it("links each property and class to the term reference, where it is a vocabulary term", () => {
      const snomed = termHref(`${CASCADE}snomedCode`, TERMS);
      const [icd10, snomedLine] = rowsAfter(fhir, "type-Condition");
      // The fixture's ontology has no icd10Code: its line links the class alone.
      assert.deepEqual(icd10?.hrefs, [
        termHref(`${CASCADE}ProblemOrDiagnosis`, TERMS),
      ]);
      assert.deepEqual(snomedLine?.hrefs, [
        snomed,
        termHref(`${CASCADE}ProblemOrDiagnosis`, TERMS),
      ]);
      assert.equal(snomed, "../../terms/#cascade:snomedCode");
    });

    it("says the commit it was built from, and links the adapter and its accounting on GitHub at that commit", () => {
      assert.ok(plain(fhir).includes(COMMIT.slice(0, 7)));
      assert.ok(fhir.includes(`href="${FHIR_TREE}"`));
      assert.ok(fhir.includes(`href="${FHIR_BLOB}vocab/fhir-accounting.ttl"`));
    });

    it("shows the adapter's notes on its format, under the page's one main heading", () => {
      assert.ok(plain(fhir).includes("A resource whose type is mapped."));
      assert.equal((fhir.match(/<h1[\s>]/g) ?? []).length, 1);
    });
  });

  /**
   * A FHIR value may sit in a resource, in a Bundle entry's resource, in a contained resource, or in a contained resource of
   * a Bundle entry: `/x`, `/resource/x`, `/contained/x` and `/resource/contained/x`, the four forms. The accounting lists
   * each, and the crosswalk shows them as one source path.
   */
  describe("with a source path that FHIR writes in several forms", () => {
    it("gives a source path in all four forms one line, with no form named", () => {
      const onsets = rowsAfter(fhir, "type-Condition").filter(
        ({ cells }) => cells[0] === "/onsetDateTime",
      );
      assert.equal(onsets.length, 1);
      assert.doesNotMatch(plain(fhir), /\/resource\/onsetDateTime/);
      assert.doesNotMatch(plain(fhir), /\/contained\/onsetDateTime/);
      assert.notEqual(line(fhir, "/onsetDateTime"), "");
      assert.doesNotMatch(line(fhir, "/onsetDateTime"), /only as/);
    });

    it("says once what the four forms are", () => {
      assert.equal(fhir.split('id="forms"').length - 1, 1);
    });

    it("says which forms a source path is in, where it is in some only", () => {
      assert.match(
        plain(line(fhir, "/recordedDate")),
        /only as \/x ?, \/contained\/x/,
      );
    });

    it("says a Bundle entry's own member is one, and is not in one form only", () => {
      assert.notEqual(line(fhir, "/fullUrl"), "");
      assert.doesNotMatch(plain(line(fhir, "/fullUrl")), /only as/);
      assert.match(plain(line(fhir, "/fullUrl")), /Bundle entry/);
    });
  });

  describe("with what an adapter does not carry", () => {
    it("lists a source path that has no home once, with its gap's text", () => {
      // The accounting writes the path twice, as /recordedDate and as /contained/recordedDate.
      assert.deepEqual(
        rowsAfter(fhir, "noHome").map(({ cells }) => cells.slice(0, 2)),
        [
          [
            "/recordedDate",
            "A resource carries the date it was first recorded, and no Cascade predicate carries it.",
          ],
        ],
      );
    });

    it("lists a source path carried in part with its gap and the vocabulary term it does carry", () => {
      const [part] = rowsAfter(fhir, "carriedInPart");
      assert.equal(part?.cells[0], "/note/text");
      assert.match(part?.cells[1] ?? "", /Only the first note of a resource/);
      assert.ok(part?.cells.join(" ").includes("cascade:allergen"));
      assert.ok(part?.hrefs.includes(termHref(`${CASCADE}allergen`, TERMS)));
    });

    it("lists an ignored source path with why, once for each reason", () => {
      const ignored = rowsAfter(fhir, "ignored");
      assert.deepEqual(
        ignored.map(({ cells }) => cells[0]),
        ["/meta/profile", "/meta/profile"],
      );
      assert.ok(
        ignored.some(
          ({ cells }) =>
            cells[1] ===
            "A profile claim says what the server validated, which the record does not keep.",
        ),
      );
    });

    it("lists the source paths the adapter consumes", () => {
      assert.deepEqual(
        rowsAfter(fhir, "consumed").map(({ cells }) => cells[0]),
        ["/fullUrl", "/resourceType"],
      );
    });

    it("lists a source path that restates another, naming the other", () => {
      const [same] = rowsAfter(fhir, "redundantWith");
      assert.equal(same?.cells[0], "/code/coding/display");
      assert.match(same?.cells[1] ?? "", /\/code\/text/);
    });
  });

  describe("with a source path the accounting calls carried and names no vocabulary term for", () => {
    it("lists it apart, and does not drop it", async () => {
      const { read } = await pagesOf([], {
        "vocab/fhir-accounting.ttl": `${ACCOUNTING}
[] a bridge:PathEntry ; bridge:sourcePath "/id" ; bridge:verdict bridge:carried .
`,
      });
      const [row] = rowsAfter(read(FHIR_PAGE), "unnamed");
      assert.equal(row?.cells[0], "/id");
    });
  });

  describe("with an accounting the site cannot use", () => {
    it("lists an adapter whose accounting is missing as not available, naming the file, with no crosswalk", async () => {
      const { read, said } = await pagesOf(["vocab/fhir-accounting.ttl"]);
      assert.match(said, /not available/i);
      assert.match(said, /fhir-accounting\.ttl/);
      assert.equal(read.has(FHIR_PAGE), false);
    });

    it("lists an adapter whose accounting is not Turtle as not available", async () => {
      const { read, said } = await pagesOf([], {
        "vocab/fhir-accounting.ttl": "[] a <broken",
      });
      assert.match(said, /Not available/);
      assert.match(said, /cannot be read/);
      assert.equal(read.has(FHIR_PAGE), false);
    });

    it("lists an adapter whose identifier is a path as not available, and writes nothing in that path", async () => {
      const { read, said } = await pagesOf([], {
        "ro-crate-metadata.json": crate("../evil", "vocab/fhir-accounting.ttl"),
      });
      assert.match(said, /Not available/);
      assert.match(said, /no identifier a folder can take its name from/);
      assert.equal(read.has("adapters/evil/index.html"), false);
    });

    it("lists an adapter that names no accounting as not available", async () => {
      const { said } = await pagesOf([], {
        "ro-crate-metadata.json": crate("fhir-r4"),
      });
      assert.match(said, /Not available/);
      assert.match(said, /names no bridge:sourceAccounting/);
    });

    it("writes a crosswalk with no line for an empty accounting", async () => {
      const { read } = await pagesOf([], { "vocab/fhir-accounting.ttl": "" });
      assert.doesNotMatch(read(FHIR_PAGE), /<tbody>/);
    });
  });
});

const SPEC = "https://github.com/jayostis/cascade-bridge-spec";

/**
 * A builder with one more source format to bring in asks whether that means one more engine. The adapters page answers
 * on one screen, before any adapter's detail: the problem, one allergy followed through three source forms to one
 * record, four reasons, and a card for each adapter.
 */
describe("The adapters page says what an adapter is on one screen · adaptersIndex()", () => {
  let page: ReturnType<typeof readPage>;
  let markup: string;

  before(async () => {
    const read = await built([
      await adapter(),
      { repository: CCDA_REPOSITORY, unavailable: "the fetch failed" },
    ]);
    markup = read(INDEX);
    page = readPage(markup, INDEX);
  });

  /** The text of the part of the page that starts at the element with `id`, up to the next `h2`. */
  const part = (id: string): string =>
    plain(markup.split(` id="${id}"`)[1]?.split("<h2")[0] ?? "");

  describe("with the builder's problem", () => {
    it("leads with one more source format without one more engine, and names the one Bridge", () => {
      assert.match(page.h1, /one more source format/i);
      assert.match(page.h1, /without one more engine/i);
      assert.match(page.said, /cascade-bridge-rs is the one Bridge today/);
    });
  });

  describe("with one fact in three forms", () => {
    it("holds the aspirin allergy from a FHIR resource and two C-CDAs, joined to the one record it becomes", () => {
      const said = part("one-fact-three-forms");
      assert.equal(said.match(/FHIR R4 JSON/g)?.length, 1);
      assert.equal(said.match(/C-CDA/g)?.length, 2);
      assert.equal(markup.match(/class="form"/g)?.length, 3);
      assert.equal(markup.match(/class="record"/g)?.length, 1);
      assert.ok(said.includes("1191"));
      assert.ok(said.includes("126485001"));
      assert.ok(said.includes("cascade:allergenCode"));
      assert.ok(said.includes("Aspirin"));
    });

    it("reads each value from the vocabulary's files, never from the page's own text", async () => {
      const read = await built([await adapter()], {
        [FHIR_ALLERGY]: PRIYA[FHIR_ALLERGY]?.replaceAll("1191", "7777"),
        [KESTREL]: PRIYA[KESTREL]?.replaceAll("1191", "7777"),
        [FERNHILL]: PRIYA[FERNHILL]?.replaceAll("1191", "7777"),
        [RECORD]: PRIYA[RECORD]?.replaceAll("1191", "7777"),
      });
      const said = plain(read(INDEX));
      assert.ok(said.includes("7777"));
      assert.ok(!said.includes("1191"));
    });

    it("links each source file and the record's file on GitHub at the vocabulary's commit", () => {
      const base =
        "https://github.com/jayostis/cascade-vocabulary/blob/abc123/";
      for (const path of [FHIR_ALLERGY, KESTREL, FERNHILL, RECORD])
        assert.ok(page.hrefs.includes(base + path), path);
    });

    it("fails the build when one of its files is missing", async () => {
      await assert.rejects(
        built([await adapter()], { [FERNHILL]: undefined }),
        /not in the vocabulary/,
      );
    });

    it("fails the build when a file has no code to read", async () => {
      await assert.rejects(
        built([await adapter()], { [KESTREL]: "<x/>" }),
        /no entry for RxNorm code 1191/,
      );
    });

    it("reads a C-CDA's values from the entry whose substance is the FHIR resource's, however many allergies come first", async () => {
      const read = await built([await adapter()], {
        [KESTREL]:
          allergy("7980", "271807003") +
          allergy("1191", "126485001") +
          allergy("2670", "271807003"),
      });
      const said = plain(read(INDEX));
      assert.ok(said.includes("126485001"));
      assert.ok(!said.includes("7980"));
      assert.ok(!said.includes("271807003"));
    });

    it("fails the build when that entry has no reaction, though another allergy's has one", async () => {
      await assert.rejects(
        built([await adapter()], {
          [KESTREL]: allergy("1191", undefined) + allergy("7980", "271807003"),
        }),
        /no reaction code in the entry for RxNorm code 1191/,
      );
    });

    it("labels each value with the adapter's own source path, a break allowed only after a slash", () => {
      assert.ok(markup.includes("/<wbr>ClinicalDocument/<wbr>component/<wbr>"));
      assert.ok(
        markup.includes(
          "participantRole/<wbr>playingEntity/<wbr>code/<wbr>@code",
        ),
      );
      assert.ok(markup.includes("/<wbr>code/<wbr>coding/<wbr>code"));
      assert.doesNotMatch(markup, /\(reaction\)/);
    });

    it("builds from the vocabulary's real conformance files", async () => {
      const root = findRoot(dirname(fileURLToPath(import.meta.url)));
      const { files } = await localVocabulary(root);
      const { sources, record } = await readOneFact(files);
      for (const shown of [...sources, record])
        for (const [, value] of shown.rows) assert.ok(value.length > 0);
    });
  });

  describe("with the reasons", () => {
    it("gives four, and says an adapter takes no new engine, is tested alike, accounts for every path, and there will be many", () => {
      const reasons = part("reasons");
      assert.equal(
        markup.split(' id="reasons"')[1]?.split("</ol>")[0]?.match(/<li>/g)
          ?.length,
        4,
      );
      assert.match(reasons, /no new engine/i);
      assert.match(reasons, /tested the same way/i);
      assert.match(reasons, /every source path/i);
      assert.match(reasons, /reported with its reason/i);
      assert.match(reasons, /many/i);
    });
  });

  describe("with a card for each adapter", () => {
    it("links an adapter's card to its page, with its name and a sentence", () => {
      const cards = part("adapters");
      assert.ok(cards.includes("FHIR R4 JSON"));
      assert.ok(page.hrefs.includes(FHIR_PAGE));
    });

    it("says an adapter that could not be fetched is not available, and why, with no link", () => {
      const cards = part("adapters");
      assert.match(cards, /cascade-bridge-adapter-ccda/);
      assert.match(cards, /not available/i);
      assert.ok(cards.includes("the fetch failed"));
      assert.ok(!page.hrefs.some((href) => href.startsWith("adapters/ccda")));
    });
  });

  describe("with the specification", () => {
    it("links what is in an adapter and how to write one, to the Bridge specification's adapter folder and its README", () => {
      assert.ok(page.hrefs.includes(`${SPEC}/tree/main/adapter`));
      assert.ok(page.hrefs.includes(`${SPEC}/blob/main/adapter/README.md`));
    });
  });

  describe("with figures", () => {
    it("gives no exact count of paths, cases or passes", () => {
      assert.doesNotMatch(
        page.said,
        /\d[\d,]*\s+(?:source\s+)?(?:paths?|cases?|passed|tests?)\b/i,
      );
      assert.doesNotMatch(page.said, /\b(?:paths?|cases?|passed)\s*:?\s*\d/i);
    });
  });
});
