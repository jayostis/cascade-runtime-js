import assert from "node:assert/strict";
import { test } from "node:test";
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

test("an adapter is given the files its description lists, and each file a call finds missing is fetched and the adapter loaded again", async () => {
  const vocabulary = new MemoryFiles("https://vocabulary.example/tree/a/");
  for (const path of ["core.ttl", "records.ttl", "health.ttl"])
    await vocabulary.write(path, bytes(path));
  const asked: (string | undefined)[] = [];
  const loads: Given[] = [];

  const { adapter } = await loadAdapter(
    bridge(loads),
    { iri: "https://adapter.example/tree/c/", files: await adapterFiles() },
    (repository) => {
      asked.push(repository);
      return Promise.resolve({ iri: vocabulary.iri, files: vocabulary });
    },
  );
  assert.deepEqual(loads, [], "an adapter loaded before a call needed it");
  await adapter.convert({ iri: "urn:document", bytes: bytes("{}") });

  assert.deepEqual(asked, [REPOSITORY]);
  assert.deepEqual(loads, [
    [["in/detect.rq", "ro-crate-metadata.json"], ["core.ttl"]],
    [
      ["in/detect.rq", "ro-crate-metadata.json", "schema/imported.xsd"],
      ["core.ttl"],
    ],
    [
      ["in/detect.rq", "ro-crate-metadata.json", "schema/imported.xsd"],
      ["core.ttl", "records.ttl"],
    ],
  ]);
});

test("an adapter whose every file is at hand is given them all, without git's", async () => {
  const loads: Given[] = [];
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
  assert.deepEqual(
    loads.map(([adapter]) => adapter),
    [
      [
        "docs/format.md",
        "in/detect.rq",
        "ro-crate-metadata.json",
        "schema/imported.xsd",
      ],
    ],
  );
});

test("a media type's adapters are those whose description declares it, by its essence, in their order", () => {
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
  assert.deepEqual(of("application/cda+xml; charset=utf-8"), [cda, otherCda]);
  assert.deepEqual(of("application/fhir+json"), [fhir]);
  assert.deepEqual(of("text/plain"), []);
});
