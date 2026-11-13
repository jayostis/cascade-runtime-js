import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CorePod } from "../src/core-pod.js";
import {
  type DeriveKey,
  EncryptedFiles,
  type EncryptedFilesOptions,
  HEADER,
  madeNewPod,
  newHeader,
  openHeader,
  SEALED_INDEX,
  SealedIndex,
  Unopened,
} from "../src/encryption.js";
import { type Files, MemoryFiles, relative } from "../src/files.js";
import { randomId } from "../src/ids.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { Refusal } from "../src/step.js";
import { argon2idOnce, podEncryptionVectors } from "./pod-encryption.js";
import { layout, RUNTIME } from "./vocabulary.js";

const SECRET = "abacus abdomen abdominal abide abiding zoom";
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const encoded = (value: string) => new TextEncoder().encode(value);

/** A stand-in for Argon2id, a hash of what it is given, counting its calls. */
function fastDerive(): DeriveKey & { calls: number } {
  const derive = async (
    secret: Uint8Array,
    salt: Uint8Array,
    params: { t: number; m: number; p: number },
  ) => {
    derive.calls += 1;
    const input = new Uint8Array([
      ...secret,
      ...salt,
      params.t,
      params.m,
      params.p,
    ]);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  };
  derive.calls = 0;
  return derive;
}

/** The outcome an `Unopened` gives, or "opened". */
async function outcomeOf(opening: Promise<unknown>): Promise<string> {
  try {
    await opening;
    return "opened";
  } catch (error) {
    if (error instanceof Unopened) return error.outcome;
    throw error;
  }
}

async function sealedPod(options?: EncryptedFilesOptions) {
  const memory = new MemoryFiles("urn:test:pod/");
  const derive = fastDerive();
  const made = await newHeader(SECRET, derive);
  const { bytes, key } = made;
  assert.ok(await madeNewPod(memory, made));
  const index = await SealedIndex.open(memory, key);
  return {
    memory,
    derive,
    key,
    header: bytes,
    files: new EncryptedFiles(memory, key, { ...options, index }),
  };
}

/** The sealed files a pod stores, by their keyed names: all but its header and its index. */
const keyedFiles = async (memory: Files) =>
  (await memory.list("sealed")).filter(
    (path) => !path.startsWith(`${SEALED_INDEX}/`),
  );

/** A sealed pod holding `a.ttl` and `b/c.ttl`, read through files that record the path of each read made of them once opened. */
async function countingPod() {
  const { memory, files } = await sealedPod();
  await files.writeAll([
    ["a.ttl", encoded("a")],
    ["b/c.ttl", encoded("c")],
  ]);
  const reads: string[] = [];
  const counted: Files = {
    iri: memory.iri,
    read: (path) => {
      reads.push(relative(memory, path));
      return memory.read(path);
    },
    write: (path, bytes) => memory.write(path, bytes),
    list: (folder) => memory.list(folder),
  };
  const key = await openHeader(
    (await memory.read(HEADER)) ?? new Uint8Array(),
    SECRET,
    fastDerive(),
  );
  const pod = new EncryptedFiles(counted, key, {
    index: await SealedIndex.open(counted, key),
  });
  reads.length = 0;
  return { pod, reads, memory };
}

/** The pod's negative vectors, each opened with `derive`, by the outcome it gave. */
async function negativeOutcomes(derive: DeriveKey) {
  const { folder, vectors } = await podEncryptionVectors();
  const negative = vectors.filter(({ id }) => id.startsWith("N-"));
  assert.equal(negative.length, 70);
  const outcomes = await Promise.all(
    negative.map(async ({ id, header, tryWith, expect }) => ({
      id,
      expected: expect.replace("-", " "),
      outcome: await outcomeOf(
        openHeader(await readFile(join(folder, header)), tryWith, derive),
      ),
    })),
  );
  return outcomes;
}

/**
 * A sealed pod keeps every file encrypted under a key derived from its owner's secret; only its header,
 * `settings/encryption.json`, stays readable, and says how the key is derived. `openHeader()` gives the key for a header
 * and a secret or throws `Unopened` with the reason, and `EncryptedFiles` reads and writes the pod's files under that
 * key.
 */
describe("Sealing a pod's files · newHeader(), openHeader(), EncryptedFiles", () => {
  /**
   * The pod encryption vectors of the conformance repository, `pod-encryption/vectors.json` (`test/pod-encryption.ts`):
   * headers other implementations wrote that must open or be refused with an outcome, and fixtures, whole pods and
   * envelopes sealed elsewhere together with the secrets that open them. Key derivation is the real Argon2id where a
   * vector must open, and a stand-in where it must not.
   */
  describe("given the pod encryption vectors (`pod-encryption/vectors.json`)", () => {
    it("throws Unopened with the outcome each of the vectors to refuse states", async () => {
      const outcomes = await negativeOutcomes(fastDerive());
      for (const { id, expected, outcome } of outcomes)
        assert.equal(outcome, expected, id);
    });

    it("derives no key for a header it refuses", async () => {
      const derive = fastDerive();
      await negativeOutcomes(derive);
      assert.equal(derive.calls, 0);
    });

    it("returns a 256-bit key for each of the vectors to accept", async () => {
      const { folder, vectors } = await podEncryptionVectors();
      const accept = vectors.filter(({ id }) => id.startsWith("A-"));
      assert.equal(accept.length, 14);
      for (const { id, header, tryWith } of accept) {
        const { key } = await openHeader(
          await readFile(join(folder, header)),
          tryWith,
          argon2idOnce,
        );
        assert.equal((key.algorithm as AesKeyAlgorithm).length, 256, id);
      }
    });

    it("reads, with each secret of each fixture sealed by another implementation, the files that fixture holds", async () => {
      const { folder, positive } = await podEncryptionVectors();
      assert.equal(positive.length, 5);
      for (const fixture of positive) {
        const at = join(folder, ...fixture.path.split("/"));
        const files = new FolderFiles(at);
        if (fixture.layout === "envelope") {
          const header = await readFile(join(at, "encryption.json"));
          assert.ok(fixture.passphrases.length > 0, fixture.id);
          for (const secret of fixture.passphrases) {
            const key = await openHeader(header, secret, argon2idOnce);
            assert.equal(
              text(await new EncryptedFiles(files, key).read("resource.bin")),
              await readFile(join(at, "plaintext.txt"), "utf8"),
              `${fixture.id} with ${secret}`,
            );
          }
          continue;
        }
        const header = await readFile(join(at, ...HEADER.split("/")));
        const [secret = ""] = fixture.passphrases;
        const pod = new EncryptedFiles(
          files,
          await openHeader(header, secret, argon2idOnce),
        );
        const sealed = (await files.list("")).filter(
          (path) => path !== HEADER && path !== "README.md",
        );
        assert.ok(sealed.length > 0, `${fixture.id} holds no sealed file`);
        for (const path of sealed)
          assert.ok(
            (await pod.read(path)) !== undefined,
            `${fixture.id}: ${path}`,
          );
      }
    });

    it("throws Unopened, `incorrect secret`, for a secret a fixture must not open with", async () => {
      const { folder, positive } = await podEncryptionVectors();
      let tried = 0;
      for (const fixture of positive)
        for (const wrong of fixture.mustNotOpenWith ?? []) {
          tried += 1;
          const header = await readFile(
            join(folder, ...fixture.path.split("/"), ...HEADER.split("/")),
          );
          assert.equal(
            await outcomeOf(openHeader(header, wrong, argon2idOnce)),
            "incorrect secret",
            `${fixture.id} with ${wrong}`,
          );
        }
      assert.ok(tried > 0, "no fixture names a secret it must not open with");
    });
  });

  describe("newHeader(secret, derive)", () => {
    it("writes a header of version 1.3 that states `resourceFormat` 3", async () => {
      const { header } = await sealedPod();
      const stated = JSON.parse(text(header)) as Record<string, unknown>;
      assert.equal(stated.version, "1.3");
      assert.equal(stated.resourceFormat, 3);
    });
  });

  describe("given a 1.3 header whose `resourceFormat` was edited", () => {
    it("throws Unopened, `malformed`, with no key derived, when it is missing, a string, written `3.0`, or 2", async () => {
      const { header } = await sealedPod();
      const written = text(header);
      const stated = JSON.parse(written) as Record<string, unknown>;
      const derive = fastDerive();
      for (const [edit, edited] of [
        ["missing", JSON.stringify({ ...stated, resourceFormat: undefined })],
        [
          "a string",
          written.replace('"resourceFormat": 3', '"resourceFormat": "3"'),
        ],
        [
          "written 3.0",
          written.replace('"resourceFormat": 3', '"resourceFormat": 3.0'),
        ],
        [
          "2, a 1.2 pod's",
          written.replace('"resourceFormat": 3', '"resourceFormat": 2'),
        ],
      ] as const) {
        assert.notEqual(edited, written, `${edit}: the header was not edited`);
        assert.equal(
          await outcomeOf(openHeader(encoded(edited), SECRET, derive)),
          "malformed",
          edit,
        );
      }
      assert.equal(derive.calls, 0);
    });
  });

  /** Each leaf seals its own pod in memory, under a header made with a stand-in for Argon2id. */
  describe("EncryptedFiles", () => {
    it("reads back what `writeAll()` sealed", async () => {
      const { files } = await sealedPod();
      await files.writeAll([
        ["a.ttl", encoded("<#a> <#b> <#c> .")],
        ["b.ttl", encoded("<#d> <#e> <#f> .")],
      ]);
      assert.equal(text(await files.read("a.ttl")), "<#a> <#b> <#c> .");
      assert.equal(text(await files.read("b.ttl")), "<#d> <#e> <#f> .");
    });

    it("throws Unopened, `changed outside the runtime`, naming the path, for two sealed files swapped", async () => {
      const { memory, files } = await sealedPod();
      await files.writeAll([
        ["a.ttl", encoded("<#a> <#b> <#c> .")],
        ["b.ttl", encoded("<#d> <#e> <#f> .")],
      ]);
      const [one = "", other = ""] = await keyedFiles(memory);
      const [first, second] = [
        await memory.read(one),
        await memory.read(other),
      ];
      await memory.write(one, second ?? new Uint8Array());
      await memory.write(other, first ?? new Uint8Array());
      for (const path of ["a.ttl", "b.ttl"])
        await assert.rejects(files.read(path), (error) => {
          assert.ok(error instanceof Unopened, path);
          assert.equal(error.outcome, "changed outside the runtime");
          assert.match(
            error.message,
            new RegExp(`: ${path.replace(".", "\\.")} `),
          );
          return true;
        });
    });

    it("throws Refusal for a 1.2 pod's file read under the same header restated as version 1.1", async () => {
      const memory = new MemoryFiles("urn:test:pod/");
      const { bytes, key } = await newHeader(SECRET, fastDerive());
      await memory.write(HEADER, bytes);
      await new EncryptedFiles(memory, { ...key, version: "1.2" }).write(
        "a.ttl",
        encoded("<#a> <#b> <#c> ."),
      );
      await assert.rejects(
        new EncryptedFiles(memory, { ...key, version: "1.1" }).read("a.ttl"),
        Refusal,
      );
    });

    it("lists the pod's files without its header, and reads none of them to do so", async () => {
      const { pod, reads } = await countingPod();
      assert.deepEqual(await pod.list(""), ["a.ttl", "b/c.ttl"]);
      assert.deepEqual(reads, []);
    });

    it("reads from the pod only the file whose path it is asked for", async () => {
      const { pod, reads } = await countingPod();
      assert.equal(text(await pod.read("b/c.ttl")), "c");
      assert.equal(reads.length, 1);
      assert.match(reads[0] ?? "", /^sealed\/[0-9a-f]{2}\/[0-9a-f]{62}$/);
    });

    it("rejects a write to the header, as its path is spelled and in another letter case", async () => {
      const { files } = await sealedPod();
      await assert.rejects(
        files.write(HEADER, encoded("{}")),
        /is written only when the pod's encryption is made/,
        HEADER,
      );
      await assert.rejects(
        files.write("Settings/Encryption.json", encoded("{}")),
        /is written only when/,
        "Settings/Encryption.json",
      );
    });

    it("rejects a write and a read of a path that is not canonical", async () => {
      const { files } = await sealedPod();
      for (const path of [
        "./a.ttl",
        "settings//encryption.json",
        "a/./b.ttl",
        "a/../b.ttl",
        "/a.ttl",
        "settings\\encryption.json",
      ]) {
        await assert.rejects(
          files.write(path, encoded("{}")),
          /not a canonical path/,
          `write ${path}`,
        );
        await assert.rejects(
          files.read(path),
          /not a canonical path/,
          `read ${path}`,
        );
      }
    });

    it("seals nothing for a write it rejects", async () => {
      const { memory, files } = await sealedPod();
      await files.write("a.ttl", encoded("a"));
      const held = await memory.list("");
      for (const path of [
        HEADER,
        "Settings/Encryption.json",
        "./a.ttl",
        "a/../b.ttl",
        "/a.ttl",
      ])
        await assert.rejects(files.write(path, encoded("{}")), Error, path);
      assert.deepEqual(await memory.list(""), held);
    });

    it("rejects a read of a file whose bytes changed after it was sealed", async () => {
      const { memory, files } = await sealedPod();
      await files.write("a.ttl", encoded("a"));
      const [stored = ""] = await keyedFiles(memory);
      await memory.write(stored, encoded("tampered"));
      await assert.rejects(files.read("a.ttl"), /changed outside the runtime/);
    });

    it("rejects a write, and a read of a file that no longer opens, once the header in the pod has changed, saying to open the pod again", async () => {
      const { memory, files, header } = await sealedPod();
      await files.write("a.ttl", encoded("a"));
      const [stored = ""] = await keyedFiles(memory);
      await memory.write(stored, encoded("tampered"));
      await memory.write(HEADER, new Uint8Array([...header, 0x0a]));
      const held = await memory.list("");
      const changed =
        /the pod's header changed since it was opened; open it again/;
      await assert.rejects(
        files.write("b.ttl", encoded("b")),
        changed,
        "write",
      );
      await assert.rejects(files.read("a.ttl"), changed, "read");
      assert.deepEqual(await memory.list(""), held);
    });
  });

  /** `CorePod.create()` writes the pod's first files; a file over `maxBytes` cannot be sealed as one file. */
  describe("given a step that writes a file larger than the sealing limit (`maxBytes`)", () => {
    it("returns the reason in `refused`, and leaves the pod holding its header and its empty index alone", async () => {
      const { memory, files } = await sealedPod({ maxBytes: 64 });
      const pod = new CorePod({
        runtime: RUNTIME,
        pod: files,
        address: "https://pod.example/",
        subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
        title: "",
        vocabulary: new MemoryFiles("https://vocabulary.example/"),
        layout: await layout(),
        newStore: () => new OxigraphStore(),
        time: { newId: randomId, now: () => "2026-02-01T08:00:00Z" },
        importers: [],
        references: () => Promise.reject(new Error("no tables")),
      });
      const created = await pod.create();
      assert.match(created.refused ?? "", /too large to seal as one file/);
      assert.deepEqual(await memory.list(""), [`${SEALED_INDEX}/0`, HEADER]);
    });
  });
});
