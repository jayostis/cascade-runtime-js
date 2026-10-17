import { DEMO_BRANDS } from "./demo-brands.js";
import type { DirectoryRow } from "./plan.js";

type Json = Record<string, unknown>;

function object(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function objects(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.map(object).filter((each) => each !== undefined)
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function place(address: Json): string | undefined {
  const where = [text(address.city), text(address.state)].filter(
    (part) => part !== undefined,
  );
  return where.length === 0 ? undefined : where.join(", ");
}

const FHIR_VERSION =
  "http://hl7.org/fhir/StructureDefinition/endpoint-fhir-version";

function isR4(endpoint: Json): boolean {
  const versions = objects(endpoint.extension)
    .filter((each) => each.url === FHIR_VERSION)
    .map((each) => text(each.valueCode) ?? "");
  return versions.length === 0 || versions.some((v) => v.startsWith("4.0"));
}

/**
 * The rows of a SMART User-access Brands Bundle: one per endpoint of an Organization whose Endpoint is
 * `hl7-fhir-rest`, in the bundle's order, with the Endpoint's address (without a trailing slash) as the FHIR base and
 * the Organization's addresses as `"City, ST"` places. An Organization with no endpoint of its own uses its `partOf`
 * parent's, one hop; an Endpoint that states a FHIR version other than R4 is skipped. A bundle names no vendor, so the
 * caller does. What cannot be read is skipped, never thrown on.
 */
export function directoryOf(brands: unknown, vendor: string): DirectoryRow[] {
  const bundle = object(brands);
  if (bundle?.resourceType !== "Bundle") return [];
  const resources = objects(bundle.entry).flatMap((entry) => {
    const resource = object(entry.resource);
    return resource === undefined ? [] : [{ resource, url: entry.fullUrl }];
  });
  const named = new Map<string, Json>();
  for (const { resource, url } of resources) {
    const id = text(resource.id);
    if (id !== undefined) named.set(`${resource.resourceType}/${id}`, resource);
    if (typeof url === "string") named.set(url, resource);
  }
  const referred = (reference: unknown) => named.get(String(reference));
  return resources.flatMap(({ resource }) => {
    const name = text(resource.name);
    if (resource.resourceType !== "Organization" || name === undefined)
      return [];
    const places = objects(resource.address).flatMap(
      (address) => place(address) ?? [],
    );
    const own = objects(resource.endpoint);
    const parent = referred(object(resource.partOf)?.reference);
    const references =
      own.length > 0 || parent === undefined ? own : objects(parent.endpoint);
    return references.flatMap((reference) => {
      const endpoint = referred(reference.reference);
      const fhirBase = text(endpoint?.address)?.replace(/\/+$/, "");
      if (
        endpoint?.resourceType !== "Endpoint" ||
        object(endpoint.connectionType)?.code !== "hl7-fhir-rest" ||
        !isR4(endpoint) ||
        fhirBase === undefined
      )
        return [];
      return [
        { name, vendor, fhirBase, ...(places.length > 0 ? { places } : {}) },
      ];
    });
  });
}

/**
 * Hospitals to develop and test against, none of them real: the demo hospitals, read from `DEMO_BRANDS`, whose
 * `.invalid` hosts answer only through `@the-cascade-protocol/sandbox`'s fetch, never the real one, and the SMART
 * Health IT launcher, whose settings in its base ask for a patient's own login and approval.
 */
export const TEST_DIRECTORY: readonly DirectoryRow[] = [
  ...directoryOf(DEMO_BRANDS, "demo"),
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
