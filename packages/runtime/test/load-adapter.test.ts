import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  type Bridge,
  BridgeError,
  type Description,
  type Named,
} from "../src/bridge.js";
import { MemoryFiles } from "../src/files.js";
import { type Loaded, loadAdapter, ofMediaType } from "../src/load-adapter.js";

const REPOSITORY = "https://vocabulary.example/repository";
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

type Given = [adapter: string[], vocabulary: string[]];

const keys = (named: Named | undefined): string[] =>
  [...(named?.files.keys() ?? [])].sort();

/** A Bridge that lists two files to load and one vocabulary file, and wants one more of each only when it runs. */
function bridge(loads: Given[]): Bridge {
  return {
    describe: (iri) =>
      Promise.resolve({
        graph: new Uint8Array(),
        iri,
        envelopes: [],
        loadFiles: ["ro-crate-metadata.json", "in/detect.rq"],
        crateFiles: [],
        vocabulary: { repository: REPOSITORY, files: ["core.ttl"] },
      } satisfies Description),
    load: (adapter, vocabulary) => {
      loads.push([keys(adapter), keys(vocabulary)]);
      if (!adapter.files.has("schema/imported.xsd"))
        throw new BridgeError(
          "missing",
          "imported.xsd",
          "adapter",
          "schema/imported.xsd",
        );
      return Promise.resolve({
        accepts: () => Promise.resolve(true),
        convert: () => {
          if (!vocabulary?.files.has("records.ttl"))
            throw new BridgeError(
              "missing",
              "records.ttl",
              "vocabulary",
              "records.ttl",
            );
          return Promise.resolve({
            graph: new Uint8Array(),
            findings: new Uint8Array(),
          });
        },
        free: () => Promise.resolve(),
      });
    },
  };
}

async function adapterFiles(): Promise<MemoryFiles> {
  const files = new MemoryFiles("https://adapter.example/tree/c/");
  for (const path of [
    "ro-crate-metadata.json",
    "in/detect.rq",
    "schema/imported.xsd",
    "docs/format.md",
    ".git/HEAD",
  ])
    await files.write(path, bytes(path));
  return files;
}

/**
 * An adapter is a folder of files the Bridge runs to convert one kind of document. `loadAdapter()` hands the Bridge
 * only the files the adapter's description lists and fetches another when the Bridge reports it missing, so a web page
 * downloads no more of an adapter or of the vocabulary than a conversion reads.
 */
describe("Loading an adapter into the Bridge · loadAdapter(), ofMediaType()", () => {
  describe("loadAdapter(bridge, adapter, vocabularyOf)", () => {
    const asked: (string | undefined)[] = [];
    const loads: Given[] = [];
    let loadedBeforeACall: Given[];

    before(async () => {
      const vocabulary = new MemoryFiles("https://vocabulary.example/tree/a/");
      for (const path of ["core.ttl", "records.ttl", "health.ttl"])
        await vocabulary.write(path, bytes(path));
      const { adapter } = await loadAdapter(
        bridge(loads),
        {
          iri: "https://adapter.example/tree/c/",
          files: await adapterFiles(),
        },
        (repository) => {
          asked.push(repository);
          return Promise.resolve({ iri: vocabulary.iri, files: vocabulary });
        },
      );
      loadedBeforeACall = [...loads];
      await adapter.convert({ iri: "urn:document", bytes: bytes("{}") });
    });

    it("loads nothing into the Bridge before a call needs the adapter", () => {
      assert.deepEqual(loadedBeforeACall, []);
    });

    it("hands the Bridge, at the first call, the files the description lists of the adapter and of the vocabulary", () => {
      assert.deepEqual(loads[0], [
        ["in/detect.rq", "ro-crate-metadata.json"],
        ["core.ttl"],
      ]);
    });

    it("loads again with a file of the adapter that the Bridge reported missing", () => {
      assert.deepEqual(loads[1], [
        ["in/detect.rq", "ro-crate-metadata.json", "schema/imported.xsd"],
        ["core.ttl"],
      ]);
    });

    it("loads again with a file of the vocabulary that a conversion reported missing, and then no more", () => {
      assert.deepEqual(loads.slice(2), [
        [
          ["in/detect.rq", "ro-crate-metadata.json", "schema/imported.xsd"],
          ["core.ttl", "records.ttl"],
        ],
      ]);
    });

    it("asks for the vocabulary once, by the repository the description names", () => {
      assert.deepEqual(asked, [REPOSITORY]);
    });
  });

  describe("given an adapter whose every file is at hand", () => {
    const loads: Given[] = [];

    before(async () => {
      const vocabulary = new MemoryFiles("https://vocabulary.example/tree/a/");
      await vocabulary.write("core.ttl", bytes("core"));
      const { adapter } = await loadAdapter(
        bridge(loads),
        {
          iri: "https://adapter.example/tree/c/",
          files: await adapterFiles(),
          whole: true,
        },
        () => Promise.resolve({ iri: vocabulary.iri, files: vocabulary }),
      );
      await adapter.accepts({ iri: "urn:document", bytes: bytes("{}") });
    });

    it("hands the Bridge every file of the adapter in one load, but none under `.git/`", () => {
      assert.equal(loads.length, 1);
      assert.deepEqual(loads[0]?.[0], [
        "docs/format.md",
        "in/detect.rq",
        "ro-crate-metadata.json",
        "schema/imported.xsd",
      ]);
    });
  });

  describe("ofMediaType(loaded)", () => {
    const adapter = (sourceMediaType: string): Loaded => ({
      description: {
        graph: new Uint8Array(),
        iri: `https://adapter.example/${sourceMediaType}/`,
        sourceMediaType,
        envelopes: [],
        loadFiles: [],
        crateFiles: [],
      },
      adapter: {
        accepts: () => Promise.resolve(true),
        convert: () => Promise.reject(new Error("unreached")),
        free: () => Promise.resolve(),
      },
    });
    const loaded = [
      "application/fhir+json",
      "application/cda+xml",
      "application/xml",
      "Application/CDA+XML",
    ].map(adapter);
    const of = ofMediaType(loaded);
    const [fhir, cda, , otherCda] = loaded.map(({ adapter }) => adapter);

    it("returns the adapters whose description declares the media type, in the order they were loaded", () => {
      assert.deepEqual(of("application/fhir+json"), [fhir]);
      assert.deepEqual(of("application/cda+xml"), [cda, otherCda]);
    });

    it("compares media types without their parameters and whatever their case", () => {
      assert.deepEqual(of("application/cda+xml; charset=utf-8"), [
        cda,
        otherCda,
      ]);
      assert.deepEqual(of("APPLICATION/cda+XML"), [cda, otherCda]);
    });

    it("returns none for a media type no adapter declares", () => {
      assert.deepEqual(of("text/plain"), []);
    });
  });
});
