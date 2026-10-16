import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { brandsBundle } from "@cascade-runtime/demo-hospital";
import {
  loadHospital,
  loadHospitals,
} from "@cascade-runtime/demo-hospital/node";
import { directoryOf, searchDirectory, TEST_DIRECTORY } from "cascade-runtime";
import { DEMO_BRANDS } from "../src/connect/demo-brands.js";
import { launcherSettings } from "./launcher-settings.js";

const DATA = fileURLToPath(
  new URL(
    "../../../data/",
    import.meta.resolve("@cascade-runtime/demo-hospital/node"),
  ),
);

test("the test directory's demo rows are the demo hospitals, every one of them", async () => {
  const demo = TEST_DIRECTORY.filter(({ vendor }) => vendor === "demo");
  const folders = (await readdir(DATA, { withFileTypes: true }))
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

test("the generated brands bundle is the demo hospitals' folders as brandsBundle gives them, its time apart", async () => {
  const hospitals = (await loadHospitals()).map(({ hospital }) => hospital);
  const fresh = brandsBundle(hospitals, "2026-01-01T00:00:00Z");
  assert.ok(Number.isFinite(Date.parse(DEMO_BRANDS.timestamp)));
  assert.deepEqual(
    { ...DEMO_BRANDS, timestamp: "" },
    { ...fresh, timestamp: "" },
  );
});

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

test("directoryOf gives a row for each Organization endpoint that is FHIR REST and skips what it cannot read", () => {
  const alder = {
    name: "Alder Clinic",
    vendor: "v",
    fhirBase: "https://alder.example/fhir",
    places: ["Alder, WA"],
  };
  const unplaced = { ...alder, places: undefined };
  delete unplaced.places;
  const cases: [string, unknown, unknown[]][] = [
    ["a good bundle", brands({}), [alder]],
    [
      "a trailing slash",
      brands({ address: "https://alder.example/fhir/" }),
      [alder],
    ],
    [
      "an endpoint of another kind",
      brands({ connectionType: { code: "direct-project" } }),
      [],
    ],
    ["no endpoint reference", brands({}, { endpoint: undefined }), []],
    [
      "an endpoint not in the bundle",
      brands({}, { endpoint: [{ reference: "Endpoint/b" }] }),
      [],
    ],
    ["an endpoint with no address", brands({ address: undefined }), []],
    [
      "no address on the Organization",
      brands({}, { address: undefined }),
      [unplaced],
    ],
    [
      "a city alone",
      brands({}, { address: [{ city: "Alder" }] }),
      [{ ...alder, places: ["Alder"] }],
    ],
    ["not a bundle", { resourceType: "Patient" }, []],
    ["not an object", "bundle", []],
    ["nothing", undefined, []],
  ];
  for (const [what, input, rows] of cases)
    assert.deepEqual(directoryOf(input, "v"), rows, what);
});

test("the launcher's row asks for a patient's own login and approval, with PKCE, as a public client", () => {
  const row = TEST_DIRECTORY.find(({ vendor }) => vendor === "smart-launcher");
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

test("a search of the directory gives the rows whose name or places hold a word beginning with each word given", () => {
  const cases: [string, string[]][] = [
    [
      "",
      [
        "Cascade North Demo Hospital",
        "Cascade South Demo Hospital",
        "SMART Health IT Sandbox",
      ],
    ],
    [
      "   ",
      [
        "Cascade North Demo Hospital",
        "Cascade South Demo Hospital",
        "SMART Health IT Sandbox",
      ],
    ],
    ["north", ["Cascade North Demo Hospital"]],
    ["cascade", ["Cascade North Demo Hospital", "Cascade South Demo Hospital"]],
    ["CASCADE south", ["Cascade South Demo Hospital"]],
    ["bellingham", ["Cascade North Demo Hospital"]],
    ["olym", ["Cascade South Demo Hospital"]],
    ["mount vern", ["Cascade North Demo Hospital"]],
    ["mount m", ["Cascade North Demo Hospital"]],
    ["Olýmpia", ["Cascade South Demo Hospital"]],
    ["smart", ["SMART Health IT Sandbox"]],
    ["orth", []],
    ["seattle", []],
  ];
  for (const [text, names] of cases)
    assert.deepEqual(
      searchDirectory(TEST_DIRECTORY, text).map(({ name }) => name),
      names,
      text,
    );
});
