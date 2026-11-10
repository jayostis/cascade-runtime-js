import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import {
  appleHealthExport,
  type AppleHealthDocument,
  type ExportFiles,
} from "../src/index.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function folder(files: Record<string, string>): ExportFiles {
  return {
    read: (path) =>
      Promise.resolve(path in files ? bytes(files[path] ?? "") : undefined),
    list: (under) =>
      Promise.resolve(
        Object.keys(files)
          .filter((path) => path.startsWith(`${under}/`))
          .sort(),
      ),
  };
}

const PREFIXES = `PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
  PREFIX pav: <http://purl.org/pav/> PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;

/** An export that lists the peanut allergy and not the other record files it holds. */
const EXPORT = folder({
  "e/export.xml": `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [ <!ELEMENT HealthData (ClinicalRecord)*> ]>
<HealthData locale="en_US">
 <ClinicalRecord sourceName="Example Hospital" sourceURL="https://fhir.example.org/r4/AllergyIntolerance/peanut"
   fhirVersion="4.0.1" receivedDate="2026-01-02 11:00:00 +0100" resourceFilePath="/clinical-records/AllergyIntolerance-peanut.json"/>
</HealthData>`,
  "e/clinical-records/AllergyIntolerance-peanut.json": "{}",
  "e/clinical-records/Condition-unlisted.json": "[]",
  "e/clinical-records/notes.txt": "",
  "e/clinical-records/nested/Observation-x.json": "{}",
});

/** The attributes of a `ClinicalRecord` element as `export.xml` writes them; `attributes` replaces any of them. */
const record = (attributes: Record<string, string>): string =>
  Object.entries({
    sourceName: "Example Hospital",
    sourceURL: "https://fhir.example.org/r4/Condition/x",
    fhirVersion: "4.0.1",
    receivedDate: "2026-01-02 11:00:00 +0100",
    ...attributes,
  })
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");

/** The one document of an export that lists one record, written with the attributes `record` gives. */
async function onlyDocument(attributes: string): Promise<AppleHealthDocument> {
  const [document] =
    (await appleHealthExport.documents(
      folder({
        "e/export.xml": `<HealthData>
 <ClinicalRecord ${attributes} resourceFilePath="/clinical-records/Condition-x.json"/>
</HealthData>`,
        "e/clinical-records/Condition-x.json": "{}",
      }),
      "e",
    )) ?? [];
  assert.ok(document);
  return document;
}

function storeOf(document: AppleHealthDocument | undefined): oxigraph.Store {
  const store = new oxigraph.Store();
  store.load(document?.facts("2026-01-02T10:00:00Z") ?? "", {
    format: "text/turtle",
  });
  return store;
}

const ask = (store: oxigraph.Store, query: string): unknown =>
  store.query(`${PREFIXES}
      ${query}`);

const rows = (store: oxigraph.Store, query: string): number =>
  (ask(store, query) as unknown[]).length;

/**
 * An Apple Health export is a folder: `export.xml`, which lists the clinical records Apple Health received from
 * hospitals, and one FHIR resource in each file of `clinical-records/`. `documents` hands each of those files on as
 * a document, whether or not `export.xml` lists it, and refuses an `export.xml` it cannot read. `files` is what reads
 * the export's files, by path (`read(path)`, and `list(folder)` for the paths under a folder), and `folder` names the
 * export's folder in it.
 * @rule runtime/arrivals.feature A14
 */
describe("Finding the documents of an Apple Health export · appleHealthExport.documents()", () => {
  describe("documents(files, folder)", () => {
    it("returns undefined for a folder that holds no `export.xml`", async () => {
      assert.equal(
        await appleHealthExport.documents(EXPORT, "elsewhere"),
        undefined,
      );
    });

    it("returns each `.json` file directly under `clinical-records/`, listed in `export.xml` or not, as a document of media type `application/fhir+json`", async () => {
      const documents = (await appleHealthExport.documents(EXPORT, "e")) ?? [];
      assert.deepEqual(
        documents.map(({ path, mediaType, envelope }) => [
          path,
          mediaType,
          envelope,
        ]),
        [
          [
            "e/clinical-records/AllergyIntolerance-peanut.json",
            "application/fhir+json",
            "#envelope-resource",
          ],
          [
            "e/clinical-records/Condition-unlisted.json",
            "application/fhir+json",
            "#envelope-resource",
          ],
        ],
      );
    });

    it("leaves out a file that is not `.json` and a file in a folder below", async () => {
      const paths = (
        (await appleHealthExport.documents(EXPORT, "e")) ?? []
      ).map(({ path }) => path);
      assert.deepEqual(
        paths.filter(
          (path) => path.endsWith("notes.txt") || path.includes("nested/"),
        ),
        [],
      );
      assert.equal(paths.length, 2);
    });

    it("rejects for an `export.xml` that is not well-formed XML", async () => {
      await assert.rejects(
        appleHealthExport.documents(
          folder({ "e/export.xml": "<HealthData><Clin" }),
          "e",
        ),
        /unclosed tag/,
      );
    });
  });
});

/**
 * `facts` is what the importer states of one document: the import and the hospital that wrote the record, which
 * Apple Health only passed on. An import writes it beside the document, so a pod can say whose word a record is: the
 * hospital's, as its author, and not Apple Health's.
 * @rule runtime/arrivals.feature A21
 * @rule runtime/arrivals.feature A14
 */
describe("Saying where an Apple Health record came from · AppleHealthDocument.facts()", () => {
  describe("given a record that `export.xml` lists", () => {
    let store: oxigraph.Store;

    before(async () => {
      store = storeOf((await appleHealthExport.documents(EXPORT, "e"))?.[0]);
    });

    it('states the import\'s label, "Apple Health export", and the time it started', () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisImport rdfs:label "Apple Health export" ; prov:startedAtTime "2026-01-02T10:00:00Z"^^xsd:dateTime }`,
        ),
        true,
      );
    });

    it("states the URL the record was read from, its server's base URL, its FHIR version and, in UTC, when it was received", () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument pav:retrievedFrom <https://fhir.example.org/r4/AllergyIntolerance/peanut> ;
            pav:retrievedOn "2026-01-02T10:00:00Z"^^xsd:dateTime ;
            cascade:serverBaseUrl "https://fhir.example.org/r4" ; cascade:sourceFormatVersion "4.0.1" }`,
        ),
        true,
      );
    });

    it("names the hospital as the author, and attributes the document to it", () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument prov:wasAttributedTo ?author ;
            prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent ?author ; prov:hadRole cascade:AuthorRole ] ] .
            ?author rdfs:label "Example Hospital" }`,
        ),
        true,
      );
      assert.equal(
        rows(
          store,
          `SELECT ?agent WHERE { bridge:thisDocument prov:wasAttributedTo ?agent }`,
        ),
        1,
        "the document is attributed to its author alone",
      );
    });

    it("names Apple Health as the transmitter, and attributes nothing to it", () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument prov:wasGeneratedBy [ prov:qualifiedAssociation
            [ prov:agent [ rdfs:label "Apple Health" ] ; prov:hadRole cascade:TransmitterRole ] ] }`,
        ),
        true,
      );
      assert.equal(
        rows(
          store,
          `SELECT ?act WHERE { bridge:thisDocument prov:wasGeneratedBy ?act }`,
        ),
        1,
        "the author and the transmitter are on one act",
      );
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument prov:wasAttributedTo ?agent . ?agent rdfs:label "Apple Health" }`,
        ),
        false,
      );
    });

    it("keeps a line break in the hospital's name", async () => {
      const lined = storeOf(
        await onlyDocument(record({ sourceName: "Clinic&#10;North&#13;" })),
      );
      assert.equal(
        ask(lined, `ASK { ?agent rdfs:label "Clinic\\nNorth\\r" }`),
        true,
      );
    });
  });

  describe("given a record file that `export.xml` does not list", () => {
    let store: oxigraph.Store;

    before(async () => {
      store = storeOf((await appleHealthExport.documents(EXPORT, "e"))?.[1]);
    });

    it("names Apple Health as the transmitter, and no author", () => {
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument prov:wasGeneratedBy/prov:qualifiedAssociation/prov:hadRole ?role FILTER (?role != cascade:TransmitterRole) }`,
        ),
        false,
      );
      assert.equal(
        ask(
          store,
          `ASK { bridge:thisDocument prov:wasGeneratedBy/prov:qualifiedAssociation/prov:hadRole cascade:TransmitterRole }`,
        ),
        true,
      );
    });

    it("attributes the document to nobody", () => {
      assert.equal(
        ask(store, `ASK { bridge:thisDocument prov:wasAttributedTo ?agent }`),
        false,
      );
    });
  });

  describe("given a record whose attributes cannot be stated", () => {
    it("throws for a record with no `sourceName`, `sourceURL`, `fhirVersion` or `receivedDate`", async () => {
      for (const missing of [
        "sourceName",
        "sourceURL",
        "fhirVersion",
        "receivedDate",
      ]) {
        const document = await onlyDocument(
          record({}).replace(new RegExp(`${missing}="[^"]*" ?`), ""),
        );
        assert.throws(
          () => document.facts("2026-01-02T10:00:00Z"),
          new RegExp(`has no ${missing}`),
          missing,
        );
      }
    });

    it("throws for a `sourceURL` that is no IRI", async () => {
      const document = await onlyDocument(
        record({ sourceURL: "https://fhir.example.org/r4/Condition/x y" }),
      );
      assert.throws(
        () => document.facts("2026-01-02T10:00:00Z"),
        /is not an IRI/,
      );
    });

    it("throws for a `receivedDate` that is not as Apple Health writes dates", async () => {
      const document = await onlyDocument(
        record({ receivedDate: "yesterday" }),
      );
      assert.throws(
        () => document.facts("2026-01-02T10:00:00Z"),
        /is not a date Apple Health writes/,
      );
    });
  });
});

/**
 * `index` is the look at an export: what `pod.look()` counts to show a person what an import would bring. It reads the
 * records `export.xml` lists, and not the files they name.
 */
describe("Listing an Apple Health export's records before an import · appleHealthExport.index()", () => {
  const LISTED = folder({
    "e/export.xml": `<HealthData>
 <ClinicalRecord type="HKClinicalTypeIdentifierAllergyRecord" ${record({})} resourceFilePath="/clinical-records/a.json"/>
 <ClinicalRecord type="HKClinicalTypeIdentifierVitalSignRecord" ${record({})} resourceFilePath="/clinical-records/b.json"/>
 <ClinicalRecord resourceFilePath="/clinical-records/c.json"/>
</HealthData>`,
  });

  describe("index(files, folder)", () => {
    let entries: NonNullable<
      Awaited<ReturnType<typeof appleHealthExport.index>>
    >;

    before(async () => {
      entries = (await appleHealthExport.index(LISTED, "e")) ?? [];
    });

    it("returns undefined for a folder that holds no `export.xml`", async () => {
      assert.equal(await appleHealthExport.index(folder({}), "e"), undefined);
    });

    it("returns one index entry for each record, with its hospital's name, its server's base URL, its kind and, in UTC, when it was received", () => {
      assert.equal(entries.length, 3);
      assert.deepEqual(entries[0], {
        source: "Example Hospital",
        server: "https://fhir.example.org/r4",
        kind: "Allergy",
        received: "2026-01-02T10:00:00Z",
      });
    });

    it("gives Apple's own identifier as the kind of a type it has no word for", () => {
      assert.equal(entries[1]?.kind, "HKClinicalTypeIdentifierVitalSignRecord");
    });

    it("leaves out of an index entry what the record does not state", () => {
      assert.deepEqual(entries[2], {});
    });
  });
});
