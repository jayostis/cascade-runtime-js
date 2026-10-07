import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  ExportedFiles,
  type Files,
  folderOf,
  MemoryFiles,
} from "../src/files.js";
import { FolderFiles } from "../src/node/folder-files.js";

const POD = "https://pod.example/";
const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes && new TextDecoder().decode(bytes);

test("a folder and memory read, write and list alike, by path or by IRI, and only under their root, a file read as a folder and a folder as a file being nothing", async () => {
  const kinds: [string, Files][] = [
    ["memory", new MemoryFiles(POD)],
    ["folder", new FolderFiles(await mkdtemp(join(tmpdir(), "files-")), POD)],
  ];
  for (const [kind, files] of kinds) {
    await files.write("subject/7c/a.ttl", new TextEncoder().encode("a"));
    await files.write(`${POD}records/b.ttl`, new TextEncoder().encode("b"));
    assert.equal(text(await files.read(`${POD}subject/7c/a.ttl`)), "a", kind);
    assert.equal(text(await files.read("records/b.ttl")), "b", kind);
    for (const nothing of [
      "records/none.ttl",
      "records/b.ttl/export.xml",
      "records",
    ])
      assert.equal(await files.read(nothing), undefined, `${kind} ${nothing}`);
    assert.deepEqual(await files.list("records/b.ttl"), [], kind);
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
  assert.deepEqual(
    ["runtime/vectors/arrivals/story.json", "story.json"].map(folderOf),
    ["runtime/vectors/arrivals", ""],
  );
});

test("the bytes an app holds are read as a copy, whether a Buffer or a Uint8Array of another realm", async () => {
  const held: [string, Uint8Array][] = [
    ["a/buffer.xml", Buffer.from("abc")],
    ["a/realm.xml", runInNewContext("new Uint8Array([97, 98, 99])")],
  ];
  const files = new ExportedFiles(new Map(held), "a");
  for (const [path, bytes] of held) {
    const read = await files.read(path);
    assert.equal(text(read), "abc", path);
    read?.fill(0);
    assert.equal(text(bytes), "abc", path);
  }
});
