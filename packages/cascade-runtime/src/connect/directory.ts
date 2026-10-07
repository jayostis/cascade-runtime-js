import type { DirectoryRow } from "./plan.js";

/**
 * Hospitals to develop and test against, none of them real: the demo hospitals, whose `.invalid` hosts answer only
 * through `@cascade-runtime/demo-hospital`'s fetch, never the real one, and the SMART Health IT launcher, whose
 * settings in its base ask for a patient's own login and approval.
 */
export const TEST_DIRECTORY: readonly DirectoryRow[] = [
  {
    name: "Cascade North Demo Hospital",
    vendor: "demo",
    fhirBase: "https://cascade-north.demo.invalid/fhir",
    places: ["Bellingham, WA", "Mount Vernon, WA"],
  },
  {
    name: "Cascade South Demo Hospital",
    vendor: "demo",
    fhirBase: "https://cascade-south.demo.invalid/fhir",
    places: ["Olympia, WA", "Centralia, WA"],
  },
  {
    name: "SMART Health IT Sandbox",
    vendor: "smart-launcher",
    fhirBase:
      "https://launch.smarthealthit.org/v/r4/sim/WzMsIiIsIiIsIkFVVE8iLDAsMCwwLCIiLCIiLCIiLCIiLCIiLCIiLCIiLDAsMiwiIl0/fhir",
  },
];

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * The rows in which every word of `text` begins a word of the row's name or of one of its places, ignoring case and
 * accents, in the directory's order. One word of a row may begin several words of `text`. Blank text gives every row.
 */
export function searchDirectory(
  directory: readonly DirectoryRow[],
  text: string,
): DirectoryRow[] {
  const wanted = words(text);
  return directory.filter((row) => {
    const held = [row.name, ...(row.places ?? [])].flatMap(words);
    return wanted.every((word) => held.some((one) => one.startsWith(word)));
  });
}
