import assert from "node:assert/strict";
import { test } from "node:test";
import * as oxigraph from "oxigraph";
import { fhirPull, type PullFiles, pullFiles } from "../src/index.js";

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

function filesOf(map: ReadonlyMap<string, Uint8Array>): PullFiles {
  return { read: (path) => Promise.resolve(map.get(path)) };
}

function withPull(changed: Record<string, unknown>): PullFiles {
  const { bundle, ...rest } = { ...PULL, ...changed };
  const encoder = new TextEncoder();
  return filesOf(
    new Map([
      ["north/pull.json", encoder.encode(JSON.stringify(rest))],
      ["north/bundle.json", encoder.encode(JSON.stringify(bundle))],
    ]),
  );
}

test("a saved pull is its Bundle as one document, stated with the hospital's base, the retrieval time, the patient and the hospital as author", async () => {
  const files = filesOf(pullFiles(PULL, "north"));
  const documents = (await fhirPull.documents(files, "north")) ?? [];
  assert.deepEqual(
    documents.map(({ path, mediaType, envelope }) => [
      path,
      mediaType,
      envelope,
    ]),
    [["north/bundle.json", "application/fhir+json", "#envelope-bundle"]],
  );
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(documents[0]!.bytes)),
    BUNDLE,
  );
  const store = new oxigraph.Store();
  store.load(documents[0]!.facts("2026-10-07T08:00:00Z"), {
    format: "text/turtle",
  });
  assert.equal(
    store.query(`PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
      PREFIX prov: <http://www.w3.org/ns/prov#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> PREFIX pav: <http://purl.org/pav/>
      PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
      ASK {
        bridge:thisImport rdfs:label "FHIR pull" ; prov:startedAtTime "2026-10-07T08:00:00Z"^^xsd:dateTime .
        bridge:thisDocument bridge:serverBaseUrl "${BASE}" ;
          pav:retrievedOn "2026-10-07T07:00:00.000Z"^^xsd:dateTime ;
          bridge:authenticatedPatient "Patient/p1" ;
          prov:qualifiedAttribution [ prov:agent [ rdfs:label "Cascade North Demo Hospital" ] ; prov:hadRole rec:author ] .
        FILTER NOT EXISTS { ?attribution prov:hadRole rec:transmitter }
      }`),
    true,
  );
  assert.deepEqual(
    await fhirPull.index(files, "north"),
    [["Allergy"], ["Medication"], ["Lab result"]].map(([kind]) => ({
      source: "Cascade North Demo Hospital",
      server: BASE,
      kind,
      received: "2026-10-07T07:00:00.000Z",
    })),
  );
});

test("a folder with no pull.json is no pull, and a pull the import cannot state is refused with why, and never saved", async () => {
  assert.equal(
    await fhirPull.documents(filesOf(new Map()), "north"),
    undefined,
  );
  const noBundle = new Map(pullFiles(PULL, "north"));
  noBundle.delete("north/bundle.json");
  const rows: [string, PullFiles, string][] = [
    [
      "not a JSON object",
      filesOf(new Map([["north/pull.json", new TextEncoder().encode("[]")]])),
      "pull.json is not a JSON object",
    ],
    ...(
      [
        ["no fhirBase", { fhirBase: undefined }, "fhirBase"],
        [
          "an http: base",
          { fhirBase: "http://cascade-north.demo.invalid/fhir" },
          "fhirBase",
        ],
        ["a base with a query", { fhirBase: `${BASE}?tenant=a` }, "fhirBase"],
        ["a base with a trailing slash", { fhirBase: `${BASE}/` }, "fhirBase"],
        ["a base with a space around it", { fhirBase: ` ${BASE}` }, "fhirBase"],
        ["a patient that is no FHID id", { patient: "pt 1" }, "patient"],
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
      ] as const
    ).map(([name, changed, field]): [string, PullFiles, string] => {
      const why = {
        fhirBase:
          "pull.json's fhirBase is not an https: URL with no query, fragment or trailing slash",
        patient: "pull.json's patient is not a FHIR id",
        source: "pull.json's source is not a name",
        retrievedAt: "pull.json's retrievedAt is not a time in UTC",
      }[field];
      assert.throws(
        () => pullFiles({ ...PULL, ...changed } as typeof PULL, "north"),
        { message: why },
        `${name}, saved`,
      );
      return [name, withPull(changed), why];
    }),
    ["no bundle.json", filesOf(noBundle), "the pull holds no bundle.json"],
  ];
  for (const [name, files, why] of rows)
    await assert.rejects(
      fhirPull.documents(files, "north"),
      { message: why },
      name,
    );
});
