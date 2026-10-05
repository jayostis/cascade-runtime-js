import { SaxesParser } from "saxes";

const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const RECORDS = "clinical-records";
const ENVELOPE = "#envelope-resource";

/** The files an export is read from, by path. */
export interface ExportFiles {
  read(path: string): Promise<Uint8Array | undefined>;
  /** The path of every file under the folder, sorted. */
  list(folder: string): Promise<string[]>;
}

export interface AppleHealthDocument {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly envelope: string;
  facts(importStarted: string): Uint8Array;
}

type Entry = Readonly<Record<string, string>>;

function quoted(text: string): string {
  return `"${text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\n")
    .replaceAll("\r", "\r")}"`;
}

/** An Apple Health date, `YYYY-MM-DD hh:mm:ss ±hhmm`, as an `xsd:dateTime` in UTC. */
function utc(appleDate: string): string {
  const parts = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/.exec(
    appleDate,
  );
  const moment =
    parts === null
      ? undefined
      : new Date(`${parts[1]}T${parts[2]}${parts[3]}:${parts[4]}`);
  if (moment === undefined || Number.isNaN(moment.getTime()))
    throw new Error(`${appleDate} is not a date Apple Health writes`);
  return `${moment.toISOString().slice(0, 19)}Z`;
}

/** What export.xml says of each clinical record file, by its `resourceFilePath`. */
function clinicalRecords(exportXml: string): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const parser = new SaxesParser();
  parser.on("opentag", (tag) => {
    const path = tag.attributes.resourceFilePath;
    if (tag.name === "ClinicalRecord" && path !== undefined)
      entries.set(path, { ...tag.attributes });
  });
  parser.write(exportXml).close();
  return entries;
}

/** What the export says of one document and of its import, as Turtle, for the Bridge to state. */
function facts(entry: Entry | undefined, importStarted: string): Uint8Array {
  const document = `<${BRIDGE}thisDocument>`;
  const thisImport = `<${BRIDGE}thisImport>`;
  const dateTime = (value: string): string =>
    `${quoted(value)}^^<${XSD}dateTime>`;
  const lines = [
    `${thisImport} <${RDFS}label> ${quoted("Apple Health export")} .`,
    `${thisImport} <${PROV}startedAtTime> ${dateTime(importStarted)} .`,
  ];
  const attribution = (label: string, role: string, n: number): void => {
    lines.push(
      `${document} <${PROV}qualifiedAttribution> _:attribution${n} .`,
      `_:attribution${n} <${PROV}agent> _:agent${n} .`,
      `_:agent${n} <${RDFS}label> ${quoted(label)} .`,
      `_:attribution${n} <${PROV}hadRole> <${REC}${role}> .`,
    );
  };
  attribution("Apple Health", "transmitter", 0);
  if (entry !== undefined) {
    const sourceUrl = entry.sourceURL ?? "";
    attribution(entry.sourceName ?? "", "author", 1);
    lines.push(
      `${document} <${BRIDGE}serverBaseUrl> ${quoted(sourceUrl.split("/").slice(0, -2).join("/"))} .`,
      `${document} <${PAV}retrievedFrom> <${sourceUrl}> .`,
      `${document} <${PAV}retrievedOn> ${dateTime(utc(entry.receivedDate ?? ""))} .`,
      `${document} <${BRIDGE}sourceFormatVersion> ${quoted(entry.fhirVersion ?? "")} .`,
    );
  }
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

/** The importer of an Apple Health export: each clinical record file, with what export.xml says of it. */
export const appleHealthExport = {
  name: "apple-health-export",

  async documents(
    files: ExportFiles,
    folder: string,
  ): Promise<AppleHealthDocument[] | undefined> {
    const exportXml = await files.read(`${folder}/export.xml`);
    if (exportXml === undefined) return undefined;
    const entries = clinicalRecords(new TextDecoder().decode(exportXml));
    const prefix = `${folder}/${RECORDS}/`;
    const documents: AppleHealthDocument[] = [];
    for (const path of await files.list(`${folder}/${RECORDS}`)) {
      const name = path.slice(prefix.length);
      if (name.includes("/") || !name.endsWith(".json")) continue;
      const bytes = await files.read(path);
      if (bytes === undefined) continue;
      const entry = entries.get(`/${RECORDS}/${name}`);
      documents.push({
        path,
        bytes,
        envelope: ENVELOPE,
        facts: (importStarted) => facts(entry, importStarted),
      });
    }
    return documents;
  },
};
