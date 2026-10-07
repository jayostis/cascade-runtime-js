const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const MEDIA_TYPE = "application/fhir+json";
const ENVELOPE = "#envelope-bundle";
const PULL = "pull.json";
const BUNDLE = "bundle.json";
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/** A pull as `cascade-runtime`'s `pull()` returns it, as far as saving it needs. */
export interface SavedPull {
  readonly fhirBase: string;
  readonly patient: string;
  /** The hospital's name. */
  readonly source: string;
  readonly retrievedAt: string;
  readonly bundle: object;
}

/** The files a pull is read from, by path. */
export interface PullFiles {
  read(path: string): Promise<Uint8Array | undefined>;
}

export interface PullDocument {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly envelope: string;
  readonly mediaType: string;
  facts(importStarted: string): Uint8Array;
}

export interface PullIndexEntry {
  readonly source: string;
  readonly server: string;
  readonly kind: string;
  readonly received: string;
}

/** What `pull.json` says, once each part of it the import states is checked. */
interface Described {
  readonly fhirBase: string;
  readonly patient: string;
  readonly source: string;
  readonly retrievedAt: string;
}

/** The word `rec:kind` gives each type of resource that is a record. */
const KINDS: ReadonlyMap<string, string> = new Map([
  ["AllergyIntolerance", "Allergy"],
  ["Condition", "Condition"],
  ["Immunization", "Immunization"],
  ["Procedure", "Procedure"],
  ["MedicationRequest", "Medication"],
  ["MedicationStatement", "Medication"],
]);

/**
 * The pull as the folder `name` of two files: `bundle.json`, its Bundle, the import's one document; and `pull.json`,
 * everything else the pull holds.
 */
export function pullFiles(
  pull: SavedPull,
  name: string,
): ReadonlyMap<string, Uint8Array> {
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name))
    throw new TypeError(`a pull is saved under one folder name, not ${name}`);
  const { bundle, ...rest } = pull;
  const encoder = new TextEncoder();
  return new Map([
    [`${name}/${PULL}`, encoder.encode(`${JSON.stringify(rest, null, 2)}\n`)],
    [`${name}/${BUNDLE}`, encoder.encode(JSON.stringify(bundle))],
  ]);
}

function quoted(text: string): string {
  return `"${text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function described(bytes: Uint8Array): Described {
  const value = json(bytes);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${PULL} is not a JSON object`);
  const { fhirBase, patient, source, retrievedAt } = value as Record<
    string,
    unknown
  >;
  let base: URL | undefined;
  try {
    base = typeof fhirBase === "string" ? new URL(fhirBase) : undefined;
  } catch {
    base = undefined;
  }
  if (
    typeof fhirBase !== "string" ||
    base?.protocol !== "https:" ||
    base.search !== "" ||
    base.hash !== "" ||
    fhirBase.includes("?") ||
    fhirBase.includes("#")
  )
    throw new Error(
      `${PULL}'s fhirBase is not an https: URL with no query or fragment`,
    );
  if (typeof patient !== "string" || !FHIR_ID.test(patient))
    throw new Error(`${PULL}'s patient is not a FHIR id`);
  if (typeof source !== "string" || source.trim() === "")
    throw new Error(`${PULL}'s source is not a name`);
  if (
    typeof retrievedAt !== "string" ||
    !UTC.test(retrievedAt) ||
    Number.isNaN(Date.parse(retrievedAt))
  )
    throw new Error(`${PULL}'s retrievedAt is not a time in UTC`);
  return { fhirBase, patient, source, retrievedAt };
}

/** What the pull says of its document and of its import, as Turtle, for the Bridge to state. */
function facts(pull: Described, importStarted: string): Uint8Array {
  const document = `<${BRIDGE}thisDocument>`;
  const thisImport = `<${BRIDGE}thisImport>`;
  const dateTime = (value: string): string =>
    `${quoted(value)}^^<${XSD}dateTime>`;
  const lines = [
    `${thisImport} <${RDFS}label> ${quoted("FHIR pull")} .`,
    `${thisImport} <${PROV}startedAtTime> ${dateTime(importStarted)} .`,
    `${document} <${BRIDGE}serverBaseUrl> ${quoted(pull.fhirBase)} .`,
    `${document} <${PAV}retrievedOn> ${dateTime(pull.retrievedAt)} .`,
    `${document} <${BRIDGE}authenticatedPatient> ${quoted(`Patient/${pull.patient}`)} .`,
    `${document} <${PROV}qualifiedAttribution> _:attribution .`,
    `_:attribution <${PROV}agent> _:agent .`,
    `_:agent <${RDFS}label> ${quoted(pull.source)} .`,
    `_:attribution <${PROV}hadRole> <${REC}author> .`,
  ];
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

/** The pull in the folder, or undefined when the folder holds none. */
async function read(
  files: PullFiles,
  folder: string,
): Promise<{ pull: Described; bytes: Uint8Array } | undefined> {
  const saved = await files.read(`${folder}/${PULL}`);
  if (saved === undefined) return undefined;
  const pull = described(saved);
  const bytes = await files.read(`${folder}/${BUNDLE}`);
  if (bytes === undefined) throw new Error(`the pull holds no ${BUNDLE}`);
  return { pull, bytes };
}

function kindOf(resource: Record<string, unknown>): string {
  const type = String(resource.resourceType);
  if (type === "Observation") {
    const laboratory = (
      Array.isArray(resource.category) ? resource.category : []
    ).some((concept: { coding?: { code?: unknown }[] }) =>
      (concept.coding ?? []).some(({ code }) => code === "laboratory"),
    );
    return laboratory ? "Lab result" : type;
  }
  return KINDS.get(type) ?? type;
}

/** The importer of a pull saved by `pullFiles`: its Bundle, with what `pull.json` says of it. */
export const fhirPull = {
  name: "fhir-pull",

  async documents(
    files: PullFiles,
    folder: string,
  ): Promise<PullDocument[] | undefined> {
    const found = await read(files, folder);
    if (found === undefined) return undefined;
    const { pull, bytes } = found;
    return [
      {
        path: `${folder}/${BUNDLE}`,
        bytes,
        envelope: ENVELOPE,
        mediaType: MEDIA_TYPE,
        facts: (importStarted) => facts(pull, importStarted),
      },
    ];
  },

  /** One entry for each resource of the Bundle but the Patient: a pull has no index apart from its document. */
  async index(
    files: PullFiles,
    folder: string,
  ): Promise<PullIndexEntry[] | undefined> {
    const found = await read(files, folder);
    if (found === undefined) return undefined;
    const { pull, bytes } = found;
    const bundle = json(bytes) as { entry?: unknown } | undefined;
    if (
      typeof bundle !== "object" ||
      bundle === null ||
      !Array.isArray(bundle.entry ?? [])
    )
      throw new Error(`${BUNDLE} is not a Bundle`);
    return ((bundle.entry ?? []) as unknown[]).flatMap((entry) => {
      const resource =
        typeof entry === "object" && entry !== null
          ? (entry as { resource?: unknown }).resource
          : undefined;
      if (typeof resource !== "object" || resource === null) return [];
      const record = resource as Record<string, unknown>;
      if (record.resourceType === "Patient") return [];
      return [
        {
          source: pull.source,
          server: pull.fhirBase,
          kind: kindOf(record),
          received: pull.retrievedAt,
        },
      ];
    });
  },
};
