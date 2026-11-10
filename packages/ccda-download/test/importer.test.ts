import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import {
  ccdaDownload,
  dateOrUtcTimeOf,
  type DownloadFiles,
  isCdaDocument,
  scopesOf,
} from "../src/index.js";

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

const PREFIXES = `PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
  PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
  PREFIX prov: <http://www.w3.org/ns/prov#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;

const bytes = (xml: string): Uint8Array => new TextEncoder().encode(xml);

const cdaWith = (patients: string, custodianIds: string): Uint8Array =>
  bytes(`<ClinicalDocument xmlns="urn:hl7-org:v3">
  ${patients}
  <custodian><assignedCustodian><representedCustodianOrganization>${custodianIds}</representedCustodianOrganization></assignedCustodian></custodian>
</ClinicalDocument>`);
const patient = (ids: string): string =>
  `<recordTarget><patientRole>${ids}</patientRole></recordTarget>`;
const one = patient(
  '<id root="2.16.1" extension="P-7"/><id root="2.16.2" extension="other"/>',
);

/**
 * A download is what a person saves from a patient portal: one C-CDA file. `documents` hands it on whole, once it is
 * sure it is one, and leaves any other file to another importer; a file that claims to be one and is not well-formed is
 * refused, not skipped.
 * @rule runtime/arrivals.feature A14
 */
describe("Recognising a downloaded C-CDA document · ccdaDownload.documents(), isCdaDocument()", () => {
  describe("documents(files, path)", () => {
    it("returns the file as one document of media type `application/cda+xml`", async () => {
      for (const path of ["summary.xml", "SUMMARY.XML"]) {
        const documents = (await ccdaDownload.documents(download, path)) ?? [];
        assert.deepEqual(
          documents.map(({ path: found, mediaType }) => [found, mediaType]),
          [[path, "application/cda+xml"]],
          path,
        );
      }
    });

    it("returns undefined for XML whose root element is not HL7's `ClinicalDocument`", async () => {
      for (const path of [
        "no-namespace.xml",
        "other.xml",
        "other-unfinished.xml",
      ])
        assert.equal(
          await ccdaDownload.documents(download, path),
          undefined,
          path,
        );
    });

    it("returns undefined for a file whose name does not end in `.xml`, and for no file", async () => {
      for (const path of ["summary.txt", "absent.xml"])
        assert.equal(
          await ccdaDownload.documents(download, path),
          undefined,
          path,
        );
    });

    it("rejects for a `ClinicalDocument` that is not well-formed XML", async () => {
      await assert.rejects(
        ccdaDownload.documents(download, "broken.xml"),
        /unclosed tag/,
      );
    });
  });

  describe("isCdaDocument(bytes)", () => {
    const head = bytes('<ClinicalDocument xmlns="urn:hl7-org:v3"><title>');
    const tail = bytes("</title></ClinicalDocument>");

    it("returns true for a well-formed `ClinicalDocument`", () => {
      assert.equal(isCdaDocument(new Uint8Array([...head, ...tail])), true);
    });

    it("returns false for one that holds a byte that is not UTF-8", () => {
      assert.equal(
        isCdaDocument(new Uint8Array([...head, 0xff, 0xfe, ...tail])),
        false,
      );
    });
  });
});

/**
 * The importer says of a download only what its header states: that the import is a "C-CDA download", when it started,
 * and which version of C-CDA the header names. Who wrote the document is the adapter's to read from the document, not
 * the importer's to say, so no author is stated here.
 * @rule runtime/arrivals.feature A11
 */
describe("Saying what a C-CDA document's header states · CcdaDocument.facts()", () => {
  describe("facts(importStarted)", () => {
    let store: oxigraph.Store;

    before(async () => {
      const [first] =
        (await ccdaDownload.documents(download, "kestrel.xml")) ?? [];
      store = new oxigraph.Store();
      store.load(first?.facts("2026-01-02T10:00:00Z") ?? "", {
        format: "text/turtle",
      });
    });

    it('states the import\'s label, "C-CDA download", and the time it started', () => {
      assert.equal(
        store.query(`${PREFIXES}
          ASK { bridge:thisImport rdfs:label "C-CDA download" ; prov:startedAtTime "2026-01-02T10:00:00Z"^^xsd:dateTime }`),
        true,
      );
    });

    it("states the version of C-CDA that the header names", () => {
      assert.equal(
        store.query(`${PREFIXES}
          ASK { bridge:thisDocument cascade:sourceFormatVersion "2015-08-01" }`),
        true,
      );
    });

    it("states nothing else", () => {
      assert.equal(store.size, 3);
    });
  });
});

/**
 * `index` is the look at a download: what `pod.look()` counts to show a person what an import would bring. It counts
 * each `entry` element once and names its source as the document's custodian.
 */
describe("Listing a C-CDA document's entries before an import · ccdaDownload.index(), dateOrUtcTimeOf()", () => {
  describe("index(files, path)", () => {
    let entries: NonNullable<Awaited<ReturnType<typeof ccdaDownload.index>>>;

    before(async () => {
      entries = (await ccdaDownload.index(download, "kestrel.xml")) ?? [];
    });

    it("returns one index entry for each `entry` element of each section", () => {
      assert.deepEqual(
        entries.map(({ section }) => section),
        [
          "Allergies and Intolerances",
          "Allergies and Intolerances",
          "Medications",
          "Social History",
        ],
      );
    });

    it("counts once an `entry` element that holds another", () => {
      assert.equal(
        entries.filter(({ section }) => section === "Medications").length,
        1,
      );
    });

    it("gives the custodian's name, not the author's, with its white space collapsed", () => {
      assert.deepEqual(
        entries.map(({ source }) => source),
        Array(4).fill("Kestrel Harbor Hospital"),
      );
    });

    it("gives a section's title whole when an element breaks it", () => {
      assert.equal(entries[0]?.section, "Allergies and Intolerances");
    });

    it("gives the document's time as `dateOrUtcTimeOf(cdaTime)` returns it", () => {
      assert.deepEqual(
        entries.map(({ received }) => received),
        Array(4).fill("2025-04-03T12:30:00Z"),
      );
    });

    it("returns no index entry for a document with no section", async () => {
      for (const path of ["summary.xml", "SUMMARY.XML"])
        assert.deepEqual(await ccdaDownload.index(download, path), [], path);
    });

    it("returns undefined for a file `documents()` returns undefined for", async () => {
      for (const path of [
        "no-namespace.xml",
        "other.xml",
        "other-unfinished.xml",
        "summary.txt",
        "absent.xml",
      ])
        assert.equal(await ccdaDownload.index(download, path), undefined, path);
    });

    it("rejects for a `ClinicalDocument` that is not well-formed XML", async () => {
      await assert.rejects(
        ccdaDownload.index(download, "broken.xml"),
        /unclosed tag/,
      );
    });
  });

  describe("dateOrUtcTimeOf(cdaTime)", () => {
    it("returns a time in UTC for a CDA time with an hour and an offset", () => {
      for (const [time, when] of [
        ["20250403083000-0400", "2025-04-03T12:30:00Z"],
        ["2025040308+0530", "2025-04-03T02:30:00Z"],
        ["20250403235959.123-0001", "2025-04-04T00:00:59Z"],
      ] as const)
        assert.equal(dateOrUtcTimeOf(time), when, time);
    });

    it("returns the date for a CDA time with no hour, or no offset", () => {
      for (const [time, when] of [
        ["202504030830", "2025-04-03"],
        ["20250403", "2025-04-03"],
        ["20240229", "2024-02-29"],
      ] as const)
        assert.equal(dateOrUtcTimeOf(time), when, time);
    });

    it("returns undefined for a day or an hour that does not exist", () => {
      for (const time of ["20250229", "20251399", "20250403250000+0000"])
        assert.equal(dateOrUtcTimeOf(time), undefined, time);
    });

    it("returns undefined for a time that is not in CDA's form", () => {
      assert.equal(dateOrUtcTimeOf("2025-04-03"), undefined);
    });
  });
});

/**
 * A record from a C-CDA document is named under a scope: an id of the document's custodian and an id of its patient,
 * so that the same record in two downloads gets one name. `scopesOf` reads the scope from the header.
 * @rule runtime/naming.feature N1
 */
describe("Finding whose records a C-CDA document holds · scopesOf()", () => {
  describe("scopesOf(bytes)", () => {
    let flavoured: ReturnType<typeof scopesOf>;

    before(() => {
      flavoured = scopesOf(
        cdaWith(
          one,
          '<id nullFlavor="UNK" root="2.16.8" extension="flavoured"/><id root="2.16.9" extension=""/>',
        ),
      );
    });

    it("returns the custodian's id and the first id of the patient", () => {
      assert.deepEqual(flavoured?.patient, {
        root: "2.16.1",
        extension: "P-7",
      });
    });

    it("skips a custodian id that has a `nullFlavor`, and drops an empty extension", () => {
      assert.deepEqual(flavoured?.custodian, { root: "2.16.9" });
    });

    it("picks the custodian's NPI where it has one", () => {
      assert.deepEqual(
        scopesOf(
          cdaWith(
            one,
            '<id root="2.16.4"/><id root="2.16.840.1.113883.4.6" extension="1234567893"/>',
          ),
        )?.custodian,
        { root: "2.16.840.1.113883.4.6", extension: "1234567893" },
      );
    });

    it("picks, with no NPI, the id that sorts first by type and value, however they are ordered", () => {
      for (const ids of [
        '<id root="Riverside" extension="77"/><id root="2.16.5" extension="RCH-1"/><id root="2.16.4"/>',
        '<id root="2.16.4"/><id root="2.16.5" extension="RCH-1"/><id root="Riverside" extension="77"/>',
      ])
        assert.deepEqual(
          scopesOf(cdaWith(one, ids))?.custodian,
          { root: "2.16.4" },
          ids,
        );
    });

    it("writes a UUID root in lower case", () => {
      assert.deepEqual(
        scopesOf(
          cdaWith(
            one,
            '<id root="2.16.840.1.113883.4.6"/><id root="0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D" extension="X"/>',
          ),
        )?.custodian,
        { root: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", extension: "X" },
      );
    });

    it("returns null for a custodian with no id that names an organization", () => {
      for (const [stated, file] of [
        ["no custodian id", cdaWith(one, "")],
        ["a nullFlavor custodian id", cdaWith(one, '<id nullFlavor="NI"/>')],
        [
          "custodian ids naming no organization",
          cdaWith(
            one,
            '<id root="Riverside" extension="77"/><id root="2.16.840.1.113883.4.6"/>',
          ),
        ],
      ] as const)
        assert.equal(scopesOf(file), null, stated);
    });

    it("returns null for a document that does not state exactly one patient with an id", () => {
      for (const [stated, file] of [
        [
          "two recordTargets",
          cdaWith(
            `${one}${patient('<id root="2.16.3"/>')}`,
            '<id root="2.16.9"/>',
          ),
        ],
        ["no patient id", cdaWith(patient(""), '<id root="2.16.9"/>')],
        ["neither", bytes(CDA)],
      ] as const)
        assert.equal(scopesOf(file), null, stated);
    });

    it("returns undefined for a file that is no CDA document", () => {
      assert.equal(scopesOf(bytes("<Bundle/>")), undefined);
    });
  });
});
