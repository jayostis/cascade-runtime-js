import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { brandsBundle } from "@the-cascade-protocol/sandbox";
import {
  HOSPITALS_FOLDER,
  loadHospital,
  loadHospitals,
} from "@the-cascade-protocol/sandbox/node";
import { directoryOf, searchDirectory, TEST_DIRECTORY } from "cascade-runtime";
import { launcherSettings } from "./launcher-settings.js";

const demo = directoryOf(
  brandsBundle(
    (await loadHospitals()).map(({ hospital }) => hospital),
    "2026-01-01T00:00:00Z",
  ),
  "demo",
);
const directory = [...demo, ...TEST_DIRECTORY];

function brands(endpoint: object, organization: object = {}) {
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: {
          resourceType: "Organization",
          name: "Alder Clinic",
          address: [{ city: "Alder", state: "WA" }],
          endpoint: [{ reference: "Endpoint/a" }],
          ...organization,
        },
      },
      {
        resource: {
          resourceType: "Endpoint",
          id: "a",
          connectionType: { code: "hl7-fhir-rest" },
          address: "https://alder.example/fhir",
          ...endpoint,
        },
      },
    ],
  };
}

function family(ids: { parent: string; endpoint: string }, child: object) {
  const url = (id: string) => (id.startsWith("urn:") ? { fullUrl: id } : {});
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        ...url(ids.parent),
        resource: {
          resourceType: "Organization",
          id: "p",
          name: "Alder Health",
          endpoint: [{ reference: ids.endpoint }],
        },
      },
      {
        ...url(ids.endpoint),
        resource: {
          resourceType: "Endpoint",
          id: "a",
          connectionType: { code: "hl7-fhir-rest" },
          address: "https://alder.example/fhir",
        },
      },
      {
        resource: {
          resourceType: "Organization",
          name: "Alder Clinic",
          address: [{ city: "Alder", state: "WA" }],
          ...child,
        },
      },
    ],
  };
}

describe("the demo directory", () => {
  it("has a row for each demo hospital", async () => {
    const folders = (await readdir(HOSPITALS_FOLDER, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const hospitals = await Promise.all(
      folders.map(async (folder) => (await loadHospital(folder)).hospital),
    );
    assert.deepEqual(
      demo
        .map(({ name, fhirBase, places }) => ({ name, fhirBase, places }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      hospitals
        .map(({ name, fhirBase, places }) => ({ name, fhirBase, places }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
});

describe("the test directory's launcher row", () => {
  it("asks for a patient's own login and approval, with PKCE, as a public client", () => {
    const row = TEST_DIRECTORY.find(
      ({ vendor }) => vendor === "smart-launcher",
    );
    assert.ok(row);
    const { launchType, patient, skipLogin, skipAuth, clientType, pkce } =
      launcherSettings(row.fhirBase);
    assert.deepEqual(
      { launchType, patient, skipLogin, skipAuth, clientType, pkce },
      {
        launchType: 3,
        patient: "",
        skipLogin: 0,
        skipAuth: 0,
        clientType: 0,
        pkce: 2,
      },
    );
  });
});

describe("directoryOf", () => {
  const alder = {
    name: "Alder Clinic",
    vendor: "v",
    fhirBase: "https://alder.example/fhir",
    places: ["Alder, WA"],
  };
  const unplaced = { ...alder, places: undefined };
  delete unplaced.places;
  const parent = { ...unplaced, name: "Alder Health" };
  const VERSION =
    "http://hl7.org/fhir/StructureDefinition/endpoint-fhir-version";
  const cases: [string, unknown, unknown[]][] = [
    ["gives a row for a good bundle", brands({}), [alder]],
    [
      "drops the trailing slash of an address",
      brands({ address: "https://alder.example/fhir/" }),
      [alder],
    ],
    [
      "skips an endpoint of another kind",
      brands({ connectionType: { code: "direct-project" } }),
      [],
    ],
    [
      "skips an Organization with no endpoint reference",
      brands({}, { endpoint: undefined }),
      [],
    ],
    [
      "skips an endpoint that is not in the bundle",
      brands({}, { endpoint: [{ reference: "Endpoint/b" }] }),
      [],
    ],
    ["skips an endpoint with no address", brands({ address: undefined }), []],
    [
      "gives no places when the Organization has no address",
      brands({}, { address: undefined }),
      [unplaced],
    ],
    [
      "gives a city alone as the place",
      brands({}, { address: [{ city: "Alder" }] }),
      [{ ...alder, places: ["Alder"] }],
    ],
    [
      "skips an endpoint stating R2",
      brands({
        extension: [{ url: VERSION, valueCode: "1.0.2" }],
      }),
      [],
    ],
    [
      "keeps an endpoint stating R4",
      brands({
        extension: [{ url: VERSION, valueCode: "4.0.1" }],
      }),
      [alder],
    ],
    [
      "gives a brand with no endpoint the endpoint of its parent",
      family(
        { parent: "Organization/p", endpoint: "Endpoint/a" },
        { partOf: { reference: "Organization/p" } },
      ),
      [parent, alder],
    ],
    [
      "reaches a parent by an entry's urn:uuid",
      family(
        { parent: "urn:uuid:p", endpoint: "urn:uuid:e" },
        { partOf: { reference: "urn:uuid:p" } },
      ),
      [parent, alder],
    ],
    [
      "gives a brand no row when its parent is not in the bundle",
      family(
        { parent: "Organization/p", endpoint: "Endpoint/a" },
        { partOf: { reference: "Organization/q" } },
      ),
      [parent],
    ],
    [
      "gives no rows for a resource that is no Bundle",
      { resourceType: "Patient" },
      [],
    ],
    ["gives no rows for a string", "bundle", []],
    ["gives no rows for nothing", undefined, []],
  ];
  for (const [what, input, rows] of cases)
    it(what, () => {
      assert.deepEqual(directoryOf(input, "v"), rows, what);
    });
});

describe("searchDirectory", () => {
  const everyRow = [
    "Cascade North Demo Hospital",
    "Cascade South Demo Hospital",
    "SMART Health IT Sandbox",
  ];
  const cases: [string, string, string[]][] = [
    ["", "gives every row for no words", everyRow],
    ["   ", "gives every row for only spaces", everyRow],
    ["north", "finds a word of the name", ["Cascade North Demo Hospital"]],
    [
      "cascade",
      "finds every row with the word in its name",
      ["Cascade North Demo Hospital", "Cascade South Demo Hospital"],
    ],
    [
      "CASCADE south",
      "ignores case and needs each word",
      ["Cascade South Demo Hospital"],
    ],
    ["bellingham", "finds a word of a place", ["Cascade North Demo Hospital"]],
    ["olym", "finds the beginning of a word", ["Cascade South Demo Hospital"]],
    [
      "mount vern",
      "needs each word to begin a word of the row",
      ["Cascade North Demo Hospital"],
    ],
    [
      "mount m",
      "lets two words begin the same word",
      ["Cascade North Demo Hospital"],
    ],
    ["Olýmpia", "ignores accents", ["Cascade South Demo Hospital"]],
    ["smart", "finds a row of another vendor", ["SMART Health IT Sandbox"]],
    ["orth", "finds nothing inside a word", []],
    ["seattle", "finds nothing for a place no row holds", []],
  ];
  for (const [text, what, names] of cases)
    it(`${what}: "${text}"`, () => {
      assert.deepEqual(
        searchDirectory(directory, text).map(({ name }) => name),
        names,
        text,
      );
    });
});
