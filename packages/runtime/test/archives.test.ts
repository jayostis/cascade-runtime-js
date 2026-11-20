import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ArchivedFiles, archivedFiles } from "../src/archives.js";
import {
  type DeriveKey,
  EncryptedFiles,
  madeNewPod,
  newHeader,
  SealedIndex,
} from "../src/encryption.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { Layout } from "../src/layout.js";
import { catFile, unpack } from "../src/node/archive-commands.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { probing } from "../src/probe.js";
import { Refusal } from "../src/step.js";
import { layout as vocabularyLayout } from "./vocabulary.js";
import { archived, packed, zipOf, type ZipEntry } from "./zip.js";

const POD = "https://pod.example/";
const ARCHIVES = "archives/";
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (read: Uint8Array | undefined): string | undefined =>
  read && new TextDecoder().decode(read);

const CARD = "profile/card.ttl";
const LOOSE = "records/conditions/aa/aa01.ttl";
const STORED = "records/conditions/bb/bb02.ttl";
const DEFLATED = "provenance/imports/dd/dd04.ttl";
const SUBJECT = "subject/cc/cc03.ttl";
const BODY = {
  [CARD]: "<#me> a <#Person> .\n",
  [LOOSE]: "<#a> a <#Condition> .\n",
  [STORED]: "<#b> a <#Condition> .\n",
  [DEFLATED]: `${"<#i> <#wrote> <#x> .\n".repeat(40)}`,
  [SUBJECT]: "<#s> a <#Subject> .\n",
};
const IN_ARCHIVE: readonly ZipEntry[] = [
  { path: DEFLATED, bytes: bytes(BODY[DEFLATED]), deflate: true },
  { path: STORED, bytes: bytes(BODY[STORED]) },
  { path: SUBJECT, bytes: bytes(BODY[SUBJECT]) },
];

/** Every read and ranged read the host is asked for, by path. */
class Counting implements Files {
  readonly reads: string[] = [];
  readonly ranges: string[] = [];
  constructor(readonly files: MemoryFiles) {}
  get iri(): string {
    return this.files.iri;
  }
  read(path: string) {
    this.reads.push(path);
    return this.files.read(path);
  }
  readRange(path: string, start: number, length: number) {
    this.ranges.push(path);
    return this.files.readRange(path, start, length);
  }
  write(path: string, written: Uint8Array) {
    return this.files.write(path, written);
  }
  list(folder: string) {
    return this.files.list(folder);
  }
}

/** Files in memory holding the card and `LOOSE` at their paths and `IN_ARCHIVE` in one archive, and a stopped write beside it. */
async function memoryPod(): Promise<{ host: MemoryFiles; archive: string }> {
  const host = new MemoryFiles(POD);
  await host.write(CARD, bytes(BODY[CARD]));
  await host.write(LOOSE, bytes(BODY[LOOSE]));
  const archive = await archived(host, zipOf(IN_ARCHIVE));
  await host.write(`${archive}.4242.1.writing`, bytes("half"));
  await host.write(`${ARCHIVES}notes.txt`, bytes("not an archive"));
  return { host, archive };
}

/**
 * A pod's host may keep the files that never change in ZIP archives, in the folder the layout gives
 * `cascade:holdsFilesInArchivesOfMediaType` (X1). Over any host, `ArchivedFiles` is the pod's one listing of every file
 * at its own path and every entry of every archive, an archive's directory read once when it is opened and an entry by
 * one ranged read; an archive that is torn, or outside the profile, is refused, naming it, and so is a file held twice
 * with other bytes.
 */
describe("Reading a pod's files from archives · ArchivedFiles, archivedFiles()", () => {
  let folder: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "archives-"));
  });

  after(() => rm(folder, { recursive: true, force: true }));

  describe("given files at their own paths and in an archive, in memory and in a folder on disk", () => {
    let kinds: [string, ArchivedFiles][];

    before(async () => {
      const { host } = await memoryPod();
      const disk = new FolderFiles(join(folder, "union"), POD);
      for (const path of await host.list(""))
        await disk.write(path, (await host.read(path)) as Uint8Array);
      kinds = [
        ["memory", new ArchivedFiles(host, ARCHIVES)],
        ["folder", new ArchivedFiles(disk, ARCHIVES)],
      ];
    });

    it("lists every file at its own path and every entry of every archive, and nothing in the archives' folder", async () => {
      for (const [kind, files] of kinds) {
        assert.deepEqual(
          await files.list(""),
          [CARD, DEFLATED, LOOSE, STORED, SUBJECT],
          kind,
        );
        assert.deepEqual(await files.list("records"), [LOOSE, STORED], kind);
        assert.deepEqual(await files.list(ARCHIVES), [], kind);
      }
    });

    it("reads an entry, stored or deflated, as the file it holds, and part of one as readRange does", async () => {
      for (const [kind, files] of kinds) {
        for (const path of [CARD, LOOSE, STORED, DEFLATED, SUBJECT] as const)
          assert.equal(text(await files.read(path)), BODY[path], kind);
        assert.equal(
          text(await files.readRange(`${POD}${STORED}`, -4, 3)),
          "> .",
          kind,
        );
        assert.equal(
          await files.read("records/conditions/bb/none.ttl"),
          undefined,
          kind,
        );
      }
    });
  });

  it("opens an archive by its directory alone, reads each entry by one ranged read, and counts both", async () => {
    const { host, archive } = await memoryPod();
    const counting = new Counting(host);
    const { result: read, seen } = await probing(async () => {
      const files = new ArchivedFiles(counting, ARCHIVES);
      await files.list("");
      const opened = counting.ranges.length;
      await files.read(STORED);
      await files.read(DEFLATED);
      return { opened, entries: counting.ranges.length - opened };
    });
    assert.deepEqual(read, { opened: 2, entries: 2 });
    assert.deepEqual(
      counting.ranges.filter((path) => path !== archive),
      [],
    );
    assert.equal(counting.reads.includes(archive), false);
    assert.equal(seen.counts.get("archives.opened"), 1);
    assert.equal(seen.counts.get("archives.entries"), 3);
    assert.equal(seen.counts.get("archives.entries.read"), 2);
  });

  it("lists once a file held at its own path and in an archive with the same bytes", async () => {
    const { host } = await memoryPod();
    await host.write(STORED, bytes(BODY[STORED]));
    await archived(
      host,
      zipOf([{ path: SUBJECT, bytes: bytes(BODY[SUBJECT]) }]),
    );
    const files = new ArchivedFiles(host, ARCHIVES);
    assert.deepEqual(await files.list(""), [
      CARD,
      DEFLATED,
      LOOSE,
      STORED,
      SUBJECT,
    ]);
  });

  it("refuses the pod, naming the path, when a file is held in two places with other bytes", async () => {
    for (const [where, hold] of [
      [
        "at its own path",
        (host: MemoryFiles) => host.write(STORED, bytes("<#other> .\n")),
      ],
      [
        "in a second archive",
        (host: MemoryFiles) =>
          archived(
            host,
            zipOf([{ path: STORED, bytes: bytes("<#other> .\n") }]),
          ),
      ],
    ] as const) {
      const { host } = await memoryPod();
      await hold(host);
      await assert.rejects(
        new ArchivedFiles(host, ARCHIVES).list(""),
        (error: unknown) =>
          error instanceof Refusal &&
          error.message.includes(STORED) &&
          /other bytes/.test(error.message),
        where,
      );
    }
  });

  it("refuses, naming the archive and reading nothing from it, an archive that is torn or outside the profile", async () => {
    const file = (path: string, more: Partial<ZipEntry> = {}): ZipEntry => ({
      path,
      bytes: bytes("<#x> .\n"),
      ...more,
    });
    const cases: [string, Uint8Array, RegExp][] = [
      [
        "torn",
        zipOf([file(STORED)], { torn: true }),
        /no end of central directory record/,
      ],
      [
        "bytes before its first entry",
        new Uint8Array([0, 0, 0, 0, ...zipOf([file(STORED)])]),
        /not where its end record says/,
      ],
      [
        "an encrypted entry",
        zipOf([file(STORED, { flags: 0x0801 })]),
        /encrypted/,
      ],
      [
        "an entry compressed by bzip2",
        zipOf([file(STORED, { method: 12 })]),
        /method 12/,
      ],
      [
        "an entry compressed by zstd",
        zipOf([file(STORED, { method: 93 })]),
        /method 93/,
      ],
      [
        "a ZIP64 field in an entry",
        zipOf([file(STORED, { extra: new Uint8Array([1, 0, 0, 0]) })]),
        /ZIP64/,
      ],
      ["a ZIP64 end record", zipOf([file(STORED)], { zip64: true }), /ZIP64/],
      [
        "a central directory on another disk",
        zipOf([file(STORED)], { disk: 1 }),
        /disk/,
      ],
      [
        "a path in another encoding than UTF-8",
        zipOf([
          file(STORED, {
            flags: 0,
            name: new Uint8Array([
              ...bytes("records/"),
              0x82,
              ...bytes(".ttl"),
            ]),
          }),
        ]),
        /UTF-8/,
      ],
      [
        "a path that is not UTF-8 though flagged so",
        zipOf([
          file(STORED, {
            name: new Uint8Array([
              ...bytes("records/"),
              0xff,
              ...bytes(".ttl"),
            ]),
          }),
        ]),
        /UTF-8/,
      ],
      ["a path held twice", zipOf([file(STORED), file(STORED)]), /twice/],
      [
        "an entry in the archives' folder",
        zipOf([file(`${ARCHIVES}${"0".repeat(64)}.zip`)]),
        /archives' folder/,
      ],
      [
        "a path that leaves the pod",
        zipOf([file("../outside.ttl")]),
        /no path/,
      ],
      ["a path with a backslash", zipOf([file("records\\x.ttl")]), /no path/],
      ["a path from the root", zipOf([file("/records/x.ttl")]), /no path/],
    ];
    for (const [what, archive, why] of cases) {
      const host = new MemoryFiles(POD);
      await host.write(CARD, bytes(BODY[CARD]));
      const path = await archived(host, archive);
      const files = new ArchivedFiles(host, ARCHIVES);
      await assert.rejects(
        files.read(CARD),
        (error: unknown) =>
          error instanceof Refusal &&
          error.message.includes(path) &&
          why.test(error.message),
        what,
      );
    }
  });

  it("refuses an entry whose bytes are not those its directory says, naming it and its archive", async () => {
    const host = new MemoryFiles(POD);
    const path = await archived(
      host,
      zipOf([{ path: STORED, bytes: bytes(BODY[STORED]), crc: 1 }]),
    );
    const files = new ArchivedFiles(host, ARCHIVES);
    assert.deepEqual(await files.list(""), [STORED]);
    await assert.rejects(
      files.read(STORED),
      (error: unknown) =>
        error instanceof Refusal &&
        error.message.includes(STORED) &&
        error.message.includes(path),
    );
  });

  it("takes an entry for a folder as no file and an archive of none as one holding nothing, and finds an archive's end past its comment", async () => {
    const host = new MemoryFiles(POD);
    await archived(
      host,
      zipOf([{ path: "records/", bytes: new Uint8Array() }]),
    );
    await archived(host, zipOf([]));
    await archived(
      host,
      zipOf([{ path: SUBJECT, bytes: bytes(BODY[SUBJECT]) }], {
        comment: "x".repeat(300),
      }),
    );
    const files = new ArchivedFiles(host, ARCHIVES);
    assert.deepEqual(await files.list(""), [SUBJECT]);
    assert.equal(text(await files.read(SUBJECT)), BODY[SUBJECT]);
  });

  it("writes a file no archive holds through to the host; refuses one an archive holds with other bytes, and removes none an archive holds", async () => {
    const { host } = await memoryPod();
    const files = new ArchivedFiles(host, ARCHIVES);
    await files.write(LOOSE.replace("aa01", "aa05"), bytes("<#e> .\n"));
    assert.equal(
      text(await host.read(LOOSE.replace("aa01", "aa05"))),
      "<#e> .\n",
    );
    await files.write(STORED, bytes(BODY[STORED]));
    assert.equal(await host.read(STORED), undefined);
    await assert.rejects(
      files.write(STORED, bytes("<#other> .\n")),
      (error: unknown) =>
        error instanceof Refusal && error.message.includes(STORED),
    );
    assert.ok(files.remove);
    await assert.rejects(
      files.remove([STORED]),
      (error: unknown) =>
        error instanceof Error && error.message.includes(STORED),
    );
    assert.equal(text(await files.read(STORED)), BODY[STORED]);
  });

  it("with the vocabulary's layout, reads the archives in the folder it gives them; with none, is the host as it is", async () => {
    const layout = await vocabularyLayout();
    const { host } = await memoryPod();
    assert.equal(layout.archivesFolder, ARCHIVES);
    assert.deepEqual(await archivedFiles(host, layout).list("subject"), [
      SUBJECT,
    ]);
    const none = Layout.of(
      layout.turtle,
      layout.placements.filter(
        ({ archivesOfMediaType }) => archivesOfMediaType === undefined,
      ),
    );
    assert.equal(archivedFiles(host, none), host);
  });

  it("leaves no handle open on an archive in a folder, which can then be renamed", async () => {
    const at = join(folder, "handles");
    const disk = new FolderFiles(at, POD);
    const path = await archived(disk, zipOf(IN_ARCHIVE));
    const files = new ArchivedFiles(disk, ARCHIVES);
    assert.equal(text(await files.read(STORED)), BODY[STORED]);
    await rename(join(at, ...path.split("/")), join(at, ARCHIVES, "moved.zip"));
    assert.deepEqual(await readdir(join(at, ARCHIVES)), ["moved.zip"]);
  });

  describe("given an encrypted pod whose sealed files are held in an archive", () => {
    const derive: DeriveKey = async (secret, salt) =>
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array([...secret, ...salt]),
        ),
      );
    const FILES: [string, string][] = [
      [STORED, BODY[STORED]],
      [SUBJECT, BODY[SUBJECT]],
    ];

    it("reads each file through its sealed index, made loose or packed", async () => {
      const host = new MemoryFiles(POD);
      const made = await newHeader(
        "abacus abdomen abdominal abide abiding zoom",
        derive,
      );
      assert.ok(await madeNewPod(host, made));
      const sealing = new EncryptedFiles(host, made.key, {
        index: await SealedIndex.open(host, made.key),
      });
      await sealing.writeAll(FILES.map(([path, body]) => [path, bytes(body)]));
      const opened = async () => {
        const files = new ArchivedFiles(host, ARCHIVES);
        const index = await SealedIndex.open(files, made.key);
        const pod = new EncryptedFiles(files, index.key, { index });
        return Promise.all(
          FILES.map(async ([path]) => text(await pod.read(path))),
        );
      };
      const bodies = FILES.map(([, body]) => body);
      assert.deepEqual(await opened(), bodies);
      const sealed = (await host.list("sealed")).filter(
        (path) => !path.startsWith("sealed/index/"),
      );
      assert.equal(sealed.length, FILES.length);
      await packed(host, sealed);
      assert.deepEqual(
        await host
          .list("sealed")
          .then((paths) => paths.filter((path) => sealed.includes(path))),
        [],
      );
      assert.deepEqual(await opened(), bodies);
    });
  });

  describe("cat and unpack, the commands that look inside", () => {
    it("cat prints a file held loose or in an archive; unpack writes a pod's or an archive's files to a folder", async () => {
      const layout = await vocabularyLayout();
      const { host } = await memoryPod();
      const pod = join(folder, "cat-pod");
      const disk = new FolderFiles(pod);
      for (const path of await host.list(""))
        await disk.write(path, (await host.read(path)) as Uint8Array);
      assert.equal(text(await catFile(pod, layout, STORED)), BODY[STORED]);
      assert.equal(text(await catFile(pod, layout, CARD)), BODY[CARD]);
      await assert.rejects(
        catFile(pod, layout, "records/none.ttl"),
        /records\/none\.ttl/,
      );

      const out = join(folder, "unpacked-pod");
      assert.equal(await unpack(pod, out, layout), 5);
      const written = await new FolderFiles(out).list("");
      assert.deepEqual(written, [CARD, DEFLATED, LOOSE, STORED, SUBJECT]);
      assert.equal(
        new TextDecoder().decode(
          await readFile(join(out, ...DEFLATED.split("/"))),
        ),
        BODY[DEFLATED],
      );

      const one = join(folder, "unpacked-archive");
      const [archive] = await disk
        .list(ARCHIVES)
        .then((paths) => paths.filter((path) => path.endsWith(".zip")));
      assert.equal(
        await unpack(join(pod, ...(archive as string).split("/")), one, layout),
        3,
      );
      assert.deepEqual(await new FolderFiles(one).list(""), [
        DEFLATED,
        STORED,
        SUBJECT,
      ]);
      await assert.rejects(unpack(pod, one, layout), /not empty/);
    });
  });
});
