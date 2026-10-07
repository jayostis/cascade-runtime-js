import { SaxesParser, type SaxesTagNS } from "saxes";

const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const HL7 = "urn:hl7-org:v3";
const SLICE = 1 << 24;
const US_REALM_HEADER = "2.16.840.1.113883.10.20.22.1.1";
const HEADER = ["ClinicalDocument"];
const CUSTODIAN = [
  "ClinicalDocument",
  "custodian",
  "assignedCustodian",
  "representedCustodianOrganization",
];
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

/** What the header and the body's sections say. */
interface Header {
  version?: string;
  effectiveTime?: string;
  custodian?: string;
  readonly sections: Section[];
}

const OTHER = Symbol("another document element");

/**
 * The header of the file's `ClinicalDocument`, or undefined where its document element is another, read no further
 * than that element; it throws where a CDA is not well-formed XML.
 */
function headerOf(bytes: Uint8Array): Header | undefined {
  const header: Header = { sections: [] };
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
      `<${BRIDGE}thisDocument> <${BRIDGE}sourceFormatVersion> ${quoted(header.version)} .`,
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
