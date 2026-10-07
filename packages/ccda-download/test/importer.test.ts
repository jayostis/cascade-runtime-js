import assert from "node:assert/strict";
import { test } from "node:test";
import * as oxigraph from "oxigraph";
import { ccdaDownload, type DownloadFiles } from "../src/index.js";

const CDA = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3"><templateId root="2.16.840.1.113883.10.20.22.1.1"/></ClinicalDocument>`;

const files: Record<string, string> = {
  "summary.xml": CDA,
  "SUMMARY.XML": CDA,
  "no-namespace.xml": "<ClinicalDocument/>",
  "other.xml": '<HealthData locale="en_US"/>',
  "summary.txt": CDA,
  "broken.xml": '<ClinicalDocument xmlns="urn:hl7-org:v3"><id>',
};
const download: DownloadFiles = {
  read: (path) =>
    Promise.resolve(
      path in files ? new TextEncoder().encode(files[path]) : undefined,
    ),
};

test("a downloaded CDA file is one document of its own media type, and nothing else is read", async () => {
  for (const path of ["summary.xml", "SUMMARY.XML"]) {
    const documents = (await ccdaDownload.documents(download, path)) ?? [];
    assert.deepEqual(
      documents.map(({ path: found, mediaType }) => [found, mediaType]),
      [[path, "application/cda+xml"]],
    );
    assert.deepEqual(await ccdaDownload.index(download, path), []);
  }
  for (const path of [
    "no-namespace.xml",
    "other.xml",
    "summary.txt",
    "absent.xml",
  ]) {
    assert.equal(await ccdaDownload.documents(download, path), undefined);
    assert.equal(await ccdaDownload.index(download, path), undefined);
  }
  await assert.rejects(ccdaDownload.documents(download, "broken.xml"));
});

test("a download's facts are its import's label and start", async () => {
  const [document] =
    (await ccdaDownload.documents(download, "summary.xml")) ?? [];
  const store = new oxigraph.Store();
  store.load(document?.facts("2026-01-02T10:00:00Z") ?? "", {
    format: "text/turtle",
  });
  assert.equal(
    store.query(`PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
      PREFIX prov: <http://www.w3.org/ns/prov#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
      ASK { bridge:thisImport rdfs:label "C-CDA download" ; prov:startedAtTime "2026-01-02T10:00:00Z"^^xsd:dateTime }`),
    true,
  );
  assert.equal(store.size, 2);
});
