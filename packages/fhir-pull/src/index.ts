import { ccdaDownload, isCdaDocument } from "@cascade-runtime/ccda-download";

export { isCdaDocument };
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const MEDIA_TYPE = "application/fhir+json";
const ENVELOPE = "#envelope-bundle";
const PULL = "pull.json";
const BUNDLE = "bundle.json";
const CCDA_MEDIA_TYPE = "application/cda+xml";
const DOCUMENT_FILE = /^document-[1-9][0-9]*\.xml$/;
const DOCUMENT_REFERENCE = /^DocumentReference\/[A-Za-z0-9\-.]{1,64}$/;
/** Whether the character is one the IRI grammar refuses: a control character, a space, or one of `<>"{}|^\`\\`. */
const notInAnIri = (character: string): boolean =>
  character.charCodeAt(0) <= 0x20 || '<>"{}|^`\\'.includes(character);
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
export const RESOURCE_TYPE = /^[A-Z][A-Za-z]+$/;

/** What `pullFiles` throws for a pull whose content the import would refuse: bad input, never a broken runtime. */
export class PullRefused extends Error {
  override readonly name = "PullRefused";
}

/** One search of a pull: a resource type, with the category it was narrowed to, if any. */
export interface SavedSearch {
  readonly type: string;
  readonly category?: string;
}

/**
 * A C-CDA document a DocumentReference of the pull holds: the content that holds it, and the document as read, or why
 * it was not.
 */
export interface SavedDocument {
  /** `DocumentReference/<id>`. */
  readonly documentReference: string;
  /** The content's position in the DocumentReference's `content`, from 0. */
  readonly content: number;
  /** The attachment's `url` as the DocumentReference wrote it; none for one given inline. */
  readonly url?: string;
  /** Where the document was read: the URL fetched, or the DocumentReference's for one given inline. */
  readonly retrievedFrom?: string;
  /** The document as read. */
  readonly bytes?: Uint8Array;
  /** Why it was not read. */
  readonly notRead?: string;
}

/** A pull as `cascade-runtime`'s `pull()` returns it, as far as saving it needs. */
export interface SavedPull {
  readonly fhirBase: string;
  readonly patient: string;
  /** The hospital's name. */
  readonly source: string;
  readonly retrievedAt: string;
  /** The world's date the hospital answered as of, when the host that made the hospital set one. */
  readonly asOf?: string;
  /** Each search the pull made. */
  readonly searches?: readonly SavedSearch[];
  /** The searches the hospital refused. */
  readonly denied?: readonly SavedSearch[];
  /** The C-CDA documents its DocumentReferences hold, each read or said why not. */
  readonly documents?: readonly SavedDocument[];
  readonly bundle: object;
}

/** The files a pull is read from, by path. */
export interface PullFiles {
  read(path: string): Promise<Uint8Array | undefined>;
}

export interface PullDocument {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly envelope?: string;
  readonly mediaType: string;
  facts(importStarted: string): Uint8Array;
}

/**
 * An entry of a pull's look: a record of its Bundle, by its kind and the hospital's base; or an entry of a C-CDA
 * document it read, by the document's custodian and section, as a downloaded C-CDA's look counts it.
 */
export interface PullIndexEntry {
  readonly source?: string;
  readonly server?: string;
  readonly kind?: string;
  readonly section?: string;
  readonly received?: string;
}

/** What `pull.json` says, once each part of it the import states is checked. */
interface Described {
  readonly fhirBase: string;
  readonly patient: string;
  readonly source: string;
  readonly retrievedAt: string;
  readonly asOf?: string;
  readonly searches: readonly SavedSearch[];
  readonly denied: readonly SavedSearch[];
  /** As saved: each read one names its file, `path`, in place of its bytes. */
  readonly documents: readonly SavedDocumentFile[];
}

type SavedDocumentFile = Omit<SavedDocument, "bytes"> & {
  readonly path?: string;
};

interface RecordOfType {
  /** The word `cascade:recordKind` gives it. */
  readonly kind: string;
  /** Its class's local name in the Cascade namespace. */
  readonly class: string;
}

/** Each type of resource that is a record, but an Observation. */
const KINDS: ReadonlyMap<string, RecordOfType> = new Map([
  ["AllergyIntolerance", { kind: "Allergy", class: "AllergyOrIntolerance" }],
  ["Condition", { kind: "Condition", class: "ProblemOrDiagnosis" }],
  ["Immunization", { kind: "Immunization", class: "Vaccination" }],
  ["Procedure", { kind: "Procedure", class: "MedicalProcedure" }],
  [
    "MedicationRequest",
    { kind: "Medication", class: "PrescribedOrReportedMedication" },
  ],
  [
    "MedicationStatement",
    { kind: "Medication", class: "PrescribedOrReportedMedication" },
  ],
  ["DiagnosticReport", { kind: "Report", class: "DiagnosticReport" }],
  [
    "DocumentReference",
    { kind: "Note or document", class: "ClinicalNoteOrDocument" },
  ],
]);
const LAB_RESULT: RecordOfType = {
  kind: "Lab result",
  class: "LaboratoryTestResult",
};

/** What a resource of the type, in the categories, is a record of, or undefined where the adapter makes none of it. */
function recordOf(
  type: unknown,
  categories: readonly unknown[],
): RecordOfType | undefined {
  if (type === "Observation")
    return categories.includes("laboratory") ? LAB_RESULT : undefined;
  return typeof type === "string" ? KINDS.get(type) : undefined;
}

/**
 * The pull as the folder `name` of two files: `bundle.json`, its Bundle, the import's one document; and `pull.json`,
 * everything else the pull holds. A pull the import would refuse is refused here, before it is saved.
 */
export function pullFiles(
  pull: SavedPull,
  name: string,
): ReadonlyMap<string, Uint8Array> {
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name))
    throw new TypeError(`a pull is saved under one folder name, not ${name}`);
  const { bundle, documents = [], ...rest } = pull;
  const files: [string, Uint8Array][] = [];
  const same = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((byte, at) => byte === b[at]);
  const saved = documents.map(({ bytes, ...document }) => {
    if (bytes === undefined) return document;
    const at = files.findIndex(([, held]) => same(held, bytes));
    if (at >= 0) return { ...document, path: `document-${at + 1}.xml` };
    files.push([`${name}/document-${files.length + 1}.xml`, bytes]);
    return { ...document, path: `document-${files.length}.xml` };
  });
  const described = { ...rest, ...(saved.length > 0 && { documents: saved }) };
  checked(described);
  const encoder = new TextEncoder();
  return new Map([
    [
      `${name}/${PULL}`,
      encoder.encode(`${JSON.stringify(described, null, 2)}\n`),
    ],
    [`${name}/${BUNDLE}`, encoder.encode(JSON.stringify(bundle))],
    ...files,
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
  return checked(json(bytes));
}

function checked(value: unknown): Described {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new PullRefused(`${PULL} is not a JSON object`);
  const {
    fhirBase,
    patient,
    source,
    retrievedAt,
    asOf,
    searches,
    denied,
    documents,
  } = value as Record<string, unknown>;
  if (!isFhirBase(fhirBase))
    throw new PullRefused(
      `${PULL}'s fhirBase is not an https: URL with no query, fragment or trailing slash`,
    );
  if (typeof patient !== "string" || !FHIR_ID.test(patient))
    throw new PullRefused(`${PULL}'s patient is not a FHIR id`);
  if (typeof source !== "string" || source.trim() === "")
    throw new PullRefused(`${PULL}'s source is not a name`);
  if (!isUtc(retrievedAt))
    throw new PullRefused(`${PULL}'s retrievedAt is not a time in UTC`);
  if (asOf !== undefined && !isUtc(asOf))
    throw new PullRefused(`${PULL}'s asOf is not a time in UTC`);
  return {
    fhirBase,
    patient,
    source,
    retrievedAt,
    ...(asOf !== undefined && { asOf }),
    searches: searchesIn(searches, "searches"),
    denied: searchesIn(denied, "denied"),
    documents: documentsIn(documents, fhirBase),
  };
}

/**
 * Whether the value is where a document of the pull was read: an https: URL on the FHIR base's origin, with no user
 * name, as the URL writes it, holding no character an IRI may not, so it is stated as the IRI it is and nothing else.
 */
function isReadFrom(value: unknown, fhirBase: string): value is string {
  if (typeof value !== "string" || [...value].some(notInAnIri)) return false;
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.origin === new URL(fhirBase).origin
    );
  } catch {
    return false;
  }
}

/** Each document is a DocumentReference's content, read into one file of the folder or said why not, never both. */
function documentsIn(
  value: unknown,
  fhirBase: string,
): readonly SavedDocumentFile[] {
  if (value === undefined) return [];
  const text = (field: unknown) =>
    field === undefined || (typeof field === "string" && field !== "");
  if (
    !Array.isArray(value) ||
    !value.every((document: unknown) => {
      const { documentReference, content, url, retrievedFrom, path, notRead } =
        (
          typeof document === "object" && document !== null ? document : {}
        ) as Record<string, unknown>;
      return (
        typeof documentReference === "string" &&
        DOCUMENT_REFERENCE.test(documentReference) &&
        Number.isInteger(content) &&
        (content as number) >= 0 &&
        text(url) &&
        text(retrievedFrom) &&
        (typeof path === "string"
          ? DOCUMENT_FILE.test(path) &&
            notRead === undefined &&
            isReadFrom(retrievedFrom, fhirBase)
          : typeof notRead === "string" && notRead !== "")
      );
    })
  )
    throw new PullRefused(
      `${PULL}'s documents is not a list of C-CDA documents, each a DocumentReference's content, read into a file of the folder or said why not`,
    );
  return value as SavedDocumentFile[];
}

function searchesIn(value: unknown, field: string): readonly SavedSearch[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((search: unknown) => {
      const { type, category } = (
        typeof search === "object" && search !== null ? search : {}
      ) as Record<string, unknown>;
      return (
        typeof type === "string" &&
        RESOURCE_TYPE.test(type) &&
        (category === undefined ||
          (typeof category === "string" && category !== ""))
      );
    })
  )
    throw new PullRefused(
      `${PULL}'s ${field} is not a list of searches, each a resource type and an optional category`,
    );
  return value as SavedSearch[];
}

/** The IRI of the class of record each search returns, once each; a search whose resources become no record has none. */
function classesOf(searches: readonly SavedSearch[]): string[] {
  return [
    ...new Set(
      searches.flatMap(({ type, category }) => {
        const record = recordOf(type, category === undefined ? [] : [category]);
        return record === undefined ? [] : [`${CASCADE}${record.class}`];
      }),
    ),
  ];
}

/** Whether the value is an https: URL with no query, fragment, trailing slash or surrounding space. */
function isFhirBase(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.endsWith("/") ||
    value.includes("?") ||
    value.includes("#")
  )
    return false;
  try {
    const base = new URL(value);
    return base.protocol === "https:" && base.search === "" && base.hash === "";
  } catch {
    return false;
  }
}

function isUtc(value: unknown): value is string {
  if (typeof value !== "string" || !UTC.test(value)) return false;
  const at = new Date(value);
  return (
    !Number.isNaN(at.getTime()) &&
    at.toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

/** What the pull says of its document and of its import, as Turtle, for the Bridge to state. */
function facts(pull: Described, importStarted: string): Uint8Array {
  const document = `<${BRIDGE}thisDocument>`;
  const thisImport = `<${BRIDGE}thisImport>`;
  const dateTime = (value: string): string =>
    `${quoted(value)}^^<${XSD}dateTime>`;
  const refused = (search: SavedSearch): boolean =>
    pull.denied.some(
      ({ type, category }) =>
        type === search.type && category === search.category,
    );
  const scope = (property: string, searches: readonly SavedSearch[]) =>
    classesOf(searches).map(
      (recordClass) => `${document} <${CASCADE}${property}> <${recordClass}> .`,
    );
  const lines = [
    `${thisImport} <${RDFS}label> ${quoted("FHIR pull")} .`,
    `${thisImport} <${PROV}startedAtTime> ${dateTime(importStarted)} .`,
    `${document} <${CASCADE}serverBaseUrl> ${quoted(pull.fhirBase)} .`,
    `${document} <${PAV}retrievedOn> ${dateTime(pull.retrievedAt)} .`,
    ...(pull.asOf === undefined
      ? []
      : [`${document} <${CASCADE}answeredAsOf> ${dateTime(pull.asOf)} .`]),
    ...scope(
      "answersForRecordClass",
      pull.searches.filter((search) => !refused(search)),
    ),
    ...scope("refusedForRecordClass", pull.denied),
    `${document} <${CASCADE}authenticatedPatient> ${quoted(`Patient/${pull.patient}`)} .`,
    `${document} <${PROV}qualifiedAttribution> _:attribution .`,
    `_:attribution <${PROV}agent> _:agent .`,
    `_:agent <${RDFS}label> ${quoted(pull.source)} .`,
    `_:attribution <${PROV}hadRole> <${CASCADE}AuthorRole> .`,
  ];
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

/** What the pull says of a C-CDA document it read, and of its import, as Turtle, for the Bridge to state. */
function documentFacts(
  pull: Described,
  retrievedFrom: string,
  importStarted: string,
): Uint8Array {
  const document = `<${BRIDGE}thisDocument>`;
  const thisImport = `<${BRIDGE}thisImport>`;
  const dateTime = (value: string): string =>
    `${quoted(value)}^^<${XSD}dateTime>`;
  const lines = [
    `${thisImport} <${RDFS}label> ${quoted("FHIR pull")} .`,
    `${thisImport} <${PROV}startedAtTime> ${dateTime(importStarted)} .`,
    `${document} <${PAV}retrievedFrom> <${retrievedFrom}> .`,
    `${document} <${PAV}retrievedOn> ${dateTime(pull.retrievedAt)} .`,
    `${document} <${CASCADE}authenticatedPatient> ${quoted(`Patient/${pull.patient}`)} .`,
    `${document} <${PROV}qualifiedAttribution> _:attribution .`,
    `_:attribution <${PROV}agent> _:agent .`,
    `_:agent <${RDFS}label> ${quoted(pull.source)} .`,
    `_:attribution <${PROV}hadRole> <${CASCADE}AuthorRole> .`,
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

function codes(concepts: unknown): unknown[] {
  return (Array.isArray(concepts) ? concepts : []).flatMap((concept) => {
    const coding =
      typeof concept === "object" && concept !== null
        ? (concept as { coding?: unknown }).coding
        : undefined;
    return (Array.isArray(coding) ? coding : []).map((one) =>
      typeof one === "object" && one !== null
        ? (one as { code?: unknown }).code
        : undefined,
    );
  });
}

/** The systems of the format codes that say a DocumentReference's content is a structured C-CDA document. */
const FORMAT_CODE_SYSTEMS: ReadonlySet<unknown> = new Set([
  "http://terminology.hl7.org/CodeSystem/v3-HL7DocumentFormatCodes",
  "http://ihe.net/fhir/ValueSet/IHE.FormatCode.codesystem",
  "http://ihe.net/fhir/ihe.formatcode.fhir/CodeSystem/formatcode",
]);

/** A content of a DocumentReference that holds a C-CDA document: its position, and its attachment. */
export interface CcdaContent {
  readonly content: number;
  readonly attachment: Record<string, unknown>;
}

/**
 * The contents of a DocumentReference that are structured C-CDA documents, by their format, as the FHIR adapter reads
 * them: `urn:hl7-org:sdwg:ccda-structuredBody:` and a version, in HL7's or IHE's format codes. An unstructured one
 * (`ccda-nonXMLBody:`), a PDF or text in a CDA header, holds no entries a C-CDA adapter reads, so it is a note.
 */
export function ccdaContents(resource: Record<string, unknown>): CcdaContent[] {
  if (resource.resourceType !== "DocumentReference") return [];
  return (Array.isArray(resource.content) ? resource.content : []).flatMap(
    (content: unknown, at: number) => {
      const { format, attachment } = (
        typeof content === "object" && content !== null ? content : {}
      ) as { format?: unknown; attachment?: unknown };
      if (typeof format !== "object" || format === null) return [];
      const { system, code } = format as { system?: unknown; code?: unknown };
      return FORMAT_CODE_SYSTEMS.has(system) &&
        typeof code === "string" &&
        code.startsWith("urn:hl7-org:sdwg:ccda-structuredBody:")
        ? [
            {
              content: at,
              attachment: (typeof attachment === "object" && attachment !== null
                ? attachment
                : {}) as Record<string, unknown>,
            },
          ]
        : [];
    },
  );
}

/**
 * The resource's `cascade:recordKind`, or undefined where the adapter makes no record of it: a laboratory Observation
 * that groups others by `hasMember` is a panel, whose members are the records, and a DocumentReference whose content
 * is a C-CDA document is a source of its own, whose records are that document's.
 */
function kindOf(resource: Record<string, unknown>): string | undefined {
  if (
    resource.resourceType === "Observation" &&
    Array.isArray(resource.hasMember) &&
    resource.hasMember.length > 0
  )
    return undefined;
  if (ccdaContents(resource).length > 0) return undefined;
  return recordOf(resource.resourceType, codes(resource.category))?.kind;
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
    const ccda: PullDocument[] = [];
    const handed = new Set<string>();
    for (const { path, retrievedFrom } of pull.documents) {
      if (path === undefined || retrievedFrom === undefined || handed.has(path))
        continue;
      handed.add(path);
      const document = await files.read(`${folder}/${path}`);
      if (document === undefined) throw new Error(`the pull holds no ${path}`);
      ccda.push({
        path: `${folder}/${path}`,
        bytes: document,
        mediaType: CCDA_MEDIA_TYPE,
        facts: (importStarted) =>
          documentFacts(pull, retrievedFrom, importStarted),
      });
    }
    return [
      {
        path: `${folder}/${BUNDLE}`,
        bytes,
        envelope: ENVELOPE,
        mediaType: MEDIA_TYPE,
        facts: (importStarted) => facts(pull, importStarted),
      },
      ...ccda,
    ];
  },

  /**
   * One entry for each resource of the Bundle the adapter makes a record of, and one for each entry of each C-CDA
   * document the pull read, so the look the person approves holds what the import brings in.
   */
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
    const records = ((bundle.entry ?? []) as unknown[]).flatMap((entry) => {
      const resource =
        typeof entry === "object" && entry !== null
          ? (entry as { resource?: unknown }).resource
          : undefined;
      if (typeof resource !== "object" || resource === null) return [];
      const kind = kindOf(resource as Record<string, unknown>);
      if (kind === undefined) return [];
      return [
        {
          source: pull.source,
          server: pull.fhirBase,
          kind,
          received: pull.retrievedAt,
        },
      ];
    });
    const sections: PullIndexEntry[] = [];
    for (const path of new Set(
      pull.documents.flatMap(({ path }) => path ?? []),
    ))
      sections.push(
        ...((await ccdaDownload.index(files, `${folder}/${path}`)) ?? []),
      );
    return [...records, ...sections];
  },
};

const CONNECT = "connect.json";
const CAPABILITY = "capability.json";
const SMART_CONFIGURATION = "smart-configuration.json";
const NOTHING: Record<string, unknown> = {};
const OAUTH_URIS =
  "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris";

/** What `connectFiles` and `readConnect` throw for a connect the import would refuse: bad input, never a broken runtime. */
export class ConnectRefused extends Error {
  override readonly name = "ConnectRefused";
}

/**
 * A connect as an app saves it: the base it connected to, the client id it signed in with, and what the server answered
 * of itself.
 */
export interface SavedConnect {
  readonly fhirBase: string;
  readonly clientId: string;
  /** The server's CapabilityStatement, as it answered `GET <fhirBase>/metadata`. */
  readonly capability: object;
  /** The server's SMART configuration, as it answered `GET <fhirBase>/.well-known/smart-configuration`, where it did. */
  readonly smartConfiguration?: object;
}

/**
 * What a connect says of its server (runtime/arrivals.feature, A16): the base and client id the app used, and each fact
 * the server reported, as it wrote it, where it wrote a string that is not empty.
 */
export interface Reported {
  readonly fhirBase: string;
  readonly clientId: string;
  readonly selfAssertedBaseUrl?: string;
  readonly authorizationEndpoint?: string;
  readonly softwareName?: string;
  readonly softwareVersion?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `smart` is undefined where the connect saved no SMART configuration. */
function reported(
  connect: unknown,
  capability: unknown,
  smart: unknown,
): Reported {
  const saved = record(connect);
  if (saved === undefined)
    throw new ConnectRefused(`${CONNECT} is not a JSON object`);
  const { fhirBase, clientId } = saved;
  if (!isFhirBase(fhirBase))
    throw new ConnectRefused(
      `${CONNECT}'s fhirBase is not an https: URL with no query, fragment or trailing slash`,
    );
  if (text(clientId) === undefined)
    throw new ConnectRefused(`${CONNECT} names no client id`);
  const statement = record(capability);
  if (statement?.resourceType !== "CapabilityStatement")
    throw new ConnectRefused(`${CAPABILITY} is no CapabilityStatement`);
  const configuration = smart === undefined ? NOTHING : record(smart);
  if (configuration === undefined)
    throw new ConnectRefused(`${SMART_CONFIGURATION} is not a JSON object`);
  const server = list(statement.rest)
    .map(record)
    .find((rest) => rest?.mode === "server");
  const authorize = list(record(server?.security)?.extension)
    .map(record)
    .find((extension) => extension?.url === OAUTH_URIS);
  const facts: Record<string, string | undefined> = {
    selfAssertedBaseUrl: text(record(statement.implementation)?.url),
    authorizationEndpoint:
      text(configuration.authorization_endpoint) ??
      text(
        list(authorize?.extension)
          .map(record)
          .find((extension) => extension?.url === "authorize")?.valueUri,
      ),
    softwareName: text(record(statement.software)?.name),
    softwareVersion: text(record(statement.software)?.version),
  };
  return {
    fhirBase,
    clientId: clientId as string,
    ...Object.fromEntries(
      Object.entries(facts).filter(([, value]) => value !== undefined),
    ),
  };
}

/**
 * The connect as the folder `name` of two files, `capability.json`, what the server answered, and `connect.json`, the
 * base and the client id, and a third, `smart-configuration.json`, where the connect holds one. A connect the import
 * would refuse is refused here, before it is saved.
 */
export function connectFiles(
  connect: SavedConnect,
  name: string,
): ReadonlyMap<string, Uint8Array> {
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name))
    throw new TypeError(
      `a connect is saved under one folder name, not ${name}`,
    );
  const { capability, fhirBase, clientId, smartConfiguration } = connect;
  reported({ fhirBase, clientId }, capability, smartConfiguration);
  const encoder = new TextEncoder();
  return new Map([
    [
      `${name}/${CONNECT}`,
      encoder.encode(`${JSON.stringify({ fhirBase, clientId }, null, 2)}\n`),
    ],
    [`${name}/${CAPABILITY}`, encoder.encode(JSON.stringify(capability))],
    ...(smartConfiguration === undefined
      ? []
      : [
          [
            `${name}/${SMART_CONFIGURATION}`,
            encoder.encode(JSON.stringify(smartConfiguration)),
          ] as const,
        ]),
  ]);
}

/** What the connect saved in the folder reports; one that holds no `connect.json`, or that A14 refuses, is refused. */
export async function readConnect(
  files: PullFiles,
  folder: string,
): Promise<Reported> {
  const saved = await files.read(`${folder}/${CONNECT}`);
  if (saved === undefined)
    throw new ConnectRefused(`${folder} holds no ${CONNECT}`);
  const capability = await files.read(`${folder}/${CAPABILITY}`);
  if (capability === undefined)
    throw new ConnectRefused(`${folder} holds no ${CAPABILITY}`);
  const smart = await files.read(`${folder}/${SMART_CONFIGURATION}`);
  return reported(
    json(saved),
    json(capability),
    smart === undefined ? undefined : (json(smart) ?? null),
  );
}
