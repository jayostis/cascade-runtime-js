import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { before, describe, it } from "node:test";
import { brandsBundle } from "@the-cascade-protocol/sandbox";
import {
  HOSPITALS_FOLDER,
  loadHospital,
  loadHospitals,
} from "@the-cascade-protocol/sandbox/node";
import {
  directoryOf,
  searchDirectory,
  TEST_DIRECTORY,
  type DirectoryRow,
} from "cascade-runtime";
import { launcherSettings } from "./launcher-settings.js";

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

const alder: DirectoryRow = {
  name: "Alder Clinic",
  vendor: "v",
  fhirBase: "https://alder.example/fhir",
  places: ["Alder, WA"],
};

/** A row with no `places` key at all, as `directoryOf` gives where the Organization has no location. */
function unplaced(name: string): DirectoryRow {
  const row: { -readonly [key in keyof DirectoryRow]?: DirectoryRow[key] } = {
    ...alder,
    name,
  };
  delete row.places;
  return row as DirectoryRow;
}

const VERSION = "http://hl7.org/fhir/StructureDefinition/endpoint-fhir-version";

/** What `directoryOf` gives for each bundle of a table of `[what, bundle, rows]`. */
function assertRows(cases: [string, unknown, DirectoryRow[]][]): void {
  for (const [what, input, rows] of cases)
    assert.deepEqual(directoryOf(input, "v"), rows, what);
}

/**
 * A directory is the list of hospitals an app offers a person to connect to; each row gives a hospital's name, the
 * vendor of its system, and its FHIR base, the URL of the server that holds its records. `directoryOf` reads rows
 * from the list a vendor publishes, a brands bundle, and `searchDirectory` finds the rows that match what a person
 * types.
 */
describe("Finding a hospital to connect to · directoryOf(), searchDirectory(), TEST_DIRECTORY", () => {
  let demo: DirectoryRow[];
  let directory: DirectoryRow[];

  before(async () => {
    demo = directoryOf(
      brandsBundle(
        (await loadHospitals()).map(({ hospital }) => hospital),
        "2026-01-01T00:00:00Z",
      ),
      "demo",
    );
    directory = [...demo, ...TEST_DIRECTORY];
  });

  describe("directoryOf(brands, vendor)", () => {
    it("returns a row for every demo hospital from the brands bundle that `cascade-sandbox` makes of them, with its name, FHIR base and places", async () => {
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

    it("returns one row for an Organization's FHIR endpoint: the Organization's name, the vendor given, the endpoint's URL as the FHIR base, and its city and state as a place", () => {
      assertRows([["a good bundle", brands({}), [alder]]]);
    });

    it("drops a trailing slash from the FHIR base", () => {
      assertRows([
        [
          "a trailing slash",
          brands({ address: "https://alder.example/fhir/" }),
          [alder],
        ],
      ]);
    });

    it("returns the city alone as the place where an Organization gives no state, and no `places` where it gives no location", () => {
      assertRows([
        [
          "a city alone",
          brands({}, { address: [{ city: "Alder" }] }),
          [{ ...alder, places: ["Alder"] }],
        ],
        [
          "no address on the Organization",
          brands({}, { address: undefined }),
          [unplaced("Alder Clinic")],
        ],
      ]);
    });

    it("skips an Organization that names no endpoint, and one whose endpoint is of another kind, is missing from the bundle, has no URL, or says it speaks FHIR R2", () => {
      assertRows([
        ["no endpoint reference", brands({}, { endpoint: undefined }), []],
        [
          "an endpoint of another kind",
          brands({ connectionType: { code: "direct-project" } }),
          [],
        ],
        [
          "an endpoint not in the bundle",
          brands({}, { endpoint: [{ reference: "Endpoint/b" }] }),
          [],
        ],
        ["an endpoint with no address", brands({ address: undefined }), []],
        [
          "an endpoint stating R2",
          brands({ extension: [{ url: VERSION, valueCode: "1.0.2" }] }),
          [],
        ],
      ]);
    });

    it("keeps an endpoint that says it speaks FHIR R4", () => {
      assertRows([
        [
          "an endpoint stating R4",
          brands({ extension: [{ url: VERSION, valueCode: "4.0.1" }] }),
          [alder],
        ],
      ]);
    });

    it("gives an Organization with no endpoint of its own the endpoint of the one it is `partOf`, named by a relative reference or by a `urn:uuid`", () => {
      assertRows([
        [
          "a brand with no endpoint, part of one that has",
          family(
            { parent: "Organization/p", endpoint: "Endpoint/a" },
            { partOf: { reference: "Organization/p" } },
          ),
          [unplaced("Alder Health"), alder],
        ],
        [
          "a brand with no endpoint, part of a parent reached by an entry's urn:uuid",
          family(
            { parent: "urn:uuid:p", endpoint: "urn:uuid:e" },
            { partOf: { reference: "urn:uuid:p" } },
          ),
          [unplaced("Alder Health"), alder],
        ],
      ]);
    });

    it("skips an Organization that is `partOf` one the bundle does not hold", () => {
      assertRows([
        [
          "a brand part of a parent not in the bundle",
          family(
            { parent: "Organization/p", endpoint: "Endpoint/a" },
            { partOf: { reference: "Organization/q" } },
          ),
          [unplaced("Alder Health")],
        ],
      ]);
    });

    it("returns no rows for what is no Bundle: another resource, a string, nothing", () => {
      assertRows([
        ["not a bundle", { resourceType: "Patient" }, []],
        ["not an object", "bundle", []],
        ["nothing", undefined, []],
      ]);
    });
  });

  describe("searchDirectory(directory, text)", () => {
    /** What each text of a table of `[text, names]` finds. */
    function assertFinds(cases: [string, string[]][]): void {
      for (const [text, names] of cases)
        assert.deepEqual(
          searchDirectory(directory, text).map(({ name }) => name),
          names,
          `"${text}"`,
        );
    }

    it("returns every row for blank text", () => {
      const all = [
        "Cascade North Demo Hospital",
        "Cascade South Demo Hospital",
        "SMART Health IT Sandbox",
      ];
      assertFinds([
        ["", all],
        ["   ", all],
      ]);
    });

    it("returns the rows whose name or places hold a word beginning with the word typed", () => {
      assertFinds([
        ["north", ["Cascade North Demo Hospital"]],
        [
          "cascade",
          ["Cascade North Demo Hospital", "Cascade South Demo Hospital"],
        ],
        ["bellingham", ["Cascade North Demo Hospital"]],
        ["olym", ["Cascade South Demo Hospital"]],
        ["smart", ["SMART Health IT Sandbox"]],
      ]);
    });

    it("matches each word typed against any word of the row, one word of the row serving two if need be", () => {
      assertFinds([
        ["mount vern", ["Cascade North Demo Hospital"]],
        ["mount m", ["Cascade North Demo Hospital"]],
      ]);
    });

    it("ignores capitals and accents", () => {
      assertFinds([
        ["CASCADE south", ["Cascade South Demo Hospital"]],
        ["Olýmpia", ["Cascade South Demo Hospital"]],
      ]);
    });

    it("returns nothing for letters from the middle of a word, and for a word no row holds", () => {
      assertFinds([
        ["orth", []],
        ["seattle", []],
      ]);
    });
  });

  describe("TEST_DIRECTORY", () => {
    it("holds the launcher's row, whose FHIR base asks the launcher for the person's own login and approval, with PKCE, as a public client", () => {
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
});
