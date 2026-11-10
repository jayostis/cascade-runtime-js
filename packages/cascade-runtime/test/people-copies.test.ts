import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { checkouts, findRoot } from "@cascade-runtime/runtime/node";

interface Person {
  readonly id: string;
  readonly name: { readonly family: string; readonly given: string[] };
  readonly birthDate: string;
  readonly gender: string;
}

interface Patient {
  readonly resourceType: string;
  readonly name?: {
    readonly use?: string;
    readonly family?: string;
    readonly given?: string[];
  }[];
  readonly birthDate?: string;
  readonly gender?: string;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

/** The Patients a file holds: itself, or its Bundle's. */
function patientsIn(parsed: unknown): Patient[] {
  const one = parsed as {
    resourceType: string;
    entry?: { resource: Patient }[];
  };
  const resources =
    one.resourceType === "Bundle"
      ? (one.entry ?? []).map(({ resource }) => resource)
      : [one as Patient];
  return resources.filter(({ resourceType }) => resourceType === "Patient");
}

/** What a Patient disagrees with `person.json` on, by the rule of settlements §1.4; a field the Patient omits is not compared. */
function disagreements(patient: Patient, expected: Person): string[] {
  const found: string[] = [];
  const name =
    patient.name?.find(({ use }) => use === "official") ?? patient.name?.[0];
  if (
    name !== undefined &&
    (name.family !== expected.name.family ||
      JSON.stringify(name.given) !== JSON.stringify(expected.name.given))
  )
    found.push(`name ${JSON.stringify(name)}`);
  if (
    patient.birthDate !== undefined &&
    patient.birthDate !== expected.birthDate
  )
    found.push(`birthDate ${patient.birthDate}`);
  if (patient.gender !== undefined && patient.gender !== expected.gender)
    found.push(`gender ${patient.gender}`);
  return found;
}

/**
 * The made-up people of the vocabulary's kits are copied into the FHIR adapter's fixtures and saved from the sandbox's
 * demo hospital. These checks fail when one copy changes and the other does not.
 */
describe("Tripwire: copies of the kits' data kept in other repositories", () => {
  describe("given the FHIR adapter's fixtures", () => {
    let vocabulary: string;
    let fhirAdapter: string;

    before(async () => {
      const components = await checkouts(
        findRoot(dirname(fileURLToPath(import.meta.url))),
      );
      const folderOf = async (repository: string): Promise<string> => {
        const followed = [
          components.config.vocabulary,
          ...components.config.adapters,
        ].find((one) => one.repository.endsWith(`/${repository}`));
        if (!followed)
          throw new Error(`cascade-runtime.json names no ${repository}`);
        return (await components.resolve(followed)).folder;
      };
      vocabulary = await folderOf("cascade-vocabulary");
      fhirAdapter = await folderOf("cascade-bridge-adapter-fhir-r4");
    });

    it("holds each of Martin's two pulls exactly as his kit saves it", async () => {
      const pulls = join(
        vocabulary,
        "conformance",
        "martin-okafor",
        "scripted-input",
        "martin",
        "downloads",
      );
      for (const [pull, fixture] of [
        [
          "harbourline-2022",
          "martin-okafor-harbourline-panel-2022-with-lab.json",
        ],
        [
          "st-columba-2024",
          "martin-okafor-st-columba-exome-2024-with-lab.json",
        ],
      ] as const) {
        const kit = join(pulls, pull, "bundle.json");
        const copy = join(fhirAdapter, "fixtures", "in", fixture);
        assert.deepEqual(
          await json(copy),
          await json(kit),
          `${copy} differs from ${kit}`,
        );
      }
    });

    it("agrees with `person.json` on the name, birth date and gender of the Patient in each fixture of Alex and of Martin", async () => {
      const copies: Record<string, string[]> = {
        "alex-rivera": [
          "patient-with-id.json",
          "bundle-urn-uuid-full-urls.json",
        ],
        "martin-okafor": [
          "martin-okafor-harbourline-panel-2022-with-lab.json",
          "martin-okafor-st-columba-exome-2024-with-lab.json",
          "bundle-genomics-variants.json",
          "bundle-genomics-interpretations.json",
        ],
      };
      for (const [id, files] of Object.entries(copies)) {
        const expected = (await json(
          join(vocabulary, "people", id, "person.json"),
        )) as Person;
        for (const file of files) {
          const path = join(fhirAdapter, "fixtures", "in", file);
          const patients = patientsIn(await json(path));
          assert.equal(patients.length, 1, `${path} holds one Patient`);
          assert.deepEqual(
            disagreements(patients[0]!, expected),
            [],
            `${path} disagrees with ${id}'s person.json`,
          );
        }
      }
    });
  });
});
