import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Bridge,
  BridgeError,
  type Description,
  type Named,
} from "../src/bridge.js";
import { MemoryFiles } from "../src/files.js";
import { loadAdapter } from "../src/load-adapter.js";

const PIN = `https://vocabulary.example/repository/commit/${"a".repeat(40)}`;
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
        vocabulary: { pin: PIN, files: ["core.ttl"] },
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
  const pins: (string | undefined)[] = [];
  const loads: Given[] = [];

  const { adapter } = await loadAdapter(
    bridge(loads),
    { iri: "https://adapter.example/tree/c/", files: await adapterFiles() },
    (pin) => {
      pins.push(pin);
      return Promise.resolve({ iri: vocabulary.iri, files: vocabulary });
    },
  );
  await adapter.convert({ iri: "urn:document", bytes: bytes("{}") });

  assert.deepEqual(pins, [PIN]);
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
  await loadAdapter(
    bridge(loads),
    {
      iri: "https://adapter.example/tree/c/",
      files: await adapterFiles(),
      whole: true,
    },
    () => Promise.resolve({ iri: vocabulary.iri, files: vocabulary }),
  );
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
