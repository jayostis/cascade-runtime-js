import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import {
  connectFiles,
  fhirPull,
  type PullFiles,
  pullFiles,
  readConnect,
  type SavedConnect,
} from "../src/index.js";

const BASE = "https://cascade-north.demo.invalid/fhir";
const BUNDLE = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      fullUrl: `${BASE}/Patient/p1`,
      resource: { resourceType: "Patient", id: "p1" },
    },
    {
      fullUrl: `${BASE}/AllergyIntolerance/a1`,
      resource: { resourceType: "AllergyIntolerance", id: "a1" },
    },
    {
      fullUrl: `${BASE}/MedicationRequest/m1`,
      resource: { resourceType: "MedicationRequest", id: "m1" },
    },
    {
      fullUrl: `${BASE}/Observation/o1`,
      resource: {
        resourceType: "Observation",
        id: "o1",
        category: [{ coding: [{ code: "laboratory" }] }],
      },
    },
    {
      fullUrl: `${BASE}/Observation/o2`,
      resource: {
        resourceType: "Observation",
        id: "o2",
        category: [{ coding: [{ code: "vital-signs" }] }],
      },
    },
    {
      fullUrl: `${BASE}/Observation/o3`,
      resource: {
        resourceType: "Observation",
        id: "o3",
        category: [
          null,
          { coding: { code: "laboratory" } },
          { coding: [null] },
        ],
      },
    },
    {
      fullUrl: `${BASE}/Observation/o4`,
      resource: {
        resourceType: "Observation",
        id: "o4",
        category: [{ coding: [{ code: "laboratory" }] }],
        hasMember: [{ reference: "Observation/o1" }],
      },
    },
    {
      fullUrl: `${BASE}/DiagnosticReport/r1`,
      resource: { resourceType: "DiagnosticReport", id: "r1" },
    },
    {
      fullUrl: `${BASE}/DocumentReference/n1`,
      resource: { resourceType: "DocumentReference", id: "n1" },
    },
    {
      fullUrl: `${BASE}/DocumentReference/n2`,
      resource: {
        resourceType: "DocumentReference",
        id: "n2",
        content: [
          {
            attachment: { contentType: "application/xml", url: "Binary/n2" },
            format: {
              system:
                "http://terminology.hl7.org/CodeSystem/v3-HL7DocumentFormatCodes",
              code: "urn:hl7-org:sdwg:ccda-structuredBody:2.1",
            },
          },
        ],
      },
    },
    {
      fullUrl: `${BASE}/DocumentReference/n3`,
      resource: {
        resourceType: "DocumentReference",
        id: "n3",
        content: [
          {
            attachment: { contentType: "application/xml", url: "Binary/x" },
            format: {
              system:
                "http://terminology.hl7.org/CodeSystem/v3-HL7DocumentFormatCodes",
              code: "urn:hl7-org:sdwg:ccda-nonXMLBody:2.1",
            },
          },
        ],
      },
    },
    {
      fullUrl: `${BASE}/DocumentReference/n4`,
      resource: {
        resourceType: "DocumentReference",
        id: "n4",
        content: [
          {
            attachment: { contentType: "application/xml", url: "Binary/x" },
            format: {
              system: "http://ihe.net/fhir/ValueSet/IHE.FormatCode.codesystem",
              code: "urn:hl7-org:sdwg:ccda-structuredBody:2.1",
            },
          },
        ],
      },
    },
    {
      fullUrl: `${BASE}/Encounter/e1`,
      resource: { resourceType: "Encounter", id: "e1" },
    },
    {
      fullUrl: `${BASE}/Medication/d1`,
      resource: { resourceType: "Medication", id: "d1" },
    },
  ],
};
const PULL = {
  fhirBase: BASE,
  patient: "p1",
  source: "Cascade North Demo Hospital",
  retrievedAt: "2026-10-07T07:00:00.000Z",
  bundle: BUNDLE,
  missing: [],
  denied: [],
};

type Pull = Parameters<typeof pullFiles>[0];

const PREFIXES = `PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
  PREFIX prov: <http://www.w3.org/ns/prov#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> PREFIX pav: <http://purl.org/pav/>
  PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CCD = encoder.encode(
  '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"/>',
);

/** Two C-CDA documents a pull found: one it read, and one the hospital would not give. */
const DOCUMENTS = [
  {
    documentReference: "DocumentReference/n2",
    content: 0,
    url: "Binary/n2",
    retrievedFrom: `${BASE}/Binary/n2`,
    bytes: CCD,
  },
  {
    documentReference: "DocumentReference/n6",
    content: 1,
    url: "Binary/n6",
    notRead: "the hospital answered 404",
  },
];

const BAD_DOCUMENTS =
  "pull.json's documents is not a list of C-CDA documents, each a DocumentReference's content, read into a file of the folder or said why not";

/** What a refusal of each part of a pull says. */
const WHY = {
  fhirBase:
    "pull.json's fhirBase is not an https: URL with no query, fragment or trailing slash",
  patient: "pull.json's patient is not a FHIR id",
  source: "pull.json's source is not a name",
  retrievedAt: "pull.json's retrievedAt is not a time in UTC",
  asOf: "pull.json's asOf is not a time in UTC",
  searches:
    "pull.json's searches is not a list of searches, each a resource type and an optional category",
  denied:
    "pull.json's denied is not a list of searches, each a resource type and an optional category",
} as const;

type Part = keyof typeof WHY;

/** Each way a pull is one the import cannot state: what is named, what it is changed to, and the part refused. */
const REFUSED: readonly [name: string, changed: object, part: Part][] = [
  ["no fhirBase", { fhirBase: undefined }, "fhirBase"],
  [
    "an http: base",
    { fhirBase: "http://cascade-north.demo.invalid/fhir" },
    "fhirBase",
  ],
  ["a base with a query", { fhirBase: `${BASE}?tenant=a` }, "fhirBase"],
  ["a base with a trailing slash", { fhirBase: `${BASE}/` }, "fhirBase"],
  ["a base with a space around it", { fhirBase: ` ${BASE}` }, "fhirBase"],
  ["a patient that is no FHIR id", { patient: "pt 1" }, "patient"],
  ["no source", { source: " " }, "source"],
  [
    "a time with an offset",
    { retrievedAt: "2026-10-07T07:00:00+01:00" },
    "retrievedAt",
  ],
  [
    "a day that does not exist",
    { retrievedAt: "2026-02-31T07:00:00Z" },
    "retrievedAt",
  ],
  [
    "an hour past the day",
    { retrievedAt: "2026-10-07T24:00:00Z" },
    "retrievedAt",
  ],
  ["an as-of date with no time", { asOf: "2024-02-01" }, "asOf"],
  ["searches that are no list", { searches: {} }, "searches"],
  [
    "a denied search with no resource type",
    { denied: [{ category: "laboratory" }] },
    "denied",
  ],
  [
    "a search with an empty category",
    { searches: [{ type: "Observation", category: "" }] },
    "searches",
  ],
  [
    "a denied search whose category is no string",
    { denied: [{ type: "Observation", category: 3 }] },
    "denied",
  ],
  [
    "a search whose resource type is lowercase",
    { searches: [{ type: "observation" }] },
    "searches",
  ],
];

const refusedFor = (...parts: Part[]) =>
  REFUSED.filter(([, , part]) => parts.includes(part));

function filesOf(map: ReadonlyMap<string, Uint8Array>): PullFiles {
  return { read: (path) => Promise.resolve(map.get(path)) };
}

/** A saved pull whose `pull.json` is written by hand, so that it can hold what `pullFiles` would refuse. */
function withPull(changed: object): PullFiles {
  const { bundle, ...rest } = { ...PULL, ...changed };
  return filesOf(
    new Map([
      ["north/pull.json", encoder.encode(JSON.stringify(rest))],
      ["north/bundle.json", encoder.encode(JSON.stringify(bundle))],
    ]),
  );
}

/** A pull saved with `bundle.json` holding only the Bundle's resources with these ids. */
function savedWith(ids: readonly string[], documents?: Pull["documents"]) {
  return filesOf(
    pullFiles(
      {
        ...PULL,
        bundle: {
          ...BUNDLE,
          entry: BUNDLE.entry.filter(({ resource }) =>
            ids.includes(resource.id),
          ),
        },
        ...(documents === undefined ? {} : { documents }),
      },
      "north",
    ),
  );
}

/** A saved pull with one C-CDA document, its `pull.json` naming where it was read from as `retrievedFrom`. */
function withRead(retrievedFrom: string): PullFiles {
  const saved = new Map(pullFiles(PULL, "north"));
  const { bundle, ...rest } = PULL;
  void bundle;
  saved.set(
    "north/pull.json",
    encoder.encode(
      JSON.stringify({
        ...rest,
        documents: [
          {
            documentReference: "DocumentReference/n2",
            content: 0,
            url: "Binary/n2",
            path: "document-1.xml",
            retrievedFrom,
          },
        ],
      }),
    ),
  );
  saved.set("north/document-1.xml", CCD);
  return filesOf(saved);
}

const jsonOf = (files: ReadonlyMap<string, Uint8Array>, path: string) =>
  JSON.parse(decoder.decode(files.get(path))) as Record<string, unknown>;

/** The facts of the pull's document at `at`, the Bundle by default, in a store. */
async function stated(pull: Pull, at = 0): Promise<oxigraph.Store> {
  const documents =
    (await fhirPull.documents(filesOf(pullFiles(pull, "north")), "north")) ??
    [];
  const store = new oxigraph.Store();
  store.load(documents[at]!.facts("2026-10-07T08:00:00Z"), {
    format: "text/turtle",
  });
  return store;
}

const ask = (store: oxigraph.Store, query: string): unknown =>
  store.query(`${PREFIXES}
      ${query}`);

/** What the document states with each of the `predicates`, as `<predicate> <object>` with the last word of each, in order. */
function statements(store: oxigraph.Store, predicates: string): string[] {
  return (
    ask(
      store,
      `SELECT ?p ?o WHERE { bridge:thisDocument ?p ?o FILTER (?p IN (${predicates})) }`,
    ) as Map<string, oxigraph.Term>[]
  )
    .map(
      (row) =>
        `${row.get("p")!.value.split(/[#/]/).pop()} ${row.get("o")!.value.split("#").pop()}`,
    )
    .sort();
}

/**
 * `pullFiles` turns what `pull()` fetched from a hospital into the files of one folder, which `pod.look()` and
 * `pod.import()` take as they take an export: `bundle.json`, the FHIR resources; `pull.json`, everything else the
 * pull holds; and a file for each C-CDA document the pull read. `pull` is what `pull()` fetched, and `name` is the name
 * of the folder the files are saved under.
 */
describe("Saving a pull as files · pullFiles()", () => {
  describe("pullFiles(pull, name)", () => {
    let saved: ReadonlyMap<string, Uint8Array>;

    before(() => {
      saved = pullFiles({ ...PULL, documents: DOCUMENTS }, "north");
    });

    it("returns `pull.json` and `bundle.json` under the folder's name", () => {
      assert.deepEqual([...pullFiles(PULL, "north").keys()].sort(), [
        "north/bundle.json",
        "north/pull.json",
      ]);
    });

    it("saves each C-CDA document read as `document-<n>.xml`, and gives its path in `pull.json`", () => {
      assert.deepEqual(saved.get("north/document-1.xml"), CCD);
      assert.deepEqual(
        (jsonOf(saved, "north/pull.json").documents as unknown[])[0],
        {
          documentReference: "DocumentReference/n2",
          content: 0,
          url: "Binary/n2",
          retrievedFrom: `${BASE}/Binary/n2`,
          path: "document-1.xml",
        },
      );
    });

    // A C-CDA document the pull asked for and did not get, such as one the hospital answered 404 for, is kept in
    // `pull.json` as `notRead`, holding the hospital's words.
    it("keeps, for a document the hospital would not give, its words in `notRead`, and no `path`", () => {
      assert.deepEqual(
        (jsonOf(saved, "north/pull.json").documents as unknown[])[1],
        {
          documentReference: "DocumentReference/n6",
          content: 1,
          url: "Binary/n6",
          notRead: "the hospital answered 404",
        },
      );
    });

    it("leaves `documents` out of `pull.json` for a pull that read none", () => {
      const none = pullFiles({ ...PULL, documents: [] }, "north");
      assert.equal("documents" in jsonOf(none, "north/pull.json"), false);
    });

    it("saves once a document whose bytes two entries of the pull hold", () => {
      const twice = pullFiles(
        {
          ...PULL,
          documents: [
            {
              documentReference: "DocumentReference/n2",
              content: 0,
              retrievedFrom: `${BASE}/DocumentReference/n2`,
              bytes: CCD,
            },
            {
              documentReference: "DocumentReference/n4",
              content: 0,
              url: "Binary/n4",
              retrievedFrom: `${BASE}/Binary/n4`,
              bytes: CCD.slice(),
            },
          ],
        },
        "north",
      );
      assert.deepEqual(
        [...twice.keys()].filter((path) => path.includes("document-")),
        ["north/document-1.xml"],
      );
    });

    it("throws `TypeError` for a name that is not one folder's name", () => {
      for (const name of ["", "..", "a/b"])
        assert.throws(
          () => pullFiles(PULL, name),
          {
            name: "TypeError",
            message: `a pull is saved under one folder name, not ${name}`,
          },
          JSON.stringify(name),
        );
    });
  });
});

/**
 * An import states where a pull came from, so a pull whose `pull.json` does not say so plainly is refused, with a
 * sentence that says which part. `pullFiles` refuses it before it is saved, and `documents` refuses one saved some other
 * way. Each sentence reaches the person who asked for the import. `files` is what reads a saved folder's files, by path
 * (`read(path)`, and `list(folder)` for the paths under a folder), and `folder` names the saved pull's folder in it.
 * @rule runtime/arrivals.feature A14
 */
describe("Refusing a pull an import cannot state · PullRefused, pullFiles(), fhirPull.documents()", () => {
  describe("pullFiles(pull, name)", () => {
    /** Each pull of `REFUSED` that changes these parts of a pull is refused as `WHY` says. */
    const refuses =
      (...parts: Part[]) =>
      () => {
        const rows = refusedFor(...parts);
        assert.ok(rows.length > 0);
        for (const [name, changed, part] of rows)
          assert.throws(
            () => pullFiles({ ...PULL, ...changed } as Pull, "north"),
            { name: "PullRefused", message: WHY[part] },
            name,
          );
      };

    it(
      "throws `PullRefused` for a FHIR base that is not a plain `https:` URL",
      refuses("fhirBase"),
    );
    it(
      "throws `PullRefused` for a patient that is no FHIR id",
      refuses("patient"),
    );
    it("throws `PullRefused` for a source with no name", refuses("source"));
    it(
      "throws `PullRefused` for a time of the pull that is not a real time in UTC",
      refuses("retrievedAt"),
    );
    it("throws `PullRefused` for an as-of date with no time", refuses("asOf"));
    it(
      "throws `PullRefused` for a list of searches, answered or denied, that is not one",
      refuses("searches", "denied"),
    );
  });

  describe("fhirPull.documents(files, folder)", () => {
    it("rejects with `PullRefused`, giving the sentence `pullFiles()` gives, for each pull `pullFiles()` refuses, saved as a `pull.json`", async () => {
      for (const [name, changed, part] of REFUSED)
        await assert.rejects(
          fhirPull.documents(withPull(changed), "north"),
          { name: "PullRefused", message: WHY[part] },
          name,
        );
    });

    it("rejects for a `pull.json` that is not a JSON object", async () => {
      await assert.rejects(
        fhirPull.documents(
          filesOf(new Map([["north/pull.json", encoder.encode("[]")]])),
          "north",
        ),
        { name: "PullRefused", message: "pull.json is not a JSON object" },
      );
    });

    it("rejects for a document that names no file and no reason", async () => {
      await assert.rejects(
        fhirPull.documents(
          withPull({
            documents: [
              { documentReference: "DocumentReference/n2", content: 0 },
            ],
          }),
          "north",
        ),
        { name: "PullRefused", message: BAD_DOCUMENTS },
      );
    });

    it("rejects for a document read from a URL that is not on the hospital's origin, or not as a URL writes it", async () => {
      for (const retrievedFrom of [
        `${BASE}/Binary/n2> . <https://ns.cascadeprotocol.org/bridge/v1-draft#thisDocument> <https://ns.cascadeprotocol.org/cascade#serverBaseUrl> "https://other.example/fhir" . <urn:x> <urn:y> <urn:z`,
        `${BASE}/Binary/a|b`,
        "https://other.example/fhir/Binary/n2",
        `http://cascade-north.demo.invalid/fhir/Binary/n2`,
        `https://user:pw@cascade-north.demo.invalid/fhir/Binary/n2`,
        `${BASE}/Binary/../Binary/n2`,
      ])
        await assert.rejects(
          fhirPull.documents(withRead(retrievedFrom), "north"),
          { name: "PullRefused", message: BAD_DOCUMENTS },
          retrievedFrom,
        );
    });
  });
});

/**
 * `documents` is what an import takes from a saved pull: the Bundle as one document, then each C-CDA document the pull
 * read, in the order `pull.json` lists them.
 */
describe("Reading a saved pull as documents · fhirPull.documents()", () => {
  describe("documents(files, folder)", () => {
    let found: NonNullable<Awaited<ReturnType<typeof fhirPull.documents>>>;

    before(async () => {
      found =
        (await fhirPull.documents(
          filesOf(pullFiles({ ...PULL, documents: DOCUMENTS }, "north")),
          "north",
        )) ?? [];
    });

    it("returns undefined for a folder that holds no `pull.json`", async () => {
      assert.equal(
        await fhirPull.documents(filesOf(new Map()), "north"),
        undefined,
      );
    });

    it("returns the Bundle first, as saved, of media type `application/fhir+json`", () => {
      assert.deepEqual(
        [found[0]?.path, found[0]?.mediaType, found[0]?.envelope],
        ["north/bundle.json", "application/fhir+json", "#envelope-bundle"],
      );
      assert.deepEqual(JSON.parse(decoder.decode(found[0]!.bytes)), BUNDLE);
    });

    it("returns each C-CDA document after it, as read, of media type `application/cda+xml`", () => {
      assert.equal(found.length, 2);
      assert.deepEqual(
        [found[1]?.path, found[1]?.mediaType, found[1]?.envelope],
        ["north/document-1.xml", "application/cda+xml", undefined],
      );
      assert.deepEqual(found[1]!.bytes, CCD);
    });

    it("rejects for a folder with no `bundle.json`", async () => {
      const saved = new Map(pullFiles(PULL, "north"));
      saved.delete("north/bundle.json");
      await assert.rejects(fhirPull.documents(filesOf(saved), "north"), {
        message: "the pull holds no bundle.json",
      });
    });

    it("rejects for a folder without a document that `pull.json` names", async () => {
      const saved = new Map(
        pullFiles({ ...PULL, documents: DOCUMENTS }, "north"),
      );
      saved.delete("north/document-1.xml");
      await assert.rejects(fhirPull.documents(filesOf(saved), "north"), {
        message: "the pull holds no document-1.xml",
      });
    });
  });
});

/**
 * `facts` is what the pull says of one document: the hospital as its author, the patient who signed in, when it was
 * read, and which searches the hospital answered or refused. A pod uses the last to tell "the hospital has none" from
 * "the hospital would not say".
 * @rule runtime/arrivals.feature A21
 * @rule runtime/arrivals.feature A18
 */
describe("Stating where a pull's records came from · PullDocument.facts()", () => {
  describe("given the pull's Bundle", () => {
    const SEARCHED = {
      ...PULL,
      searches: [
        { type: "Condition" },
        { type: "MedicationRequest" },
        { type: "MedicationStatement" },
        { type: "Encounter" },
        { type: "Observation", category: "laboratory" },
        { type: "Observation", category: "vital-signs" },
        { type: "DiagnosticReport" },
        { type: "DocumentReference" },
        { type: "MedicationDispense" },
      ],
      denied: [
        { type: "MedicationStatement" },
        { type: "Observation", category: "vital-signs" },
        { type: "DiagnosticReport" },
      ],
    };
    const CLASSES = `cascade:answersForRecordClass, cascade:refusedForRecordClass`;
    let store: oxigraph.Store;
    let classes: string[];

    before(async () => {
      store = await stated(PULL);
      classes = statements(await stated(SEARCHED), CLASSES);
    });

    it('states the import\'s label, "FHIR pull", and the time it started', () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisImport rdfs:label "FHIR pull" ; prov:startedAtTime "2026-10-07T08:00:00Z"^^xsd:dateTime }`,
        ),
        true,
      );
    });

    it("states the hospital's FHIR base, the time of the pull and the patient who signed in", () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument cascade:serverBaseUrl "${BASE}" ;
            pav:retrievedOn "2026-10-07T07:00:00.000Z"^^xsd:dateTime ;
            cascade:authenticatedPatient "Patient/p1" }`,
        ),
        true,
      );
    });

    it("names the hospital as the author, and no transmitter", () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument prov:wasAttributedTo ?author ;
            prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent ?author ; prov:hadRole cascade:AuthorRole ] ] .
            ?author rdfs:label "Cascade North Demo Hospital" }`,
        ),
        true,
      );
      assert.equal(
        ask(store, `ASK { ?association prov:hadRole cascade:TransmitterRole }`),
        false,
      );
    });

    it("states no as-of date for a pull that has none", () => {
      assert.deepEqual(
        statements(
          store,
          "cascade:answeredAsOf, <http://www.w3.org/ns/prov#generatedAtTime>",
        ),
        [],
      );
    });

    it("states a pull's as-of date as `cascade:answeredAsOf`, never as the time the document was made", async () => {
      assert.deepEqual(
        statements(
          await stated({ ...PULL, asOf: "2024-02-01T23:59:59Z" }),
          "cascade:answeredAsOf, <http://www.w3.org/ns/prov#generatedAtTime>",
        ),
        ["answeredAsOf 2024-02-01T23:59:59Z"],
      );
    });

    it("states no record class for a pull that lists no searches", () => {
      assert.deepEqual(statements(store, CLASSES), []);
    });

    it("states the record class of each search the hospital answered", () => {
      assert.deepEqual(
        classes.filter((line) => line.startsWith("answersForRecordClass")),
        [
          "answersForRecordClass ClinicalNoteOrDocument",
          "answersForRecordClass LaboratoryTestResult",
          "answersForRecordClass MedicationDispense",
          "answersForRecordClass PrescribedOrReportedMedication",
          "answersForRecordClass ProblemOrDiagnosis",
        ],
      );
    });

    /**
     * `PrescribedOrReportedMedication` is both answered, by the search for MedicationRequest, and refused, by the one
     * for MedicationStatement; the hospital answered one kind of medication record and refused the other.
     */
    it("states the record class of each search the hospital refused, and not as answered", () => {
      assert.deepEqual(
        classes.filter((line) => line.startsWith("refusedForRecordClass")),
        [
          "refusedForRecordClass DiagnosticReport",
          "refusedForRecordClass PrescribedOrReportedMedication",
        ],
      );
      assert.equal(
        classes.includes("answersForRecordClass DiagnosticReport"),
        false,
      );
    });

    /** An Encounter, and an Observation of vital signs, are searched for and become no record, so they have no class. */
    it("states no record class for a search whose resources become no record", () => {
      assert.equal(classes.length, 7);
      assert.equal(
        classes.some((line) => /Encounter|VitalSign/.test(line)),
        false,
      );
    });
  });

  describe("given a C-CDA document the pull read", () => {
    let store: oxigraph.Store;

    before(async () => {
      store = await stated({ ...PULL, documents: DOCUMENTS }, 1);
    });

    it("states the URL it was read from, the time of the pull and the patient who signed in, and nothing else of the document", () => {
      assert.deepEqual(
        (
          ask(
            store,
            `SELECT ?p ?o WHERE { bridge:thisDocument ?p ?o FILTER (isLiteral(?o) || isIRI(?o)) }`,
          ) as Map<string, oxigraph.Term>[]
        )
          .map(
            (row) =>
              `${row.get("p")!.value.split(/[#/]/).pop()} ${row.get("o")!.value}`,
          )
          .sort(),
        [
          "authenticatedPatient Patient/p1",
          `retrievedFrom ${BASE}/Binary/n2`,
          "retrievedOn 2026-10-07T07:00:00Z",
        ],
      );
    });

    it("names the hospital as the author", () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument prov:wasAttributedTo ?author ;
            prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent ?author ; prov:hadRole cascade:AuthorRole ] ] .
            ?author rdfs:label ?name }`,
        ),
        true,
      );
    });

    it("writes the URL as `pull.json` gives it", async () => {
      const [, document] =
        (await fhirPull.documents(withRead(`${BASE}/Binary/a%7Cb`), "north")) ??
        [];
      assert.match(
        decoder.decode(document!.facts("2026-10-07T08:00:00Z")),
        /<http:\/\/purl\.org\/pav\/retrievedFrom> <https:\/\/cascade-north\.demo\.invalid\/fhir\/Binary\/a%7Cb> \./,
      );
    });
  });
});

/**
 * `index` is the look at a saved pull: what `pod.look()` counts, so that what a person approves is what the import
 * brings. It counts a resource of the Bundle only where the import makes a record of it, and a C-CDA document by its
 * `entry` elements, as a downloaded C-CDA's look does.
 */
describe("Listing a saved pull's records before an import · fhirPull.index()", () => {
  describe("index(files, folder)", () => {
    it("returns undefined for a folder that holds no `pull.json`", async () => {
      assert.equal(
        await fhirPull.index(filesOf(new Map()), "north"),
        undefined,
      );
    });

    it("returns one index entry for each resource that becomes a record, with the hospital's name, its FHIR base, the kind and the time of the pull", async () => {
      assert.deepEqual(
        await fhirPull.index(filesOf(pullFiles(PULL, "north")), "north"),
        [
          "Allergy",
          "Medication",
          "Lab result",
          "Report",
          "Note or document",
          "Note or document",
        ].map((kind) => ({
          source: "Cascade North Demo Hospital",
          server: BASE,
          kind,
          received: "2026-10-07T07:00:00.000Z",
        })),
      );
    });

    /**
     * Of the Bundle's resources, the Patient, a vital-signs Observation, an Observation whose `category.coding` is
     * no list, an Observation that groups others by `hasMember`, an Encounter and a Medication make no record.
     */
    it("leaves out a resource that becomes no record", async () => {
      assert.deepEqual(
        await fhirPull.index(
          savedWith(["p1", "o2", "o3", "o4", "e1", "d1"]),
          "north",
        ),
        [],
      );
    });

    /**
     * Of the Bundle's four DocumentReferences, `n2` and `n4` hold a structured C-CDA document, by the format code of
     * HL7 and of IHE; the other two, one with no content and one whose content is `ccda-nonXMLBody`, are notes.
     */
    it("leaves out a DocumentReference whose content is a structured C-CDA document", async () => {
      assert.deepEqual(
        await fhirPull.index(savedWith(["n2", "n4"]), "north"),
        [],
      );
    });

    it("returns, after the Bundle's, one index entry for each `entry` element of each C-CDA document read, by its custodian and section", async () => {
      const ccd = encoder.encode(`<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <effectiveTime value="20260901"/>
  <recordTarget><patientRole><id root="2.16.840.1.113883.19.5" extension="p1"/></patientRole></recordTarget>
  <custodian><assignedCustodian><representedCustodianOrganization><name>Kestrel Harbor Hospital</name></representedCustodianOrganization></assignedCustodian></custodian>
  <component><structuredBody>
    <component><section><title>Problems</title><entry/><entry/></section></component>
    <component><section><title>Allergies</title><entry/></section></component>
  </structuredBody></component>
</ClinicalDocument>`);
      const files = savedWith(
        ["p1", "n2"],
        [
          {
            documentReference: "DocumentReference/n2",
            content: 0,
            url: "Binary/n2",
            retrievedFrom: `${BASE}/Binary/n2`,
            bytes: ccd,
          },
        ],
      );
      const kestrel = (section: string) => ({
        source: "Kestrel Harbor Hospital",
        section,
        received: "2026-09-01",
      });
      assert.deepEqual(await fhirPull.index(files, "north"), [
        kestrel("Problems"),
        kestrel("Problems"),
        kestrel("Allergies"),
      ]);
    });

    it("rejects for a `bundle.json` that is no Bundle", async () => {
      const saved = new Map(pullFiles(PULL, "north"));
      saved.set("north/bundle.json", encoder.encode('"x"'));
      await assert.rejects(fhirPull.index(filesOf(saved), "north"), {
        message: "bundle.json is not a Bundle",
      });
    });
  });
});

const CAPABILITY = {
  resourceType: "CapabilityStatement",
  software: { name: "Example EHR", version: "" },
  implementation: { url: `${BASE}/` },
  rest: [
    { mode: "client" },
    {
      mode: "server",
      security: {
        extension: [
          {
            url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
            extension: [
              { url: "token", valueUri: `${BASE}/token` },
              { url: "authorize", valueUri: `${BASE}/authorize` },
            ],
          },
        ],
      },
    },
  ],
};
const CONNECT: SavedConnect = {
  fhirBase: BASE,
  clientId: "cascade-app",
  capability: CAPABILITY,
};

/** Each way a connect is one the import would refuse, and the sentence that says so. */
const CONNECT_REFUSED: readonly [
  name: string,
  connect: SavedConnect,
  why: string,
][] = [
  [
    "an http: base",
    { ...CONNECT, fhirBase: "http://cascade-north.demo.invalid/fhir" },
    "connect.json's fhirBase is not an https: URL with no query, fragment or trailing slash",
  ],
  [
    "no client id",
    { ...CONNECT, clientId: "" },
    "connect.json names no client id",
  ],
  [
    "no CapabilityStatement",
    { ...CONNECT, capability: { resourceType: "Bundle" } },
    "capability.json is no CapabilityStatement",
  ],
  [
    "a SMART configuration that is no object",
    { ...CONNECT, smartConfiguration: [] },
    "smart-configuration.json is not a JSON object",
  ],
];

/** The files of a connect, written by hand, so that they can hold what `connectFiles` would refuse. */
function connectWritten({
  capability,
  smartConfiguration,
  ...saved
}: SavedConnect): PullFiles {
  return filesOf(
    new Map([
      ["north/connect.json", encoder.encode(JSON.stringify(saved))],
      ["north/capability.json", encoder.encode(JSON.stringify(capability))],
      ...(smartConfiguration === undefined
        ? []
        : [
            [
              "north/smart-configuration.json",
              encoder.encode(JSON.stringify(smartConfiguration)),
            ] as const,
          ]),
    ]),
  );
}

/**
 * A connection to a hospital's server is saved as the files `pod.connect()` records: the FHIR base, the client id the
 * app signed in with, the server's CapabilityStatement and, where it has one, its SMART configuration. `readConnect`
 * reads from them what the pod records of the server. One the import would refuse is refused by `connectFiles` and by
 * `readConnect`, with one sentence.
 * @rule runtime/arrivals.feature A16
 * @rule runtime/arrivals.feature A14
 */
describe("Saving and reading what a hospital's server said of itself · connectFiles(), readConnect(), ConnectRefused", () => {
  describe("readConnect(files, folder)", () => {
    let connected: Awaited<ReturnType<typeof readConnect>>;

    before(async () => {
      connected = await readConnect(
        filesOf(connectFiles(CONNECT, "north")),
        "north",
      );
    });

    it("returns the FHIR base and the client id as saved", () => {
      assert.equal(connected.fhirBase, BASE);
      assert.equal(connected.clientId, "cascade-app");
    });

    it("returns the base URL, the authorization endpoint and the software's name as the server wrote them", () => {
      assert.deepEqual(connected, {
        fhirBase: BASE,
        clientId: "cascade-app",
        selfAssertedBaseUrl: `${BASE}/`,
        authorizationEndpoint: `${BASE}/authorize`,
        softwareName: "Example EHR",
      });
    });

    it("leaves out what the server wrote as an empty string", () => {
      assert.equal("softwareVersion" in connected, false);
    });

    it("prefers the authorization endpoint of the SMART configuration to the CapabilityStatement's", async () => {
      const files = connectFiles(
        {
          ...CONNECT,
          smartConfiguration: { authorization_endpoint: `${BASE}/smart` },
        },
        "north",
      );
      assert.equal(
        (await readConnect(filesOf(files), "north")).authorizationEndpoint,
        `${BASE}/smart`,
      );
    });

    it("rejects with `ConnectRefused` for a connect the import would refuse", async () => {
      for (const [name, connect, why] of CONNECT_REFUSED)
        await assert.rejects(
          readConnect(connectWritten(connect), "north"),
          { name: "ConnectRefused", message: why },
          name,
        );
    });

    it("rejects with `ConnectRefused` for a folder with no `connect.json`", async () => {
      await assert.rejects(readConnect(filesOf(new Map()), "north"), {
        name: "ConnectRefused",
        message: "north holds no connect.json",
      });
    });

    it("rejects with `ConnectRefused` for a folder with no `capability.json`", async () => {
      await assert.rejects(
        readConnect(
          filesOf(
            new Map([
              ["north/connect.json", encoder.encode(JSON.stringify({}))],
            ]),
          ),
          "north",
        ),
        { name: "ConnectRefused", message: "north holds no capability.json" },
      );
    });
  });

  describe("connectFiles(connect, name)", () => {
    it("throws `ConnectRefused`, with the sentence `readConnect()` gives, for each connection `readConnect()` refuses", () => {
      for (const [name, connect, why] of CONNECT_REFUSED)
        assert.throws(
          () => connectFiles(connect, "north"),
          { name: "ConnectRefused", message: why },
          name,
        );
    });

    it("throws `TypeError` for a name that is not one folder's name", () => {
      for (const name of ["", "..", "a/b"])
        assert.throws(
          () => connectFiles(CONNECT, name),
          {
            name: "TypeError",
            message: `a connect is saved under one folder name, not ${name}`,
          },
          JSON.stringify(name),
        );
    });
  });
});
