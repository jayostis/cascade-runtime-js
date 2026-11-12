import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  type DeriveKey,
  EncryptedFiles,
  HEADER,
  newHeader,
  openHeader,
  type PodKey,
  SEALED_INDEX,
  SealedIndex,
  UPGRADE_CLAIM,
  Unopened,
} from "../src/encryption.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { Refusal } from "../src/step.js";

const SECRET = "abacus abdomen abdominal abide abiding zoom";
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const encoded = (value: string) => new TextEncoder().encode(value);

const derive: DeriveKey = async (secret, salt) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array([...secret, ...salt])),
  );

const VIEW = "views/medications.ttl";
const STOPPED = "<#metformin> <#status> <#stopped> .\n";

/** A pod's files as a 1.2 pod and a 1.3 pod hold them: a record version, a view, and a plaintext file. */
const FILES: readonly (readonly [string, string])[] = [
  [
    "clinical/medications/9f/9f2c4e1a7b3d5f60.ttl",
    "<#metformin> a <#Medication> .\n",
  ],
  [VIEW, "<#metformin> <#status> <#active> .\n"],
  ["README.md", "A pod.\n"],
];

const WRITTEN = [...FILES]
  .sort(([one], [other]) => (one < other ? -1 : 1))
  .map(([path, body]) => [path, body]);

/** A new 1.3 pod in the files, opened, holding `FILES`. */
async function madePod(files: Files = new MemoryFiles("urn:test:pod/")) {
  const { bytes, key } = await newHeader(SECRET, derive);
  await files.write(HEADER, bytes);
  const index = await SealedIndex.open(files, key);
  const pod = new EncryptedFiles(files, key, { index });
  await pod.writeAll(FILES.map(([path, body]) => [path, encoded(body)]));
  return { files, key, index, pod };
}

/** The pod in the files opened again, as a new opening of it would: its header read, its index opened. */
async function reopened(
  files: Files,
  timing?: Parameters<typeof SealedIndex.open>[2],
): Promise<EncryptedFiles> {
  const key = await openHeader(
    (await files.read(HEADER)) ?? new Uint8Array(),
    SECRET,
    derive,
  );
  const index = await SealedIndex.open(files, key, timing);
  return new EncryptedFiles(files, index.key, { index });
}

/** A 1.2 pod in the files, holding `FILES` each sealed under its own path, as a 1.2 runtime wrote it; its key. */
async function earlierPod(files: Files): Promise<PodKey> {
  const { bytes } = await newHeader(SECRET, derive);
  const header = encoded(
    text(bytes)
      .replace('"version": "1.3"', '"version": "1.2"')
      .replace('"resourceFormat": 3', '"resourceFormat": 2'),
  );
  await files.write(HEADER, header);
  const key = await openHeader(header, SECRET, derive);
  assert.equal(key.version, "1.2");
  await new EncryptedFiles(files, key).writeAll(
    FILES.map(([path, body]) => [path, encoded(body)]),
  );
  return key;
}

/** What a pod reads as: each file it lists, with its text. */
async function readAs(pod: Files): Promise<string[][]> {
  return Promise.all(
    (await pod.list("")).map(async (path) => [
      path,
      text(await pod.read(path)),
    ]),
  );
}

/** The files a pod stores under keyed names. */
const keyed = async (files: Files) =>
  (await files.list("sealed")).filter((path) => path !== SEALED_INDEX);

/** The header version stated in the pod's files. */
const versionIn = async (files: Files) =>
  (JSON.parse(text(await files.read(HEADER))) as { version: string }).version;

/**
 * Files in memory that count each call that changes them, by kind and path, and throw on the call numbered `stopAt`,
 * as a process that stopped there would leave them.
 */
class StoppingFiles implements Files {
  readonly iri = "urn:test:pod/";
  readonly changes: string[] = [];
  stopAt: number | undefined;
  constructor(readonly memory = new MemoryFiles("urn:test:pod/")) {}

  #change(kind: string, path: string): void {
    this.changes.push(`${kind} ${path}`);
    if (this.changes.length === this.stopAt)
      throw new Error(`stopped at ${kind} ${path}`);
  }

  read(path: string) {
    return this.memory.read(path);
  }

  async write(path: string, bytes: Uint8Array) {
    this.#change("write", path);
    return this.memory.write(path, bytes);
  }

  async writeNew(path: string, bytes: Uint8Array) {
    this.#change("writeNew", path);
    return this.memory.writeNew(path, bytes);
  }

  async replace(
    path: string,
    bytes: Uint8Array,
    holds: Uint8Array | undefined,
  ) {
    this.#change("replace", path);
    return this.memory.replace(path, bytes, holds);
  }

  async remove(paths: readonly string[]) {
    for (const path of paths) {
      this.#change("remove", path);
      await this.memory.remove([path]);
    }
  }

  list(folder: string) {
    return this.memory.list(folder);
  }

  count(path: string): number {
    return this.changes.filter((change) => change.endsWith(` ${path}`)).length;
  }
}

async function outcomeOf(doing: Promise<unknown>): Promise<string> {
  try {
    await doing;
    return "done";
  } catch (error) {
    if (error instanceof Unopened) return error.outcome;
    if (error instanceof Refusal) return `refused: ${error.message}`;
    throw error;
  }
}

/** A 1.3 pod whose view was written again, with what its first copy was stored under and held, which that write removed. */
async function rewrittenPod() {
  const files = new MemoryFiles("urn:test:pod/");
  const { pod } = await madePod(files);
  const before = new Map<string, Uint8Array>();
  for (const path of await keyed(files))
    before.set(path, (await files.read(path)) ?? new Uint8Array());
  await pod.write(VIEW, encoded(STOPPED));
  const now = await keyed(files);
  const [earlier] = [...before].filter(([path]) => !now.includes(path));
  const [later] = now.filter((path) => !before.has(path));
  assert.ok(earlier !== undefined && later !== undefined);
  return { files, pod, earlier, later };
}

let folders: string;

before(async () => {
  folders = await mkdtemp(join(tmpdir(), "sealed-index-"));
});

after(async () => {
  await rm(folders, { recursive: true, force: true });
});

/**
 * A 1.3 pod stores each sealed file under a name keyed by its pod's data key, so its folder shows no path, kind or
 * hash of what it holds; a sealed index names each file with its keyed name and the tag it was sealed with, so a file
 * deleted, restored from an older copy, or swapped with another refuses with `changed outside the runtime`. A 1.2 pod is
 * upgraded to 1.3 in place on its first open with the secret.
 */
describe("Keeping a pod's sealed files under keyed names · SealedIndex.open(), EncryptedFiles", () => {
  describe("when a 1.3 pod's files are written", () => {
    it("stores each sealed file under a name that holds no part of its path and no hash of its bytes, and reads it back", async () => {
      const { files, pod } = await madePod();
      const stored = await files.list("");
      const told = FILES.flatMap(([path, body]) => [
        ...path.split(/[/.]/),
        createHash("sha256").update(body).digest("hex"),
      ]).filter((part) => part.length > 2 && part !== "ttl");
      for (const name of await keyed(files))
        for (const part of told)
          assert.ok(!name.includes(part), `${name} holds ${part}`);
      assert.deepEqual(
        stored.filter(
          (path) => !/^sealed\/[0-9a-f]{2}\/[0-9a-f]{62}$/.test(path),
        ),
        ["README.md", SEALED_INDEX, HEADER],
      );
      assert.deepEqual(await readAs(pod), WRITTEN);
    });

    it("writes the index once for a `writeAll` of 10 files and once for one of 10,000", async () => {
      const writes: number[] = [];
      for (const count of [10, 10_000]) {
        const files = new StoppingFiles();
        const { bytes, key } = await newHeader(SECRET, derive);
        await files.memory.write(HEADER, bytes);
        const index = await SealedIndex.open(files, key);
        const opened = files.count(SEALED_INDEX);
        await new EncryptedFiles(files, key, { index }).writeAll(
          Array.from(
            { length: count },
            (_, n) =>
              [`records/${n}.ttl`, encoded(`<#r${n}> a <#R> .`)] as const,
          ),
        );
        writes.push(files.count(SEALED_INDEX) - opened);
      }
      assert.deepEqual(writes, [1, 1]);
    });

    it("ignores a file the index does not name, and at the next write removes it, its emptied folder, and the earlier copy of a file written again", async () => {
      const at = join(folders, "unnamed");
      const files = new FolderFiles(at, undefined, { refuseLinks: true });
      await madePod(files);
      await files.write("sealed/ab/added", encoded("from outside"));
      await files.write("notes/kept.txt", encoded("from outside"));
      const again = await reopened(files);
      assert.deepEqual(await readAs(again), WRITTEN);
      await again.write(VIEW, encoded(STOPPED));
      assert.equal(text(await again.read(VIEW)), STOPPED);
      const now = await files.list("");
      assert.ok(!now.includes("sealed/ab/added"), "the added sealed file");
      assert.ok(!now.includes("notes/kept.txt"), "the added plain file");
      assert.equal((await keyed(files)).length, 2, "the record and one view");
      assert.ok(!(await readdir(at)).includes("notes"), "the emptied folder");
    });
  });

  describe("when a 1.3 pod was changed outside the runtime", () => {
    it("refuses with `changed outside the runtime`: at open, a named file or the index gone or cut short, or an earlier header beside the index; on read, an older copy at a file's name; on write, an older index", async () => {
      const restate = async (files: Files) =>
        files.write(
          HEADER,
          encoded(
            text(await files.read(HEADER))
              .replace('"version": "1.3"', '"version": "1.2"')
              .replace('"resourceFormat": 3', '"resourceFormat": 2'),
          ),
        );
      const cases: [
        string,
        (pod: Awaited<ReturnType<typeof rewrittenPod>>) => Promise<unknown>,
      ][] = [
        [
          "a named file deleted",
          async ({ files, later }) => {
            await files.remove([later]);
            return reopened(files);
          },
        ],
        [
          "the index deleted",
          async ({ files }) => {
            await files.remove([SEALED_INDEX]);
            return reopened(files);
          },
        ],
        [
          "the index cut short",
          async ({ files }) => {
            const index = (await files.read(SEALED_INDEX)) ?? new Uint8Array();
            await files.write(SEALED_INDEX, index.subarray(0, 40));
            return reopened(files);
          },
        ],
        [
          "the header restated as 1.2",
          async ({ files }) => {
            await restate(files);
            return reopened(files);
          },
        ],
        [
          "the view's older copy put at its keyed name",
          async ({ files, pod, earlier, later }) => {
            await files.write(later, earlier[1]);
            return pod.read(VIEW);
          },
        ],
        [
          "an older index put back while the pod is open",
          async ({ files, pod }) => {
            const older = (await files.read(SEALED_INDEX)) ?? new Uint8Array();
            await pod.write("views/allergies.ttl", encoded("<#a> <#b> <#c> ."));
            await files.write(SEALED_INDEX, older);
            return pod.write(
              "views/allergies.ttl",
              encoded("<#d> <#e> <#f> ."),
            );
          },
        ],
      ];
      const outcomes: string[] = [];
      for (const [, tamper] of cases)
        outcomes.push(await outcomeOf(tamper(await rewrittenPod())));
      assert.deepEqual(
        outcomes,
        cases.map(() => "changed outside the runtime"),
        cases.map(([name]) => name).join("; "),
      );
    });

    it("reads the latest copy of a file whose older copy was put back at its earlier name, and removes that copy at the next write", async () => {
      const { files, earlier } = await rewrittenPod();
      await files.write(earlier[0], earlier[1]);
      const again = await reopened(files);
      assert.equal(text(await again.read(VIEW)), STOPPED);
      await again.write("views/allergies.ttl", encoded("<#a> <#b> <#c> ."));
      assert.ok(!(await files.list("")).includes(earlier[0]));
    });
  });

  describe("when two openings write one pod", () => {
    it("refuses the later writer's write, saying to open the pod again, and its read of a file the other wrote again, and leaves the pod as the first wrote it", async () => {
      const { files } = await madePod();
      const [one, other] = [await reopened(files), await reopened(files)];
      await one.write(VIEW, encoded(STOPPED));
      const again =
        /written by another opening since this one opened it; open it again/;
      await assert.rejects(
        other.write("views/allergies.ttl", encoded("<#a> <#b> <#c> .")),
        again,
        "write",
      );
      await assert.rejects(other.read(VIEW), again, "read");
      assert.equal(text(await (await reopened(files)).read(VIEW)), STOPPED);
      assert.ok(
        !(await (await reopened(files)).list("")).includes(
          "views/allergies.ttl",
        ),
      );
    });
  });

  describe("when a write stops part way", () => {
    it("leaves a pod that opens and reads as it was before the write or after it, wherever it stopped", async () => {
      const probe = new StoppingFiles();
      const { pod: whole } = await madePod(probe);
      const before = probe.changes.length;
      await whole.writeAll([
        [VIEW, encoded(STOPPED)],
        ["views/allergies.ttl", encoded("<#a> <#b> <#c> .\n")],
      ]);
      const steps = probe.changes.length - before;
      assert.ok(steps >= 4, probe.changes.slice(before).join("\n"));
      const reads: string[] = [];
      for (let stop = 1; stop <= steps; stop++) {
        const files = new StoppingFiles();
        const { pod } = await madePod(files);
        files.stopAt = files.changes.length + stop;
        await pod
          .writeAll([
            [VIEW, encoded(STOPPED)],
            ["views/allergies.ttl", encoded("<#a> <#b> <#c> .\n")],
          ])
          .catch(() => undefined);
        files.stopAt = undefined;
        const again = await reopened(files);
        reads.push(text(await again.read(VIEW)));
      }
      assert.ok(
        reads.every((read) => read === STOPPED || read === FILES[1]?.[1]),
        reads.join(""),
      );
    });
  });

  describe("given a 1.2 pod", () => {
    it("upgrades it to 1.3 in place on its first open: the same files and bytes, none stored under its own path, and no claim left", async () => {
      const files = new MemoryFiles("urn:test:pod/");
      await earlierPod(files);
      const pod = await reopened(files);
      assert.equal(await versionIn(files), "1.3");
      assert.deepEqual(await readAs(pod), WRITTEN);
      const stored = await files.list("");
      for (const [path] of FILES.filter(([path]) => path !== "README.md"))
        assert.ok(!stored.includes(path), path);
      assert.ok(!stored.includes(UPGRADE_CLAIM));
      assert.deepEqual(await readAs(await reopened(files)), WRITTEN);
    });

    it("leaves a pod that opens, as 1.2 until the 1.3 header is written, and is then upgraded, wherever the upgrade stopped", async () => {
      const probe = new StoppingFiles();
      await earlierPod(probe.memory);
      await reopened(probe);
      const steps = probe.changes.length;
      assert.ok(steps >= 5, probe.changes.join("\n"));
      const seen: string[] = [];
      for (let stop = 1; stop <= steps; stop++) {
        const files = new StoppingFiles();
        await earlierPod(files.memory);
        files.stopAt = stop;
        await reopened(files).catch(() => undefined);
        files.stopAt = undefined;
        seen.push(await versionIn(files));
        const again = await reopened(files, { claimHolds: 0 });
        assert.deepEqual(
          await readAs(again),
          WRITTEN,
          `stopped at ${stop}: ${probe.changes[stop - 1]}`,
        );
        assert.equal(await versionIn(files), "1.3");
        assert.ok(
          !(await files.list("")).includes(UPGRADE_CLAIM),
          `stopped at ${stop}`,
        );
      }
      assert.ok(seen.includes("1.2") && seen.includes("1.3"), seen.join(" "));
    });

    it("upgrades it once when two openings race, and opens it for both", async () => {
      const files = new StoppingFiles();
      await earlierPod(files.memory);
      const [one, other] = await Promise.all([
        reopened(files, { lookEvery: 5 }),
        reopened(files, { lookEvery: 5 }),
      ]);
      assert.deepEqual(await readAs(one), WRITTEN);
      assert.deepEqual(await readAs(other), WRITTEN);
      assert.equal(files.count(SEALED_INDEX), 1, files.changes.join("\n"));
      assert.equal(files.count(HEADER), 1);
    });

    it("waits on another opening's claim while it holds, and takes over one it has held too long", async () => {
      const files = new MemoryFiles("urn:test:pod/");
      const key = await earlierPod(files);
      const claimed = encoded(
        `# cascade-runtime upgrades this pod from 1.2 to 1.3; claimed ${Date.now()}\n`,
      );
      await new EncryptedFiles(files, key).write(UPGRADE_CLAIM, claimed);
      const waited = await Promise.race([
        reopened(files, { lookEvery: 5 }).then(() => "opened"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 200)),
      ]);
      assert.equal(waited, "waiting");
      await reopened(files, { claimHolds: 0 });
      assert.equal(await versionIn(files), "1.3");
    });
  });
});
