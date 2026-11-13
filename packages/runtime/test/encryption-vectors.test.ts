import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ARGON2_PARAMS,
  type Argon2Params,
  type DeriveKey,
  EncryptedFiles,
  HEADER,
  madeNewPod,
  newHeader,
  openHeader,
  SEALED_INDEX,
  SealedIndex,
  Unopened,
} from "../src/encryption.js";
import { MemoryFiles } from "../src/files.js";
import { Refusal } from "../src/step.js";
import { argon2idOnce, type Positive } from "./pod-encryption.js";

interface KnownAnswer extends Positive {
  readonly header: string;
  readonly files: readonly {
    readonly path: string;
    readonly plaintext: string;
    readonly sealed: string;
  }[];
}

const VECTORS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "vectors",
  "pod-encryption-1.2.json",
);

const SECRET = "tide ember lantern quartz meadow violet";
const encoded = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const bytesOf = (base64: string) =>
  new Uint8Array(Buffer.from(base64, "base64"));

async function knownAnswers(): Promise<readonly KnownAnswer[]> {
  const read = JSON.parse(await readFile(VECTORS, "utf8")) as {
    positive: KnownAnswer[];
  };
  return read.positive;
}

/** A pod's header and its sealed resources as a second implementation wrote them, in memory. */
async function podOf(vector: KnownAnswer) {
  const memory = new MemoryFiles("urn:test:pod/");
  await memory.write(HEADER, encoded(vector.header));
  for (const { path, sealed } of vector.files)
    await memory.write(path, bytesOf(sealed));
  return memory;
}

/** A stand-in for Argon2id with a key it makes up from the salt, keeping what each call was given. */
function recordingDerive() {
  const calls: {
    secret: Uint8Array;
    salt: Uint8Array;
    params: Argon2Params;
  }[] = [];
  const derive: DeriveKey = async (secret, salt, params) => {
    calls.push({
      secret: new Uint8Array(secret),
      salt: new Uint8Array(salt),
      params: { ...params },
    });
    return new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(salt)),
    );
  };
  return { derive, calls };
}

const aesKey = (raw: Uint8Array) =>
  crypto.subtle.importKey(
    "raw",
    new Uint8Array(raw),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

/** What `nonce || ciphertext || tag` decrypts to under the key and additional data, by WebCrypto alone. */
async function decrypted(
  key: CryptoKey,
  sealed: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(sealed.subarray(0, 12)),
        tagLength: 128,
        ...(additionalData === undefined
          ? {}
          : { additionalData: new Uint8Array(additionalData) }),
      },
      key,
      new Uint8Array(sealed.subarray(12)),
    ),
  );
}

/** The 1.2 additional data of a pod's file, built by hand from `pod-encryption.md` D-SEAL-1: `cascade-pod-resource`, `2`, the path, each followed by a zero byte but the last. */
const boundToPath = (path: string) =>
  new Uint8Array([
    ...encoded("cascade-pod-resource"),
    0,
    ...encoded("2"),
    0,
    ...encoded(path),
  ]);

const headerOf = (bytes: Uint8Array) =>
  JSON.parse(text(bytes)) as {
    wraps: { kdfParams: Record<string, unknown>; wrappedDek: string }[];
  };

/**
 * The 1.2 sealing of a pod, checked against what other code computed: known-answer pods that must open to their stated
 * plaintext, and what `newHeader()` and `EncryptedFiles` write, taken apart here with WebCrypto and a hand-built
 * additional data, so that a fault on both sides of a round trip is no longer a pass.
 */
describe("Matching a 1.2 pod's sealing against known answers · newHeader(), openHeader(), EncryptedFiles", () => {
  /**
   * `test/vectors/pod-encryption-1.2.json`: pods computed with libargon2 (argon2-cffi) and `cryptography`, as plain JSON,
   * in the entry shape of the conformance repository's `pod-encryption/vectors.json` `positive` list.
   */
  describe("given the known-answer 1.2 pods (`pod-encryption-1.2.json`)", () => {
    it("reads, with each secret of each pod, the plaintext each sealed resource holds", async () => {
      const vectors = await knownAnswers();
      assert.equal(vectors.length, 2);
      for (const vector of vectors) {
        assert.equal(vector.layout, "pod", vector.id);
        const memory = await podOf(vector);
        assert.ok(vector.passphrases.length > 0, vector.id);
        for (const secret of vector.passphrases) {
          const files = new EncryptedFiles(
            memory,
            await openHeader(encoded(vector.header), secret, argon2idOnce),
          );
          for (const { path, plaintext } of vector.files)
            assert.equal(
              text(await files.read(path)),
              plaintext,
              `${vector.id} ${path} with ${secret}`,
            );
        }
      }
    });

    it("throws Unopened, `incorrect secret`, for a secret a pod must not open with", async () => {
      let tried = 0;
      for (const vector of await knownAnswers())
        for (const wrong of vector.mustNotOpenWith ?? []) {
          tried += 1;
          await assert.rejects(
            openHeader(encoded(vector.header), wrong, argon2idOnce),
            (error: unknown) =>
              error instanceof Unopened && error.outcome === "incorrect secret",
            `${vector.id} with ${wrong}`,
          );
        }
      assert.equal(tried, 2);
    });

    it("throws a Refusal for a sealed resource stored at another path", async () => {
      const [vector] = await knownAnswers();
      assert.ok(vector !== undefined && vector.files.length >= 2);
      const [first, second] = vector.files;
      const memory = await podOf(vector);
      await memory.write(second?.path ?? "", bytesOf(first?.sealed ?? ""));
      const files = new EncryptedFiles(
        memory,
        await openHeader(
          encoded(vector.header),
          vector.passphrases[0] ?? "",
          argon2idOnce,
        ),
      );
      await assert.rejects(
        files.read(second?.path ?? ""),
        (error: unknown) =>
          error instanceof Refusal && !(error instanceof Unopened),
      );
    });
  });

  describe("newHeader(secret, derive)", () => {
    it("asks derive for the secret's UTF-8 bytes under a 16-byte salt and t=3, m=65536, p=1, and states the salt and those numbers in the header", async () => {
      const { derive, calls } = recordingDerive();
      const { bytes } = await newHeader("pässwörd ✓", derive);
      assert.equal(calls.length, 1);
      const [call] = calls;
      assert.deepEqual([...(call?.secret ?? [])], [...encoded("pässwörd ✓")]);
      assert.equal(call?.salt.length, 16);
      assert.deepEqual(call?.params, { t: 3, m: 65536, p: 1 });
      assert.deepEqual(ARGON2_PARAMS, { t: 3, m: 65536, p: 1 });
      const [wrap] = headerOf(bytes).wraps;
      assert.deepEqual(wrap?.kdfParams, {
        salt: Buffer.from(call?.salt ?? []).toString("base64"),
        t: 3,
        m: 65536,
        p: 1,
      });
    });

    it("wraps a 32-byte data key under the key derive returned, with a nonce that is not another header's", async () => {
      const wraps: Uint8Array[] = [];
      for (let made = 0; made < 2; made++) {
        const { derive } = recordingDerive();
        const { bytes } = await newHeader(SECRET, derive);
        const [wrap] = headerOf(bytes).wraps;
        const wrapped = bytesOf(wrap?.wrappedDek ?? "");
        assert.equal(wrapped.length, 60);
        wraps.push(wrapped);
        const salt = bytesOf(String(wrap?.kdfParams["salt"]));
        const kek = new Uint8Array(await crypto.subtle.digest("SHA-256", salt));
        const dek = await decrypted(await aesKey(kek), wrapped);
        assert.equal(dek.length, 32);
      }
      assert.notDeepEqual(
        [...(wraps[0]?.subarray(0, 12) ?? [])],
        [...(wraps[1]?.subarray(0, 12) ?? [])],
      );
    });
  });

  /** A 1.2 key's files are sealed as a 1.2 pod seals them: an upgrade's claim is one, for a 1.2 runtime to read. */
  describe("given EncryptedFiles under a 1.2 key", () => {
    it("seals a file under the pod's data key, bound to `cascade-pod-resource`, `2` and its path, with a new nonce for each seal", async () => {
      const { derive } = recordingDerive();
      const { bytes, key } = await newHeader(SECRET, derive);
      const memory = new MemoryFiles("urn:test:pod/");
      await memory.write(HEADER, bytes);
      const files = new EncryptedFiles(memory, { ...key, version: "1.2" });
      const [wrap] = headerOf(bytes).wraps;
      const salt = bytesOf(String(wrap?.kdfParams["salt"]));
      const kek = new Uint8Array(await crypto.subtle.digest("SHA-256", salt));
      const dek = await aesKey(
        await decrypted(await aesKey(kek), bytesOf(wrap?.wrappedDek ?? "")),
      );
      const same = encoded("<#a> <#b> <#c> .\n");
      await files.writeAll([
        ["a/one.ttl", same],
        ["a/two.ttl", same],
      ]);
      const first = await memory.read("a/one.ttl");
      await files.write("a/one.ttl", same);
      const stored = [
        ["a/one.ttl", first],
        ["a/two.ttl", await memory.read("a/two.ttl")],
        ["a/one.ttl", await memory.read("a/one.ttl")],
      ] as const;
      for (const [path, sealed] of stored) {
        assert.ok(sealed !== undefined, path);
        assert.deepEqual(
          [...(await decrypted(dek, sealed, boundToPath(path)))],
          [...same],
          path,
        );
        await assert.rejects(
          decrypted(dek, sealed, boundToPath(`${path}x`)),
          `${path} bound to another path`,
        );
      }
      const nonces = new Set<string>();
      for (const [, sealed] of stored)
        nonces.add(Buffer.from(sealed?.subarray(0, 12) ?? []).toString("hex"));
      assert.equal(nonces.size, 3, "two seals of the same bytes share a nonce");
    });
  });
});

interface KnownAnswer13 extends Positive {
  readonly header: string;
  readonly files: readonly {
    readonly path: string;
    readonly plaintext: string;
    readonly stored: string;
    readonly sealed: string;
  }[];
  readonly index: {
    readonly stored: string;
    readonly plaintext: string;
    readonly sealed: string;
  };
}

async function knownAnswers13(): Promise<readonly KnownAnswer13[]> {
  const read = JSON.parse(
    await readFile(VECTORS.replace("1.2.json", "1.3.json"), "utf8"),
  ) as { positive: KnownAnswer13[] };
  return read.positive;
}

/** A 1.3 pod as a second implementation stored it: its header, each sealed resource at its keyed name, its index. */
async function pod13Of(vector: KnownAnswer13) {
  const memory = new MemoryFiles("urn:test:pod/");
  await memory.write(HEADER, encoded(vector.header));
  for (const { stored, sealed } of vector.files)
    await memory.write(stored, bytesOf(sealed));
  await memory.write(vector.index.stored, bytesOf(vector.index.sealed));
  return memory;
}

/** The 1.3 additional data of a pod's file, by hand: `cascade-pod-resource`, `3`, the path, each but the last followed by a zero byte. */
const boundToPath13 = (path: string) =>
  new Uint8Array([
    ...encoded("cascade-pod-resource"),
    0,
    ...encoded("3"),
    0,
    ...encoded(path),
  ]);

/**
 * The 1.3 sealing of a pod, checked against what other code computed: known-answer pods whose resources are stored
 * under keyed names and listed by a sealed index, and what `EncryptedFiles` writes, taken apart with WebCrypto and
 * Node's own HKDF and HMAC.
 */
describe("Matching a 1.3 pod's sealing against known answers · SealedIndex.open(), EncryptedFiles", () => {
  /** `test/vectors/pod-encryption-1.3.json`: pods computed with libargon2 (argon2-cffi) and `cryptography`, as plain JSON. */
  describe("given the known-answer 1.3 pods (`pod-encryption-1.3.json`)", () => {
    it("lists, and reads with each secret of each pod, the plaintext each sealed resource holds", async () => {
      const vectors = await knownAnswers13();
      assert.equal(vectors.length, 2);
      for (const vector of vectors) {
        const memory = await pod13Of(vector);
        for (const secret of vector.passphrases) {
          const key = await openHeader(
            encoded(vector.header),
            secret,
            argon2idOnce,
          );
          const files = new EncryptedFiles(memory, key, {
            index: await SealedIndex.open(memory, key),
          });
          assert.deepEqual(
            await files.list(""),
            vector.files.map(({ path }) => path).sort(),
            vector.id,
          );
          for (const { path, plaintext } of vector.files)
            assert.equal(
              text(await files.read(path)),
              plaintext,
              `${vector.id} ${path} with ${secret}`,
            );
        }
      }
    });

    it("throws Unopened, `changed outside the runtime`, for a resource stored under another's keyed name", async () => {
      const [vector] = await knownAnswers13();
      const [first, second] = vector?.files ?? [];
      assert.ok(vector !== undefined && first && second);
      const memory = await pod13Of(vector);
      await memory.write(second.stored, bytesOf(first.sealed));
      const key = await openHeader(
        encoded(vector.header),
        vector.passphrases[0] ?? "",
        argon2idOnce,
      );
      const files = new EncryptedFiles(memory, key, {
        index: await SealedIndex.open(memory, key),
      });
      await assert.rejects(
        files.read(second.path),
        (error: unknown) =>
          error instanceof Unopened &&
          error.outcome === "changed outside the runtime",
      );
    });
  });

  describe("given EncryptedFiles over a new header's sealed index", () => {
    it("stores each file at `sealed/` and the hex HMAC, under HKDF of the data key, of its path, a zero byte and its tag; sealed bound to `cascade-pod-resource`, `3` and its path; named by an index bound to `cascade-pod-index`, `3`", async () => {
      const { derive } = recordingDerive();
      const made = await newHeader(SECRET, derive);
      const { bytes, key } = made;
      const memory = new MemoryFiles("urn:test:pod/");
      assert.ok(await madeNewPod(memory, made));
      const files = new EncryptedFiles(memory, key, {
        index: await SealedIndex.open(memory, key),
      });
      const same = encoded("<#a> <#b> <#c> .\n");
      await files.writeAll([
        ["a/one.ttl", same],
        ["b/two.ttl", same],
      ]);
      const [wrap] = headerOf(bytes).wraps;
      const salt = bytesOf(String(wrap?.kdfParams["salt"]));
      const kek = new Uint8Array(await crypto.subtle.digest("SHA-256", salt));
      const raw = await decrypted(
        await aesKey(kek),
        bytesOf(wrap?.wrappedDek ?? ""),
      );
      const dek = await aesKey(raw);
      const names = Buffer.from(
        hkdfSync("sha256", raw, new Uint8Array(), "cascade-pod-names", 32),
      );
      const index = JSON.parse(
        text(
          await decrypted(
            dek,
            (await memory.read(`${SEALED_INDEX}/1`)) ?? new Uint8Array(),
            new Uint8Array([
              ...encoded("cascade-pod-index"),
              0,
              ...encoded("3"),
            ]),
          ),
        ),
      ) as { counter: number; files: [string, string, string][] };
      assert.equal(index.counter, 1);
      assert.deepEqual(
        index.files.map(([path]) => path),
        ["a/one.ttl", "b/two.ttl"],
      );
      const stored: string[] = [];
      for (const [path, name, tag] of index.files) {
        const at = `sealed/${name.slice(0, 2)}/${name.slice(2)}`;
        stored.push(at);
        const sealed = (await memory.read(at)) ?? new Uint8Array();
        assert.equal(Buffer.from(sealed.subarray(-16)).toString("hex"), tag);
        assert.equal(
          createHmac("sha256", names)
            .update(
              Buffer.concat([
                encoded(path),
                Buffer.from([0]),
                sealed.subarray(-16),
              ]),
            )
            .digest("hex"),
          name,
          path,
        );
        assert.deepEqual(
          [...(await decrypted(dek, sealed, boundToPath13(path)))],
          [...same],
          path,
        );
        await assert.rejects(
          decrypted(dek, sealed, boundToPath13(`${path}x`)),
          `${path} bound to another path`,
        );
      }
      assert.deepEqual(
        await memory.list("sealed"),
        [...stored, `${SEALED_INDEX}/1`].sort(),
      );
    });
  });
});
