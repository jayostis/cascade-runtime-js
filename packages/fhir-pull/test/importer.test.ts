import assert from "node:assert/strict";
import { test } from "node:test";
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

test("a saved pull is its Bundle as one document, stated with the hospital's base, the retrieval time, the patient, the hospital as author and, when a world's date was set, the date it answered as of", async () => {
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
      PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
      ASK {
        bridge:thisImport rdfs:label "FHIR pull" ; prov:startedAtTime "2026-10-07T08:00:00Z"^^xsd:dateTime .
        bridge:thisDocument cascade:serverBaseUrl "${BASE}" ;
          pav:retrievedOn "2026-10-07T07:00:00.000Z"^^xsd:dateTime ;
          cascade:authenticatedPatient "Patient/p1" ;
          prov:qualifiedAttribution [ prov:agent [ rdfs:label "Cascade North Demo Hospital" ] ; prov:hadRole cascade:AuthorRole ] .
        FILTER NOT EXISTS { ?attribution prov:hadRole cascade:TransmitterRole }
      }`),
    true,
  );
  const answeredAsOf = async (pull: typeof PULL & { asOf?: string }) => {
    const [document] = (await fhirPull.documents(
      filesOf(pullFiles(pull, "north")),
      "north",
    ))!;
    const facts = new oxigraph.Store();
    facts.load(document!.facts("2026-10-07T08:00:00Z"), {
      format: "text/turtle",
    });
    return (
      facts.query(
        `SELECT ?p ?at WHERE { <https://ns.cascadeprotocol.org/bridge/v1-draft#thisDocument> ?p ?at FILTER (?p IN (<https://ns.cascadeprotocol.org/cascade#answeredAsOf>, <http://www.w3.org/ns/prov#generatedAtTime>)) }`,
      ) as Map<string, oxigraph.Term>[]
    ).map((row) => [
      row.get("p")!.value.split(/[#/]/).pop(),
      row.get("at")!.value,
    ]);
  };
  assert.deepEqual(await answeredAsOf(PULL), [], "no world date, no as-of");
  assert.deepEqual(
    await answeredAsOf({ ...PULL, asOf: "2024-02-01T23:59:59Z" }),
    [["answeredAsOf", "2024-02-01T23:59:59Z"]],
    "the world's date the hospital answered as of, and never as the document's generatedAtTime",
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

test("a pull states the class of each search it answered and each it was refused", async () => {
  const scope = async (changed: Record<string, unknown>) => {
    const [document] = (await fhirPull.documents(
      filesOf(pullFiles({ ...PULL, ...changed }, "north")),
      "north",
    ))!;
    const facts = new oxigraph.Store();
    facts.load(document!.facts("2026-10-07T08:00:00Z"), {
      format: "text/turtle",
    });
    return (
      facts.query(
        `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
        SELECT ?p ?class WHERE {
          <https://ns.cascadeprotocol.org/bridge/v1-draft#thisDocument> ?p ?class
          FILTER (?p IN (cascade:answersForRecordClass, cascade:refusedForRecordClass))
        }`,
      ) as Map<string, oxigraph.Term>[]
    )
      .map((row) =>
        [row.get("p")!, row.get("class")!]
          .map(({ value }) => value.split("#").pop())
          .join(" "),
      )
      .sort();
  };
  assert.deepEqual(await scope({}), [], "a pull that lists no searches");
  assert.deepEqual(
    await scope({
      searches: [
        { type: "Condition" },
        { type: "MedicationRequest" },
        { type: "MedicationStatement" },
        { type: "Encounter" },
        { type: "Observation", category: "laboratory" },
        { type: "Observation", category: "vital-signs" },
      ],
      denied: [
        { type: "MedicationStatement" },
        { type: "Observation", category: "vital-signs" },
      ],
    }),
    [
      "answersForRecordClass LaboratoryTestResult",
      "answersForRecordClass PrescribedOrReportedMedication",
      "answersForRecordClass ProblemOrDiagnosis",
      "refusedForRecordClass PrescribedOrReportedMedication",
    ],
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
      ] as const
    ).map(([name, changed, field]): [string, PullFiles, string] => {
      const why = {
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

test("a saved connect reports each string the server wrote and the client id, the authorization endpoint from its SMART configuration where it has one, and a connect the rules refuse is refused with why, and never saved", async () => {
  assert.deepEqual(
    await readConnect(filesOf(connectFiles(CONNECT, "north")), "north"),
    {
      fhirBase: BASE,
      clientId: "cascade-app",
      selfAssertedBaseUrl: `${BASE}/`,
      authorizationEndpoint: `${BASE}/authorize`,
      softwareName: "Example EHR",
    },
  );
  const smartConfiguration = { authorization_endpoint: `${BASE}/smart` };
  const withConfiguration = connectFiles(
    { ...CONNECT, smartConfiguration },
    "north",
  );
  assert.equal(
    (await readConnect(filesOf(withConfiguration), "north"))
      .authorizationEndpoint,
    `${BASE}/smart`,
  );
  const rows: [string, SavedConnect, string][] = [
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
  for (const [name, connect, why] of rows) {
    assert.throws(() => connectFiles(connect, "north"), { message: why }, name);
    const encoder = new TextEncoder();
    const { capability, smartConfiguration: smart, ...saved } = connect;
    await assert.rejects(
      readConnect(
        filesOf(
          new Map([
            ["north/connect.json", encoder.encode(JSON.stringify(saved))],
            [
              "north/capability.json",
              encoder.encode(JSON.stringify(capability)),
            ],
            ...(smart === undefined
              ? []
              : [
                  [
                    "north/smart-configuration.json",
                    encoder.encode(JSON.stringify(smart)),
                  ] as const,
                ]),
          ]),
        ),
        "north",
      ),
      { message: why },
      name,
    );
  }
  await assert.rejects(readConnect(filesOf(new Map()), "north"), {
    message: "north holds no connect.json",
  });
});
