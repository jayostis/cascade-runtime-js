import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Files, MemoryFiles } from "../src/files.js";
import { FolderFiles } from "../src/node/folder-files.js";

const POD = "https://pod.example/";
const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes && new TextDecoder().decode(bytes);

test("a folder and memory read, write and list alike, by path or by IRI, and only under their root", async () => {
  const kinds: [string, Files][] = [
    ["memory", new MemoryFiles(POD)],
    ["folder", new FolderFiles(await mkdtemp(join(tmpdir(), "files-")), POD)],
  ];
  for (const [kind, files] of kinds) {
    await files.write("subject/7c/a.ttl", new TextEncoder().encode("a"));
    await files.write(`${POD}records/b.ttl`, new TextEncoder().encode("b"));
    assert.equal(text(await files.read(`${POD}subject/7c/a.ttl`)), "a", kind);
    assert.equal(text(await files.read("records/b.ttl")), "b", kind);
    assert.equal(await files.read("records/none.ttl"), undefined, kind);
    assert.deepEqual(
      await files.list(""),
      ["records/b.ttl", "subject/7c/a.ttl"],
      kind,
    );
    assert.deepEqual(await files.list("subject"), ["subject/7c/a.ttl"], kind);
    assert.deepEqual(await files.list("nowhere"), [], kind);
    for (const outside of [
      "https://elsewhere.example/a.ttl",
      "../a.ttl",
      "/a.ttl",
    ]) {
      await assert.rejects(
        files.read(outside),
        /is not a path under/,
        `${kind} ${outside}`,
      );
    }
  }
});
