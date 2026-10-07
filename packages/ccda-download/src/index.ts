import { SaxesParser, type SaxesTagNS } from "saxes";

const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const HL7 = "urn:hl7-org:v3";
const SLICE = 1 << 24;
const US_REALM_HEADER = "2.16.840.1.113883.10.20.22.1.1";
const SECTIONS = "2.16.840.1.113883.10.20.22.2.";

/** The word `rec:kind` gives the records of each section the adapter maps, by the section's template, `.1` or not. */
const KINDS: ReadonlyMap<string, string> = new Map([
  ["6", "Allergy"],
  ["5", "Condition"],
  ["2", "Immunization"],
  ["7", "Procedure"],
  ["1", "Medication"],
  ["3", "Lab result"],
]);

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
  readonly kind?: string;
  readonly section?: string;
  readonly received?: string;
}

interface Section {
  title?: string;
  kind?: string;
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

/** The kind a section's template names, if the adapter maps it. */
function kindOf(templateRoot: string): string | undefined {
  const match = /^(\d+)(?:\.1)?$/.exec(
    templateRoot.startsWith(SECTIONS)
      ? templateRoot.slice(SECTIONS.length)
      : "",
  );
  return match === null ? undefined : KINDS.get(match[1] ?? "");
}

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
  const at = (...names: string[]): boolean =>
    path.length === names.length &&
    names.every((name, index) => path[index] === name);
  parser.on("opentag", (tag: SaxesTagNS) => {
    if (
      path.length === 0 &&
      (tag.local !== "ClinicalDocument" || tag.uri !== HL7)
    )
      throw OTHER;
    path.push(tag.uri === HL7 ? tag.local : `{${tag.uri}}${tag.local}`);
    const attribute = (name: string): string | undefined =>
      tag.attributes[name]?.value;
    const body = [
      "ClinicalDocument",
      "component",
      "structuredBody",
      "component",
      "section",
    ];
    if (
      at("ClinicalDocument", "templateId") &&
      attribute("root") === US_REALM_HEADER
    )
      header.version ??= attribute("extension");
    else if (at("ClinicalDocument", "effectiveTime"))
      header.effectiveTime = attribute("value");
    else if (
      at(
        "ClinicalDocument",
        "custodian",
        "assignedCustodian",
        "representedCustodianOrganization",
        "name",
      ) ||
      (section !== undefined && at(...body, "title"))
    )
      capture = { depth: path.length, text: "" };
    else if (at(...body)) {
      section = { entries: 0 };
      header.sections.push(section);
    } else if (section !== undefined && at(...body, "templateId"))
      section.kind ??= kindOf(attribute("root") ?? "");
    else if (section !== undefined && at(...body, "entry")) section.entries++;
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
 * A CDA time, `YYYYMMDD[hhmm[ss[.f]]][±hhmm]`, as an `xsd:dateTime` in UTC where it states its offset, or else as the
 * `xsd:date` it falls on.
 */
function received(time: string): string | undefined {
  const parts =
    /^(\d{4})(\d\d)(\d\d)(?:(\d\d)(\d\d)(?:(\d\d)(?:\.\d+)?)?)?([+-]\d\d)?(\d\d)?$/.exec(
      time,
    );
  if (parts === null) return undefined;
  const [, year, month, day, hour, minute, second, offsetHours, offsetMinutes] =
    parts;
  const date = `${year}-${month}-${day}`;
  if (hour === undefined || offsetHours === undefined) return date;
  const moment = new Date(
    `${date}T${hour}:${minute}:${second ?? "00"}${offsetHours}:${offsetMinutes ?? "00"}`,
  );
  return Number.isNaN(moment.getTime())
    ? undefined
    : `${moment.toISOString().slice(0, 19)}Z`;
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

  /** An entry for each entry of each section of the body. */
  async index(
    files: DownloadFiles,
    path: string,
  ): Promise<CcdaIndexEntry[] | undefined> {
    const found = await read(files, path);
    if (found === undefined) return undefined;
    const { custodian, effectiveTime, sections } = found.header;
    const when =
      effectiveTime === undefined ? undefined : received(effectiveTime);
    return sections.flatMap(({ title, kind, entries }) =>
      Array.from({ length: entries }, () => ({
        ...(custodian === undefined || custodian === ""
          ? {}
          : { source: custodian }),
        ...(kind === undefined ? {} : { kind }),
        ...(title === undefined || title === "" ? {} : { section: title }),
        ...(when === undefined ? {} : { received: when }),
      })),
    );
  },
};
