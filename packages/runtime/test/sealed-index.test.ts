import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { promisify } from "node:util";
import {
  type DeriveKey,
  EncryptedFiles,
  HEADER,
  madeNewPod,
  newHeader,
  openHeader,
  type PodKey,
  SEALED_INDEX,
  SealedIndex,
  UPGRADE_CLAIM,
  Unopened,
} from "../src/encryption.js";
import { type Files, MemoryFiles, sameBytes } from "../src/files.js";
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
const AGAIN =
  /written by another opening since this one opened it; open it again/;

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

/** The paths the pod layout uses in these tests: a file there that does not open is one changed outside the runtime. */
const laidOut = (path: string) => /^(clinical|views)\//.test(path);

/** A new 1.3 pod in the files, opened, holding `FILES`. */
async function madePod(files: Files = new MemoryFiles("urn:test:pod/")) {
  const made = await newHeader(SECRET, derive);
  assert.ok(await madeNewPod(files, made));
  const { key } = made;
  const index = await SealedIndex.open(files, key);
  const pod = new EncryptedFiles(files, key, { index });
  await pod.writeAll(FILES.map(([path, body]) => [path, encoded(body)]));
  return { files, key, index, pod };
}

/** The pod in the files opened again, as a new opening of it would: its header read, its index opened. */
async function reopened(
  files: Files,
  options?: Parameters<typeof SealedIndex.open>[2],
): Promise<EncryptedFiles> {
  const key = await openHeader(
    (await files.read(HEADER)) ?? new Uint8Array(),
    SECRET,
    derive,
  );
  const index = await SealedIndex.open(files, key, options);
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

/** A file sealed as a 1.2 runtime sealed it, at any path, bound to the path, whether or not this runtime would write there. */
async function earlierSealed(
  key: PodKey,
  path: string,
  body: string,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
      additionalData: new Uint8Array([
        ...encoded("cascade-pod-resource"),
        0,
        ...encoded("2"),
        0,
        ...encoded(path),
      ]),
    },
    key.key,
    encoded(body),
  );
  return new Uint8Array([...iv, ...new Uint8Array(sealed)]);
}

/** What an upgrade's claim, as stored, says: the text of the claim sealed as a 1.2 file under the pod's key. */
async function claimSays(key: PodKey, bytes: Uint8Array): Promise<string> {
  return text(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.subarray(0, 12),
        tagLength: 128,
        additionalData: new Uint8Array([
          ...encoded("cascade-pod-resource"),
          0,
          ...encoded("2"),
          0,
          ...encoded(UPGRADE_CLAIM),
        ]),
      },
      key.key,
      bytes.subarray(12),
    ),
  );
}

/** An upgrade's claim, sealed as a 1.2 file at its path under the pod's key: claimed at the time, stating a count of files or none. */
const sealedClaim = (key: PodKey, at: number, count?: number) =>
  earlierSealed(
    key,
    UPGRADE_CLAIM,
    `# cascade-runtime upgrades this pod from 1.2 to 1.3; claimed ${at}${count === undefined ? "" : `; ${count} files`}\n`,
  );

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
  (await files.list("sealed")).filter(
    (path) => !path.startsWith(`${SEALED_INDEX}/`),
  );

/** The stored index the pod reads: the last one written, its path and bytes. */
async function storedIndex(files: Files): Promise<[string, Uint8Array]> {
  const [path] = (await files.list(SEALED_INDEX)).sort(
    (one, other) =>
      Number(other.slice(SEALED_INDEX.length + 1)) -
      Number(one.slice(SEALED_INDEX.length + 1)),
  );
  assert.ok(path !== undefined, "no stored index");
  return [path, (await files.read(path)) ?? new Uint8Array()];
}

/** The header version stated in the pod's files. */
const versionIn = async (files: Files) =>
  (JSON.parse(text(await files.read(HEADER))) as { version: string }).version;

/**
 * Files in memory that count each call that changes them, by kind and path, and throw on the call numbered `stopAt`
 * and on every call after it, as a process that stopped there would leave them; `restart` is a new process.
 */
class StoppingFiles implements Files {
  readonly iri = "urn:test:pod/";
  readonly changes: string[] = [];
  stopAt: number | undefined;
  constructor(readonly memory = new MemoryFiles("urn:test:pod/")) {}

  #change(kind: string, path: string): void {
    this.changes.push(`${kind} ${path}`);
    if (this.stopAt !== undefined && this.changes.length >= this.stopAt)
      throw new Error(`stopped at ${kind} ${path}`);
  }

  restart(): void {
    this.stopAt = undefined;
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

  /** The writes of a sealed index. */
  indexWrites(): number {
    return this.changes.filter((change) =>
      /^(write|writeNew|replace) sealed\/index\//.test(change),
    ).length;
  }
}

/**
 * Files in memory whose `replace` looks, then lets the other replace waiting look too, then writes: two processes'
 * replaces of one file meet so; `writeNew` is whole, as a link is.
 */
class Interleaving implements Files {
  readonly iri = "urn:test:pod/";
  readonly #looked: (() => void)[] = [];
  constructor(readonly memory = new MemoryFiles("urn:test:pod/")) {}

  read(path: string) {
    return this.memory.read(path);
  }

  write(path: string, bytes: Uint8Array) {
    return this.memory.write(path, bytes);
  }

  writeNew(path: string, bytes: Uint8Array) {
    return this.memory.writeNew(path, bytes);
  }

  async replace(
    path: string,
    bytes: Uint8Array,
    holds: Uint8Array | undefined,
  ) {
    const held = await this.memory.read(path);
    await new Promise<void>((resolve) => {
      this.#looked.push(resolve);
      if (this.#looked.length >= 2)
        for (const go of this.#looked.splice(0)) go();
      setTimeout(resolve, 50);
    });
    if (!sameBytes(held, holds)) return false;
    await this.memory.write(path, bytes);
    return true;
  }

  remove(paths: readonly string[]) {
    return this.memory.remove(paths);
  }

  list(folder: string) {
    return this.memory.list(folder);
  }
}

/** The files, but a write of a kind and path that `refused` says throws, as a file system that cannot take it would. */
function refusing(
  memory: MemoryFiles,
  refused: (kind: "write" | "writeNew", path: string) => boolean,
): Files {
  const check = (kind: "write" | "writeNew", path: string) => {
    if (refused(kind, path))
      throw new Error(`EPERM: operation not permitted, ${kind} '${path}'`);
  };
  return {
    iri: memory.iri,
    read: (path) => memory.read(path),
    write: async (path, bytes) => {
      check("write", path);
      return memory.write(path, bytes);
    },
    writeNew: async (path, bytes) => {
      check("writeNew", path);
      return memory.writeNew(path, bytes);
    },
    replace: (path, bytes, holds) => memory.replace(path, bytes, holds),
    remove: (paths) => memory.remove(paths),
    list: (folder) => memory.list(folder),
  };
}

/** The files, with `landing` run once where `at` says, before that call returns: where another opening's write lands. */
function landingAt(
  memory: MemoryFiles,
  at: "the first listing" | "the index's read",
  landing: () => Promise<unknown>,
): Files {
  let pending: (() => Promise<unknown>) | undefined = landing;
  const land = async () => {
    const run = pending;
    pending = undefined;
    await run?.();
  };
  return {
    iri: memory.iri,
    read: async (path) => {
      const bytes = await memory.read(path);
      if (at === "the index's read" && path.startsWith(`${SEALED_INDEX}/`))
        await land();
      return bytes;
    },
    write: (path, bytes) => memory.write(path, bytes),
    writeNew: (path, bytes) => memory.writeNew(path, bytes),
    replace: (path, bytes, holds) => memory.replace(path, bytes, holds),
    remove: (paths) => memory.remove(paths),
    list: async (folder) => {
      if (at === "the first listing") await land();
      return memory.list(folder);
    },
  };
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

/** A child process that opens the pod in the folder and writes a file of its own, again and again: what it wrote, and what failed other than a write refused for another opening's. */
const WRITER = `
  const [encryption, folders, at, me, rounds] = process.argv.slice(1);
  const { EncryptedFiles, HEADER, openHeader, SealedIndex } = await import(encryption);
  const { FolderFiles } = await import(folders);
  const derive = async (secret, salt) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...secret, ...salt])));
  const files = new FolderFiles(at, undefined, { refuseLinks: true });
  const done = [];
  const failed = [];
  for (let n = 0; n < Number(rounds); n++) {
    const path = "notes/" + me + "-" + n + ".ttl";
    let pod;
    try {
      const key = await openHeader(await files.read(HEADER), ${JSON.stringify(SECRET)}, derive);
      const index = await SealedIndex.open(files, key);
      pod = new EncryptedFiles(files, index.key, { index });
    } catch (error) {
      failed.push("open: " + error.message);
      continue;
    }
    try {
      await pod.write(path, new TextEncoder().encode("<#" + me + "> <#n> " + n + " ."));
      done.push(path);
    } catch (error) {
      if (!/open it again/.test(error.message)) failed.push("write: " + error.message);
    }
  }
  console.log(JSON.stringify({ done, failed }));
`;

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
        ["README.md", `${SEALED_INDEX}/1`, HEADER],
      );
      assert.deepEqual(await readAs(pod), WRITTEN);
    });

    it("writes the index once for a `writeAll` of 10 files and once for one of 10,000", async () => {
      const writes: number[] = [];
      for (const count of [10, 10_000]) {
        const files = new StoppingFiles();
        const made = await newHeader(SECRET, derive);
        await madeNewPod(files.memory, made);
        const index = await SealedIndex.open(files, made.key);
        await new EncryptedFiles(files, made.key, { index }).writeAll(
          Array.from(
            { length: count },
            (_, n) =>
              [`records/${n}.ttl`, encoded(`<#r${n}> a <#R> .`)] as const,
          ),
        );
        writes.push(files.indexWrites());
      }
      assert.deepEqual(writes, [1, 1]);
    });

    it("ignores a file the index does not name; at the next write removes one under `sealed/`, and the earlier copy of a file written again, and leaves one outside it", async () => {
      const at = join(folders, "unnamed");
      const files = new FolderFiles(at, undefined, { refuseLinks: true });
      await madePod(files);
      await files.write("sealed/ab/added", encoded("from outside"));
      await files.write("notes/kept.txt", encoded("from outside"));
      await files.write(".DS_Store", encoded("from outside"));
      const again = await reopened(files);
      assert.deepEqual(await readAs(again), WRITTEN);
      await again.write(VIEW, encoded(STOPPED));
      assert.equal(text(await again.read(VIEW)), STOPPED);
      const now = await files.list("");
      assert.ok(!now.includes("sealed/ab/added"), "the added sealed file");
      assert.ok(now.includes("notes/kept.txt"), "the added plain file");
      assert.ok(now.includes(".DS_Store"), "the added file at the top");
      assert.equal((await keyed(files)).length, 2, "the record and one view");
      assert.ok(!(await readdir(join(at, "sealed"))).includes("ab"));
    });
  });

  describe("given a path the pod's own files are stored at", () => {
    it("refuses a write of `upgrading.ttl` or of a path under `sealed/`, in a 1.3 pod and in a 1.2 pod, and writes nothing", async () => {
      const { files: newer, pod } = await madePod();
      const older = new MemoryFiles("urn:test:pod/");
      const earlier = new EncryptedFiles(older, await earlierPod(older));
      for (const [files, writing] of [
        [newer, pod],
        [older, earlier],
      ] as const) {
        const held = await files.list("");
        for (const path of [
          UPGRADE_CLAIM,
          "sealed",
          "sealed/index",
          "sealed/ab/cd",
        ])
          await assert.rejects(
            writing.write(path, encoded("<#a> <#b> <#c> .")),
            (error) => error instanceof Refusal && error.message.includes(path),
            path,
          );
        assert.deepEqual(await files.list(""), held);
      }
    });
  });

  describe("when a new 1.3 pod is made", () => {
    it("writes its empty sealed index before its header, so a header with no index and no claim beside it refuses with `changed outside the runtime`", async () => {
      const files = new StoppingFiles();
      const made = await newHeader(SECRET, derive);
      assert.ok(await madeNewPod(files, made));
      assert.deepEqual(files.changes, [
        `writeNew ${SEALED_INDEX}/0`,
        `writeNew ${HEADER}`,
      ]);
      assert.deepEqual(await readAs(await reopened(files)), []);
      const bare = new MemoryFiles("urn:test:pod/");
      await bare.write(HEADER, made.bytes);
      assert.equal(
        await outcomeOf(reopened(bare)),
        "changed outside the runtime",
      );
      assert.deepEqual(await bare.list(""), [HEADER]);
    });
  });

  describe("given a folder that cannot hold a 1.3 pod", () => {
    it("refuses an upgrade and a new pod with a `Refusal` that says the file system cannot hold it, leaving a whole 1.2 pod and an empty folder", async () => {
      const cases: [
        string,
        (kind: "write" | "writeNew", path: string) => boolean,
      ][] = [
        [
          "no hard links, as FAT and exFAT have none",
          (kind) => kind === "writeNew",
        ],
        ["no file under sealed/", (_kind, path) => path.startsWith("sealed/")],
      ];
      const plain = (error: unknown) =>
        error instanceof Refusal &&
        !(error instanceof Unopened) &&
        /file system/.test(error.message);
      for (const [what, refused] of cases) {
        const memory = new MemoryFiles("urn:test:pod/");
        await earlierPod(memory);
        const held = await memory.list("");
        await assert.rejects(
          reopened(refusing(memory, refused)),
          plain,
          `${what}: an upgrade`,
        );
        assert.equal(await versionIn(memory), "1.2", what);
        assert.deepEqual(await memory.list(""), held, what);
        const fresh = new MemoryFiles("urn:test:pod/");
        await assert.rejects(
          madeNewPod(refusing(fresh, refused), await newHeader(SECRET, derive)),
          plain,
          `${what}: a new pod`,
        );
        assert.deepEqual(await fresh.list(""), [], what);
      }
    });

    it("refuses a 1.2 pod holding a file at `sealed`, the name its sealed folder needs, each time it is opened, and leaves it whole with no claim", async () => {
      const files = new FolderFiles(
        join(folders, "file-at-sealed"),
        undefined,
        {
          refuseLinks: true,
        },
      );
      const key = await earlierPod(files);
      await files.write(
        "sealed",
        await earlierSealed(key, "sealed", "<#a> <#b> <#c> .\n"),
      );
      const held = await files.list("");
      for (const open of [1, 2]) {
        await assert.rejects(
          reopened(files),
          (error) => error instanceof Refusal && !(error instanceof Unopened),
          `open ${open}`,
        );
        assert.equal(await versionIn(files), "1.2", `open ${open}`);
        assert.deepEqual(await files.list(""), held, `open ${open}`);
      }
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
            await files.remove(await files.list(SEALED_INDEX));
            return reopened(files);
          },
        ],
        [
          "the index cut short",
          async ({ files }) => {
            const [path, index] = await storedIndex(files);
            await files.write(path, index.subarray(0, 40));
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
            const [path, older] = await storedIndex(files);
            await pod.write("views/allergies.ttl", encoded("<#a> <#b> <#c> ."));
            await files.remove(await files.list(SEALED_INDEX));
            await files.write(path, older);
            return pod.write(
              "views/allergies.ttl",
              encoded("<#d> <#e> <#f> ."),
            );
          },
        ],
        [
          "an older index put at the newer one's name while the pod is open",
          async ({ files, pod }) => {
            const [, older] = await storedIndex(files);
            await pod.write("views/allergies.ttl", encoded("<#a> <#b> <#c> ."));
            const [path] = await storedIndex(files);
            await files.write(path, older);
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

    it("refuses with `changed outside the runtime`, removing nothing, a 1.3 pod whose index is gone beside an upgrade's claim held too long", async () => {
      const outcomes: string[] = [];
      for (const count of [undefined, 2]) {
        const files = new MemoryFiles("urn:test:pod/");
        const { key } = await madePod(files);
        await files.remove(await files.list(SEALED_INDEX));
        await files.write(
          UPGRADE_CLAIM,
          await sealedClaim(key, Date.now() - 3_600_000, count),
        );
        const held = await files.list("");
        outcomes.push(await outcomeOf(reopened(files, { claimHolds: 0 })));
        assert.deepEqual(await files.list(""), held, `a claim of ${count}`);
      }
      assert.deepEqual(outcomes, [
        "changed outside the runtime",
        "changed outside the runtime",
      ]);
    });
  });

  describe("when two openings write one pod", () => {
    it("refuses the later writer's write, saying to open the pod again, and its read of a file the other wrote again, and leaves the pod as the first wrote it", async () => {
      const { files } = await madePod();
      const [one, other] = [await reopened(files), await reopened(files)];
      await one.write(VIEW, encoded(STOPPED));
      await assert.rejects(
        other.write("views/allergies.ttl", encoded("<#a> <#b> <#c> .")),
        AGAIN,
        "write",
      );
      await assert.rejects(other.read(VIEW), AGAIN, "read");
      assert.equal(text(await (await reopened(files)).read(VIEW)), STOPPED);
      assert.ok(
        !(await (await reopened(files)).list("")).includes(
          "views/allergies.ttl",
        ),
      );
    });

    it("writes one of two writes whose looks at the stored index meet, as two processes' do, and refuses the other", async () => {
      const files = new Interleaving();
      await madePod(files);
      const [one, other] = [await reopened(files), await reopened(files)];
      const outcomes = await Promise.all([
        outcomeOf(one.write("views/one.ttl", encoded("<#one> <#b> <#c> ."))),
        outcomeOf(
          other.write("views/other.ttl", encoded("<#other> <#b> <#c> .")),
        ),
      ]);
      assert.deepEqual(
        outcomes.map((outcome) => outcome.replace(AGAIN, "again")).sort(),
        ["done", "refused: the pod was again"],
      );
      const written = outcomes[0] === "done" ? "one" : "other";
      const fresh = await reopened(files);
      assert.deepEqual(
        (await fresh.list("views")).filter((path) => path !== VIEW),
        [`views/${written}.ttl`],
      );
      assert.equal(
        text(await fresh.read(`views/${written}.ttl`)),
        `<#${written}> <#b> <#c> .`,
      );
    });

    it("opens a pod that another opening writes while it opens, and leaves the other's write in it", async () => {
      const outcomes: string[] = [];
      for (const claimed of [false, true])
        for (const at of ["the first listing", "the index's read"] as const) {
          const memory = new MemoryFiles("urn:test:pod/");
          const key = await earlierPod(memory);
          const writer = await reopened(memory);
          await writer.write(
            VIEW,
            encoded("<#metformin> <#status> <#one> .\n"),
          );
          if (claimed)
            await memory.write(
              UPGRADE_CLAIM,
              await sealedClaim(key, Date.now(), 2),
            );
          const files = landingAt(memory, at, () =>
            writer.write(VIEW, encoded(STOPPED)),
          );
          outcomes.push(await outcomeOf(reopened(files)));
          assert.equal(
            text(await (await reopened(memory)).read(VIEW)),
            STOPPED,
            `${at}${claimed ? ", a claim beside the index" : ""}`,
          );
        }
      assert.deepEqual(outcomes, ["done", "done", "done", "done"]);
    });

    it("tells a writer its write was written, though another opening wrote the next index before it looked, when that index names every file the writer wrote; refuses it when it does not", async () => {
      const told = async (
        another: (pod: EncryptedFiles) => Promise<unknown>,
      ) => {
        const memory = new MemoryFiles("urn:test:pod/");
        await madePod(memory);
        let wrote = false;
        let landed = false;
        const files: Files = {
          iri: memory.iri,
          read: (path) => memory.read(path),
          write: (path, bytes) => memory.write(path, bytes),
          writeNew: async (path, bytes) => {
            const done = await memory.writeNew(path, bytes);
            if (path.startsWith(`${SEALED_INDEX}/`)) wrote = true;
            return done;
          },
          replace: (path, bytes, holds) => memory.replace(path, bytes, holds),
          remove: (paths) => memory.remove(paths),
          list: async (folder) => {
            if (wrote && !landed && folder === SEALED_INDEX) {
              landed = true;
              await another(await reopened(memory));
            }
            return memory.list(folder);
          },
        };
        const writer = await reopened(files);
        const outcome = await outcomeOf(
          writer.writeAll([
            ["views/a.ttl", encoded("<#a> <#b> <#c> .\n")],
            ["views/c.ttl", encoded("<#c> <#b> <#a> .\n")],
          ]),
        );
        return { memory, writer, outcome };
      };
      const elsewhere = await told((other) =>
        other.write("views/b.ttl", encoded("<#b> <#c> <#d> .\n")),
      );
      assert.equal(elsewhere.outcome, "done");
      const fresh = await reopened(elsewhere.memory);
      for (const path of ["views/a.ttl", "views/b.ttl", "views/c.ttl"])
        assert.ok((await fresh.list("views")).includes(path), path);
      assert.equal(
        text(await elsewhere.writer.read("views/a.ttl")),
        "<#a> <#b> <#c> .\n",
        "the writer reads what it was told it wrote",
      );
      const rewritten = await told((other) =>
        other.write("views/a.ttl", encoded("<#a> <#b> <#c> .\n")),
      );
      assert.match(rewritten.outcome, AGAIN);
    });

    it("ends, when two processes write one pod again and again, with a pod that opens and holds every write either was told was written", async () => {
      const at = join(folders, "two-processes");
      await madePod(new FolderFiles(at, undefined, { refuseLinks: true }));
      const writing = (me: string) =>
        promisify(execFile)(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            WRITER,
            new URL("../src/encryption.js", import.meta.url).href,
            new URL("../src/node/folder-files.js", import.meta.url).href,
            at,
            me,
            "20",
          ],
          { timeout: 120_000 },
        ).then(
          ({ stdout }) =>
            JSON.parse(stdout) as { done: string[]; failed: string[] },
        );
      const ran = await Promise.all([writing("a"), writing("b")]);
      assert.deepEqual(
        ran.flatMap(({ failed }) => failed),
        [],
      );
      const done = ran.flatMap(({ done }) => done);
      assert.ok(done.length > 0);
      const pod = await reopened(
        new FolderFiles(at, undefined, { refuseLinks: true }),
      );
      const held = await pod.list("notes");
      for (const path of done) {
        assert.ok(held.includes(path), path);
        const [, me, n] = /^notes\/(\w)-(\d+)\.ttl$/.exec(path) ?? [];
        assert.equal(text(await pod.read(path)), `<#${me}> <#n> ${n} .`);
      }
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
        files.restart();
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

    it("leaves a pod that opens with the same files, as 1.2 until the 1.3 header is written, wherever the upgrade stopped, and wherever the upgrade that resumed it stopped again", async () => {
      const upgraded = async (first: number, second: number) => {
        const files = new StoppingFiles();
        await earlierPod(files.memory);
        files.stopAt = first;
        await reopened(files).catch(() => undefined);
        const version = await versionIn(files);
        files.restart();
        const resumed = files.changes.length;
        if (second > 0) {
          files.stopAt = resumed + second;
          await reopened(files, { claimHolds: 0 }).catch(() => undefined);
          files.restart();
        }
        return { files, version, resumed };
      };
      const whole = new StoppingFiles();
      await earlierPod(whole.memory);
      await reopened(whole);
      const steps = whole.changes.length;
      assert.ok(steps >= 5, whole.changes.join("\n"));
      const seen = new Set<string>();
      for (let first = 1; first <= steps; first++) {
        const { files: dry, resumed } = await upgraded(first, 0);
        await reopened(dry, { claimHolds: 0 });
        const again = dry.changes.length - resumed;
        for (let second = 0; second <= again; second++) {
          const { files, version } = await upgraded(first, second);
          seen.add(version);
          const stopped = `stopped at ${whole.changes[first - 1]}, then at change ${second} of the resume`;
          const opened = await reopened(files, { claimHolds: 0 });
          assert.deepEqual(await readAs(opened), WRITTEN, stopped);
          assert.equal(await versionIn(files), "1.3", stopped);
          const stored = await files.memory.list("");
          for (const path of [UPGRADE_CLAIM, ...FILES.map(([path]) => path)])
            assert.equal(
              stored.includes(path),
              path === "README.md",
              `${stopped}: ${path}`,
            );
        }
      }
      assert.deepEqual([...seen].sort(), ["1.2", "1.3"]);
    });

    it("states the file count in the claim a stop before the index leaves, though a renewal that began before the count was set lands after it", async () => {
      mock.timers.enable({ apis: ["setInterval"] });
      try {
        const memory = new MemoryFiles("urn:test:pod/");
        const key = await earlierPod(memory);
        let ticked = false;
        let held: Promise<void> | undefined;
        let release = () => {};
        const files: Files = {
          iri: memory.iri,
          read: async (path) => {
            if (!ticked && path !== HEADER && path !== UPGRADE_CLAIM) {
              ticked = true;
              mock.timers.tick(5000);
            }
            return memory.read(path);
          },
          write: async (path, bytes) => {
            if (
              path === UPGRADE_CLAIM &&
              held === undefined &&
              !/; \d+ files/.test(await claimSays(key, bytes))
            ) {
              held = new Promise<void>((resolve) => {
                release = resolve;
                setTimeout(resolve, 100);
              });
              await held;
            }
            return memory.write(path, bytes);
          },
          writeNew: async (path, bytes) => {
            if (path.startsWith(`${SEALED_INDEX}/`)) {
              release();
              throw new Error("stopped before the index");
            }
            return memory.writeNew(path, bytes);
          },
          replace: (path, bytes, holds) => memory.replace(path, bytes, holds),
          remove: (paths) => memory.remove(paths),
          list: (folder) => memory.list(folder),
        };
        await assert.rejects(reopened(files), /stopped before the index/);
        assert.ok(held !== undefined, "a renewal without the count was slow");
        assert.equal(await versionIn(memory), "1.3");
        const resumed = await reopened(memory, { claimHolds: 0 });
        assert.deepEqual(await readAs(resumed), WRITTEN);
      } finally {
        mock.timers.reset();
      }
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
      assert.equal(files.indexWrites(), 1, files.changes.join("\n"));
      assert.equal(files.count(HEADER), 1);
    });

    it("waits on another opening's claim while it holds, and takes over one it has held too long", async () => {
      const files = new MemoryFiles("urn:test:pod/");
      const key = await earlierPod(files);
      await files.write(UPGRADE_CLAIM, await sealedClaim(key, Date.now()));
      const waited = await Promise.race([
        reopened(files, { lookEvery: 5 }).then(() => "opened"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 200)),
      ]);
      assert.equal(waited, "waiting");
      await reopened(files, { claimHolds: 0 });
      assert.equal(await versionIn(files), "1.3");
    });

    it("upgrades a pod holding files at no path the layout uses that do not open, and leaves them where they are", async () => {
      const files = new MemoryFiles("urn:test:pod/");
      await earlierPod(files);
      await files.write(".DS_Store", encoded("by the system"));
      await files.write("notes/mine.txt", encoded("by the person"));
      const pod = await reopened(files, { laidOut });
      assert.equal(await versionIn(files), "1.3");
      assert.deepEqual(await readAs(pod), WRITTEN);
      assert.equal(text(await files.read(".DS_Store")), "by the system");
      assert.equal(text(await files.read("notes/mine.txt")), "by the person");
    });

    it("refuses with `changed outside the runtime` a pod holding a file at a path the layout uses that does not open, and leaves it a whole 1.2 pod with no claim", async () => {
      const files = new MemoryFiles("urn:test:pod/");
      await earlierPod(files);
      await files.write(
        "clinical/medications/aa/aa00.ttl",
        encoded("<#x> a <#Medication> ."),
      );
      const held = await files.list("");
      assert.equal(
        await outcomeOf(reopened(files, { laidOut })),
        "changed outside the runtime",
      );
      assert.equal(await versionIn(files), "1.2");
      assert.deepEqual(await files.list(""), held);
    });
  });
});
