import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { pullFiles, openPod } from "cascade-runtime";
import { componentsOf } from "@cascade-runtime/runtime/node";

/** A person's record the fhir-r4 adapter commits, by the id a row names it with, and the id of its bench/manifest.json entry. */
export const DATASETS = {
  "synthea-10y": "fhir-r4-synthea-10y-trimmed",
  "synthea-lifetime": "fhir-r4-synthea-lifetime",
} as const;
export type DatasetId = keyof typeof DATASETS;

/** The size every build runs, and the sizes a nightly or on-demand run adds. */
export const PER_BUILD: DatasetId = "synthea-10y";
export const LARGE: DatasetId = "synthea-lifetime";

export interface Dataset {
  readonly id: DatasetId;
  /** The sha256 of the uncompressed Bundle, as the adapter's manifest states it, and verified. */
  readonly sha256: string;
  readonly records: number;
  readonly bundle: object;
  readonly fhirBase: string;
  readonly patient: string;
}

async function adapterFolder(): Promise<string> {
  const given = process.env.PERF_INPUTS_DIR;
  if (given !== undefined) return given;
  const components = await componentsOf(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const adapter = components.config.adapters.find(({ repository }) =>
    repository.endsWith("cascade-bridge-adapter-fhir-r4"),
  );
  if (adapter === undefined)
    throw new Error("cascade-runtime.json names no fhir-r4 adapter");
  return (await components.resolve(adapter)).folder;
}

/** Where the adapter commits a record's gzipped Bundle, and the digest its bench/manifest.json states for the uncompressed one. */
export async function inputOf(
  id: DatasetId,
): Promise<{ path: string; sha256: string }> {
  const folder = await adapterFolder();
  const manifest = JSON.parse(
    await readFile(join(folder, "bench", "manifest.json"), "utf8"),
  ) as { inputs: { id: string; path: string; sha256: string }[] };
  const input = manifest.inputs.find(({ id: each }) => each === DATASETS[id]);
  if (input === undefined)
    throw new Error(
      `the adapter's bench/manifest.json holds no ${DATASETS[id]}`,
    );
  return { path: join(folder, input.path), sha256: input.sha256 };
}

/** One Synthea patient's record, read from the adapter's committed input and checked against the digest its manifest holds. */
export async function loadDataset(id: DatasetId): Promise<Dataset> {
  const input = await inputOf(id);
  const bytes = gunzipSync(await readFile(input.path));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== input.sha256)
    throw new Error(
      `${input.path} is ${sha256}, the manifest says ${input.sha256}`,
    );
  const bundle = JSON.parse(new TextDecoder().decode(bytes)) as {
    entry: {
      fullUrl: string;
      resource: { resourceType: string; id: string };
    }[];
  };
  const patient = bundle.entry.find(
    ({ resource }) => resource.resourceType === "Patient",
  );
  if (patient === undefined) throw new Error(`${input.path} has no Patient`);
  // A Bundle whose entries are named urn:uuid:… has no server; the pull is given one, as a hospital's would be.
  const fhirBase = patient.fullUrl.startsWith("https://")
    ? patient.fullUrl.slice(
        0,
        patient.fullUrl.lastIndexOf(`/Patient/${patient.resource.id}`),
      )
    : "https://synthea.demo.invalid/fhir";
  return {
    id,
    sha256,
    records: bundle.entry.length,
    bundle,
    fhirBase,
    patient: patient.resource.id,
  };
}

export function pullOf(
  data: Dataset,
  bundle: object,
): ReadonlyMap<string, Uint8Array> {
  return pullFiles(
    {
      fhirBase: data.fhirBase,
      patient: data.patient,
      source: "Synthea",
      retrievedAt: "2026-11-01T09:00:00Z",
      bundle,
    },
    "pull",
  );
}

/** The profile the record's patient has, which an import that names it as the person's own takes: found in a pod of its own, apart from every run measured. */
export async function profileOfPatient(
  data: Dataset,
): Promise<readonly string[]> {
  const { entry } = data.bundle as {
    entry: { resource: { resourceType: string } }[];
  };
  const only = {
    resourceType: "Bundle",
    type: "collection",
    entry: entry.filter(({ resource }) => resource.resourceType === "Patient"),
  };
  const scratch = await openPod();
  try {
    const { unclaimedProfiles } = await scratch.import(pullOf(data, only), {
      match: false,
    });
    return unclaimedProfiles;
  } finally {
    await scratch.close();
  }
}
