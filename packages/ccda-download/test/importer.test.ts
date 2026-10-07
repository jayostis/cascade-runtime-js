import assert from "node:assert/strict";
import { test } from "node:test";
import * as oxigraph from "oxigraph";
import { ccdaDownload, type DownloadFiles } from "../src/index.js";

const CDA = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3"><templateId root="2.16.840.1.113883.10.20.22.1.1"/></ClinicalDocument>`;

const SUMMARY = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:sdtc="urn:hl7-org:sdtc">
  <templateId root="2.16.840.1.113883.10.20.22.1.1" extension="2015-08-01"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.2" extension="2015-08-01"/>
  <effectiveTime value="20250403083000-0400"/>
  <author><assignedAuthor><representedOrganization><name>Not the custodian</name></representedOrganization></assignedAuthor></author>
  <custodian><assignedCustodian><representedCustodianOrganization>
    <name>Kestrel  Harbor
      Hospital</name>
  </representedCustodianOrganization></assignedCustodian></custodian>
  <component><structuredBody>
    <component><section>
      <templateId root="2.16.840.1.113883.10.20.22.2.6.1" extension="2015-08-01"/>
      <title>Allergies <sdtc:x/>and Intolerances</title>
      <entry/><entry/>
    </section></component>
    <component><section>
      <templateId root="2.16.840.1.113883.10.20.22.2.1"/>
      <title>Medications</title>
      <entry><substanceAdministration><entryRelationship><entry/></entryRelationship></substanceAdministration></entry>
    </section></component>
    <component><section>
      <templateId root="2.16.840.1.113883.10.20.22.2.17" extension="2015-08-01"/>
      <title>Social History</title>
      <entry/>
    </section></component>
  </structuredBody></component>
</ClinicalDocument>`;

const files: Record<string, string> = {
  "summary.xml": CDA,
  "SUMMARY.XML": CDA,
  "kestrel.xml": SUMMARY,
  "no-namespace.xml": "<ClinicalDocument/>",
  "other.xml": '<HealthData locale="en_US"/>',
  "other-unfinished.xml": "<HealthData><Record>",
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
    "other-unfinished.xml",
    "summary.txt",
    "absent.xml",
  ]) {
    assert.equal(await ccdaDownload.documents(download, path), undefined);
    assert.equal(await ccdaDownload.index(download, path), undefined);
  }
  await assert.rejects(ccdaDownload.documents(download, "broken.xml"));
});

test("a download's index is each entry of each section, by its custodian, its section's kind and title, and the document's time", async () => {
  const allergy = {
    source: "Kestrel Harbor Hospital",
    kind: "Allergy",
    section: "Allergies and Intolerances",
    received: "2025-04-03T12:30:00Z",
  };
  assert.deepEqual(await ccdaDownload.index(download, "kestrel.xml"), [
    allergy,
    allergy,
    { ...allergy, kind: "Medication", section: "Medications" },
    {
      source: "Kestrel Harbor Hospital",
      section: "Social History",
      received: "2025-04-03T12:30:00Z",
    },
  ]);
});

test("a download's facts are its import's label and start and the header's version, and name no author", async () => {
  const [document] =
    (await ccdaDownload.documents(download, "kestrel.xml")) ?? [];
  const store = new oxigraph.Store();
  store.load(document?.facts("2026-01-02T10:00:00Z") ?? "", {
    format: "text/turtle",
  });
  assert.equal(
    store.query(`PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
      PREFIX prov: <http://www.w3.org/ns/prov#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
      ASK {
        bridge:thisImport rdfs:label "C-CDA download" ; prov:startedAtTime "2026-01-02T10:00:00Z"^^xsd:dateTime .
        bridge:thisDocument bridge:sourceFormatVersion "2015-08-01" .
      }`),
    true,
  );
  assert.equal(store.size, 3);
});
