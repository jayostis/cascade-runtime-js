import { SaxesParser, type SaxesTagNS } from "saxes";

const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const HL7 = "urn:hl7-org:v3";
const SLICE = 1 << 24;
const US_REALM_HEADER = "2.16.840.1.113883.10.20.22.1.1";
const NPI_ROOT = "2.16.840.1.113883.4.6";
const NPI = "http://hl7.org/fhir/sid/us-npi";
const OID = /^[0-2](\.(0|[1-9][0-9]*))+$/;
const UUID =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const HEADER = ["ClinicalDocument"];
const CUSTODIAN = [
  "ClinicalDocument",
  "custodian",
  "assignedCustodian",
  "representedCustodianOrganization",
];
const PATIENT = ["ClinicalDocument", "recordTarget", "patientRole"];
const SECTION = [
  "ClinicalDocument",
  "component",
  "structuredBody",
  "component",
  "section",
];

/** The files a download is read from, by path. */
export interface DownloadFiles {
  read(path: string): Promise<Uint8Array | undefined>;
}

export interface CcdaDocument {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  facts(importStarted: string): Uint8Array;
}

export interface CcdaIndexEntry {
  readonly source?: string;
  readonly section?: string;
  readonly received?: string;
}

interface Section {
  title?: string;
  entries: number;
}

/** A CDA `id`: its root, and its extension where it has one. */
export interface CdaId {
  readonly root: string;
  readonly extension?: string;
}

/** What the header and the body's sections say. */
interface Header {
  version?: string;
  effectiveTime?: string;
  custodian?: string;
  readonly custodianIds: CdaId[];
  patients: number;
  patientId?: CdaId;
  readonly sections: Section[];
}

const OTHER = Symbol("another document element");

/** An `id` with a root and no `nullFlavor`, its extension only where it is not empty. */
function idOf(tag: SaxesTagNS): CdaId | undefined {
  const root = tag.attributes.root?.value;
  const extension = tag.attributes.extension?.value;
  if (root === undefined || root === "" || tag.attributes.nullFlavor)
    return undefined;
  return extension === undefined || extension === ""
    ? { root }
    : { root, extension };
}

/**
 * An organization's `id` as the identifier cascade-vocabulary's decisions/naming.md maps it to, keyed as the
 * organization's name picks one: the NPI first, then the least type and value. Written back as a root and an extension,
 * a UUID root in lower case. Undefined for an `id` that maps to no identifier.
 */
function organizationIdOf(
  id: CdaId,
): { readonly key: string; readonly id: CdaId } | undefined {
  const root = OID.test(id.root)
    ? id.root
    : UUID.test(id.root)
      ? id.root.toLowerCase()
      : undefined;
  if (root === undefined) return undefined;
  const rootIri = OID.test(root) ? `urn:oid:${root}` : `urn:uuid:${root}`;
  const system = root === NPI_ROOT ? NPI : rootIri;
  if (id.extension === undefined && system !== rootIri) return undefined;
  const [type, value] =
    id.extension === undefined
      ? ["urn:ietf:rfc:3986", rootIri]
      : [system, id.extension];
  return {
    key: `${type === NPI ? "0" : "1"}${type} ${value}`,
    id:
      id.extension === undefined ? { root } : { root, extension: id.extension },
  };
}

/** Compares two strings code point by code point, as SPARQL orders them; JavaScript's `<` compares UTF-16 code units. */
function byCodePoint(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0) as number);
  const right = Array.from(b, (c) => c.codePointAt(0) as number);
  for (let at = 0; at < Math.min(left.length, right.length); at++)
    if (left[at] !== right[at])
      return (left[at] as number) - (right[at] as number);
  return left.length - right.length;
}

/**
 * The ids that scope a C-CDA document's records: its custodian's `id` that names its organization record, as
 * cascade-vocabulary's RecordFromCcdaNamingRule says, and its one patient's first; null where its custodian has no `id`
 * that names an organization, or the document states not exactly one patient with an id, so that its records are named
 * by the document; undefined where the file is no C-CDA document.
 */
export function scopesOf(
  bytes: Uint8Array,
): { readonly custodian: CdaId; readonly patient: CdaId } | null | undefined {
  const header = headerOf(bytes);
  if (header === undefined) return undefined;
  const { custodianIds, patientId: patient, patients } = header;
  const custodian = custodianIds
    .map(organizationIdOf)
    .filter((picked) => picked !== undefined)
    .sort((a, b) => byCodePoint(a.key, b.key))[0]?.id;
  return custodian === undefined || patient === undefined || patients !== 1
    ? null
    : { custodian, patient };
}

/**
 * The header of the file's `ClinicalDocument`, or undefined where its document element is another, read no further
 * than that element; it throws where a CDA is not well-formed XML.
 */
function headerOf(bytes: Uint8Array): Header | undefined {
  const header: Header = { custodianIds: [], patients: 0, sections: [] };
  const path: string[] = [];
  let section: Section | undefined;
  let capture: { depth: number; text: string } | undefined;
  const parser = new SaxesParser({ xmlns: true });
  /** Whether the element just opened is the one `last` names in `parent`, or `parent` itself. */
  const at = (parent: readonly string[], last?: string): boolean =>
    path.length === parent.length + (last === undefined ? 0 : 1) &&
    (last === undefined || path[parent.length] === last) &&
    parent.every((name, index) => path[index] === name);
  parser.on("opentag", (tag: SaxesTagNS) => {
    if (
      path.length === 0 &&
      (tag.local !== "ClinicalDocument" || tag.uri !== HL7)
    )
      throw OTHER;
    path.push(tag.uri === HL7 ? tag.local : `{${tag.uri}}${tag.local}`);
    if (path.length > SECTION.length + 1) return;
    if (
      at(HEADER, "templateId") &&
      tag.attributes.root?.value === US_REALM_HEADER
    )
      header.version ??= tag.attributes.extension?.value;
    else if (at(HEADER, "effectiveTime"))
      header.effectiveTime = tag.attributes.value?.value;
    else if (at(CUSTODIAN, "id")) {
      const id = idOf(tag);
      if (id !== undefined) header.custodianIds.push(id);
    } else if (at(PATIENT)) header.patients++;
    else if (at(PATIENT, "id") && header.patients === 1)
      header.patientId ??= idOf(tag);
    else if (at(CUSTODIAN, "name") || at(SECTION, "title"))
      capture = { depth: path.length, text: "" };
    else if (at(SECTION)) {
      section = { entries: 0 };
      header.sections.push(section);
    } else if (section !== undefined && at(SECTION, "entry")) section.entries++;
  });
  parser.on("text", (value) => {
    if (capture !== undefined) capture.text += value;
  });
  parser.on("closetag", () => {
    if (capture !== undefined && capture.depth === path.length) {
      const said = capture.text.replace(/\s+/g, " ").trim();
      if (path.at(-1) === "title" && section !== undefined)
        section.title = said;
      else header.custodian = said;
      capture = undefined;
    }
    if (path.pop() === "section" && path.length === 4) section = undefined;
  });
  const decoder = new TextDecoder();
  try {
    for (let from = 0; from < bytes.length; from += SLICE)
      parser.write(
        decoder.decode(bytes.subarray(from, from + SLICE), { stream: true }),
      );
    parser.write(decoder.decode()).close();
  } catch (error) {
    if (error === OTHER) return undefined;
    throw error;
  }
  return header;
}

/** Whether the bytes are a well-formed CDA ClinicalDocument whose header this importer reads, as the Bridge must. */
export function isCdaDocument(bytes: Uint8Array): boolean {
  try {
    return headerOf(bytes) !== undefined;
  } catch {
    return false;
  }
}

/**
 * A CDA time, `YYYYMMDD[hh[mm[ss[.f]]]][±hhmm]`, as an `xsd:dateTime` in UTC where it states an hour and its offset, or
 * else as the `xsd:date` it falls on; undefined where it is no such time or names no such day.
 */
export function received(time: string): string | undefined {
  const parts =
    /^(\d{4})(\d\d)(\d\d)(?:(\d\d)(?:(\d\d)(?:(\d\d)(?:\.\d+)?)?)?)?(?:([+-]\d\d)(\d\d))?$/.exec(
      time,
    );
  if (parts === null) return undefined;
  const field = (index: number): number => Number(parts[index] ?? 0);
  const [year, month, day, hour, minute, second, offsetMinutes] = [
    1, 2, 3, 4, 5, 6, 8,
  ].map(field) as [number, number, number, number, number, number, number];
  const offsetHours = parts[7];
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(local);
  if (
    date.getUTCDate() !== day ||
    date.getUTCMonth() !== month - 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return undefined;
  if (parts[4] === undefined || offsetHours === undefined)
    return date.toISOString().slice(0, 10);
  const offset =
    (offsetHours.startsWith("-") ? -1 : 1) *
    (Math.abs(Number(offsetHours)) * 60 + offsetMinutes);
  return `${new Date(local - offset * 60000).toISOString().slice(0, 19)}Z`;
}

function quoted(text: string): string {
  return `"${text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

/** What the header says of the document and of its import, as Turtle, for the Bridge to state. */
function facts(header: Header, importStarted: string): Uint8Array {
  const thisImport = `<${BRIDGE}thisImport>`;
  const lines = [
    `${thisImport} <${RDFS}label> "C-CDA download" .`,
    `${thisImport} <${PROV}startedAtTime> "${importStarted}"^^<${XSD}dateTime> .`,
  ];
  if (header.version !== undefined)
    lines.push(
      `<${BRIDGE}thisDocument> <${CASCADE}sourceFormatVersion> ${quoted(header.version)} .`,
    );
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

async function read(
  files: DownloadFiles,
  path: string,
): Promise<{ bytes: Uint8Array; header: Header } | undefined> {
  if (!path.toLowerCase().endsWith(".xml")) return undefined;
  const bytes = await files.read(path);
  const header = bytes === undefined ? undefined : headerOf(bytes);
  return bytes === undefined || header === undefined
    ? undefined
    : { bytes, header };
}

/** The importer of a downloaded CDA file, which it hands on whole as one document, with what its header says. */
export const ccdaDownload = {
  name: "ccda-download",

  async documents(
    files: DownloadFiles,
    path: string,
  ): Promise<CcdaDocument[] | undefined> {
    const found = await read(files, path);
    if (found === undefined) return undefined;
    const { bytes, header } = found;
    return [
      {
        path,
        bytes,
        mediaType: "application/cda+xml",
        facts: (importStarted) => facts(header, importStarted),
      },
    ];
  },

  /** An entry for each entry of each section of the body: the look counts entries per section, not records per kind. */
  async index(
    files: DownloadFiles,
    path: string,
  ): Promise<CcdaIndexEntry[] | undefined> {
    const found = await read(files, path);
    if (found === undefined) return undefined;
    const { custodian, effectiveTime, sections } = found.header;
    const when =
      effectiveTime === undefined ? undefined : received(effectiveTime);
    return sections.flatMap(({ title, entries }) =>
      Array.from({ length: entries }, () => ({
        ...(custodian === undefined || custodian === ""
          ? {}
          : { source: custodian }),
        ...(title === undefined || title === "" ? {} : { section: title }),
        ...(when === undefined ? {} : { received: when }),
      })),
    );
  },
};
