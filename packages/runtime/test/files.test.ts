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
import {
  type FolderPack,
  packFolder,
  unpackFolder,
} from "../src/folder-pack.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { FetchedFiles } from "../src/web/fetched-files.js";

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

const COMPONENTS = "https://site.example/components/";
const PACKED_FILES = new Map([
  ["queries/a.rq", new TextEncoder().encode("SELECT * {}")],
  ["bom.ttl", new Uint8Array([0xef, 0xbb, 0xbf, 0x40])],
  ["schema/b.bin", new Uint8Array([0xff, 0x00, 0xc3])],
]);
const UNPACKED = "fixtures/c.json";

test("a folder's pack unpacks to the same bytes, text with a byte-order mark or not, and bytes that are no UTF-8", () => {
  const paths = [...PACKED_FILES.keys(), UNPACKED];
  const pack = packFolder(paths, PACKED_FILES);
  assert.deepEqual(Object.keys(pack.base64), ["schema/b.bin"]);
  assert.deepEqual(
    unpackFolder(JSON.parse(JSON.stringify(pack)) as FolderPack),
    PACKED_FILES,
  );
});

test("a fetched folder fetches each file once, reading its pack where it is served and the folder otherwise", async () => {
  const pack = packFolder([...PACKED_FILES.keys(), UNPACKED], PACKED_FILES);
  const served = new Map<string, string>([
    [`c/${UNPACKED}`, "{}"],
    ["c/queries/a.rq", "SELECT * {}"],
    ["c/files.json", JSON.stringify(["queries/a.rq", UNPACKED])],
  ]);
  const fetchedNow = globalThis.fetch;
  try {
    for (const packed of [true, false]) {
      const asked: string[] = [];
      if (packed) served.set("c.json", JSON.stringify(pack));
      else served.delete("c.json");
      globalThis.fetch = (url) => {
        const path = String(url instanceof Request ? url.url : url).slice(
          COMPONENTS.length,
        );
        asked.push(path);
        const body = served.get(path);
        return Promise.resolve(
          new Response(body ?? null, {
            status: body === undefined ? 404 : 200,
          }),
        );
      };
      const files = new FetchedFiles(`${COMPONENTS}c/`, undefined, {
        pack: `${COMPONENTS}c.json`,
      });
      for (let time = 0; time < 2; time += 1) {
        assert.equal(text(await files.read("queries/a.rq")), "SELECT * {}");
        assert.equal(text(await files.read(UNPACKED)), "{}");
        assert.equal(await files.read("none.ttl"), undefined);
        assert.deepEqual(await files.list("queries"), ["queries/a.rq"]);
      }
      assert.deepEqual(
        asked.sort(),
        (packed
          ? ["c.json", `c/${UNPACKED}`, "c/none.ttl"]
          : [
              "c.json",
              "c/files.json",
              `c/${UNPACKED}`,
              "c/none.ttl",
              "c/queries/a.rq",
            ]
        ).sort(),
        packed ? "with a pack" : "without one",
      );
    }
  } finally {
    globalThis.fetch = fetchedNow;
  }
});
