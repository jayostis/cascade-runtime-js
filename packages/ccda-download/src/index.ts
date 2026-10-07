import { SaxesParser } from "saxes";

const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const HL7 = "urn:hl7-org:v3";
const SLICE = 1 << 24;

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

/** Whether the file's document element is a CDA `ClinicalDocument`; it throws where the file is not well-formed XML. */
function clinicalDocument(bytes: Uint8Array): boolean {
  let root: { local: string; uri: string } | undefined;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    root ??= { local: tag.local, uri: tag.uri };
  });
  const decoder = new TextDecoder();
  for (let at = 0; at < bytes.length; at += SLICE)
    parser.write(
      decoder.decode(bytes.subarray(at, at + SLICE), { stream: true }),
    );
  parser.write(decoder.decode()).close();
  return root?.local === "ClinicalDocument" && root.uri === HL7;
}

function facts(importStarted: string): Uint8Array {
  const thisImport = `<${BRIDGE}thisImport>`;
  return new TextEncoder().encode(
    [
      `${thisImport} <${RDFS}label> "C-CDA download" .`,
      `${thisImport} <${PROV}startedAtTime> "${importStarted}"^^<${XSD}dateTime> .`,
      "",
    ].join("\n"),
  );
}

async function read(
  files: DownloadFiles,
  path: string,
): Promise<Uint8Array | undefined> {
  if (!path.toLowerCase().endsWith(".xml")) return undefined;
  const bytes = await files.read(path);
  return bytes !== undefined && clinicalDocument(bytes) ? bytes : undefined;
}

/** The importer of a downloaded CDA file, which it hands on whole as one document. */
export const ccdaDownload = {
  name: "ccda-download",

  async documents(
    files: DownloadFiles,
    path: string,
  ): Promise<CcdaDocument[] | undefined> {
    const bytes = await read(files, path);
    return bytes === undefined
      ? undefined
      : [
          {
            path,
            bytes,
            mediaType: "application/cda+xml",
            facts,
          },
        ];
  },

  async index(
    files: DownloadFiles,
    path: string,
  ): Promise<readonly never[] | undefined> {
    return (await read(files, path)) === undefined ? undefined : [];
  },
};
