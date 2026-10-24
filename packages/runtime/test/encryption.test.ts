import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CorePod } from "../src/core-pod.js";
import {
  type DeriveKey,
  EncryptedFiles,
  type EncryptedFilesOptions,
  HEADER,
  newHeader,
  openHeader,
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
  const { bytes, key } = await newHeader(SECRET, derive);
  await memory.write(HEADER, bytes);
  return {
    memory,
    derive,
    header: bytes,
    files: new EncryptedFiles(memory, key, options),
  };
}

test("each negative vector is refused with its outcome before any key is derived", async () => {
  const { folder, vectors } = await podEncryptionVectors();
  const negative = vectors.filter(({ id }) => id.startsWith("N-"));
  assert.equal(negative.length, 70);
  const derive = fastDerive();
  const outcomes = await Promise.all(
    negative.map(async ({ id, header, tryWith }) => [
      id,
      await outcomeOf(
        openHeader(await readFile(join(folder, header)), tryWith, derive),
      ),
    ]),
  );
  assert.deepEqual(
    Object.fromEntries(outcomes),
    Object.fromEntries(
      negative.map(({ id, expect }) => [id, expect.replace("-", " ")]),
    ),
  );
  assert.equal(derive.calls, 0);
});

test("each accept vector opens with its key", async () => {
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

test("each positive fixture opens with each of its keys, its files with the key, and not with a key it must not", async () => {
  const { folder, positive } = await podEncryptionVectors();
  assert.equal(positive.length, 5);
  for (const fixture of positive) {
    const at = join(folder, ...fixture.path.split("/"));
    if (fixture.layout === "envelope") {
      const files = new FolderFiles(at);
      const header = await readFile(join(at, "encryption.json"));
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
    const files = new FolderFiles(at);
    const header = await readFile(join(at, ...HEADER.split("/")));
    const [secret = ""] = fixture.passphrases;
    const pod = new EncryptedFiles(
      files,
      await openHeader(header, secret, argon2idOnce),
    );
    const sealed = (await files.list("")).filter(
      (path) => path !== HEADER && path !== "README.md",
    );
    assert.ok(sealed.length > 0);
    for (const path of sealed)
      assert.ok((await pod.read(path)) !== undefined, path);
    for (const wrong of fixture.mustNotOpenWith ?? [])
      assert.equal(
        await outcomeOf(openHeader(header, wrong, argon2idOnce)),
        "incorrect secret",
      );
  }
});

test("a 1.2 pod's file opens only at its own path and only under a 1.2 header, and a 1.2 header states resourceFormat 2", async () => {
  const { memory, files, header } = await sealedPod();
  await files.writeAll([
    ["a.ttl", encoded("<#a> <#b> <#c> .")],
    ["b.ttl", encoded("<#d> <#e> <#f> .")],
  ]);
  assert.equal(text(await files.read("a.ttl")), "<#a> <#b> <#c> .");
  const stated = JSON.parse(text(header)) as Record<string, unknown>;
  assert.equal(stated.version, "1.2");
  assert.equal(stated.resourceFormat, 2);

  await memory.write("b.ttl", (await memory.read("a.ttl")) ?? new Uint8Array());
  await assert.rejects(files.read("b.ttl"), (error) => {
    assert.ok(error instanceof Refusal);
    assert.match(error.message, /^b\.ttl /);
    return true;
  });

  const asUnbound = await openHeader(
    encoded(
      JSON.stringify({ ...stated, version: "1.1", resourceFormat: undefined }),
    ),
    SECRET,
    fastDerive(),
  );
  await assert.rejects(
    new EncryptedFiles(memory, asUnbound).read("a.ttl"),
    Refusal,
  );

  const derive = fastDerive();
  const written = text(header);
  for (const edited of [
    JSON.stringify({ ...stated, resourceFormat: undefined }),
    written.replace('"resourceFormat": 2', '"resourceFormat": "2"'),
    written.replace('"resourceFormat": 2', '"resourceFormat": 2.0'),
  ]) {
    assert.notEqual(edited, written);
    assert.equal(
      await outcomeOf(openHeader(encoded(edited), SECRET, derive)),
      "malformed",
      edited,
    );
  }
  assert.equal(derive.calls, 0);
});

test("a sealed file is opened only when its path is read, and listing opens none", async () => {
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
  const pod = new EncryptedFiles(
    counted,
    await openHeader(
      (await memory.read(HEADER)) ?? new Uint8Array(),
      SECRET,
      fastDerive(),
    ),
  );
  assert.deepEqual(await pod.list(""), ["a.ttl", "b/c.ttl"]);
  assert.deepEqual(reads, []);
  assert.equal(text(await pod.read("b/c.ttl")), "c");
  assert.deepEqual(reads, ["b/c.ttl"]);
});

test("a step writing a file larger than the sealing limit is refused and writes nothing", async () => {
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
  assert.deepEqual(await memory.list(""), [HEADER]);
});

test("a write naming the header in any spelling, a path that is not canonical, or any file after the header changed, is refused and seals nothing", async () => {
  const { memory, files, header } = await sealedPod();
  await files.write("a.ttl", encoded("a"));
  const refused: [string, RegExp][] = [
    [HEADER, /is written only when the pod's encryption is made/],
    ["Settings/Encryption.json", /is written only when/],
    ["./a.ttl", /not a canonical path/],
    ["settings//encryption.json", /not a canonical path/],
    ["a/./b.ttl", /not a canonical path/],
    ["a/../b.ttl", /not a canonical path/],
    ["/a.ttl", /not a canonical path/],
    ["settings\\encryption.json", /not a canonical path/],
  ];
  for (const [path, reason] of refused) {
    await assert.rejects(files.write(path, encoded("{}")), reason, path);
    if (reason.source.includes("canonical"))
      await assert.rejects(files.read(path), reason, path);
  }
  assert.deepEqual(await memory.list(""), ["a.ttl", HEADER]);

  await memory.write("a.ttl", encoded("tampered"));
  await assert.rejects(
    files.read("a.ttl"),
    /does not open under the pod's key/,
  );

  await memory.write(HEADER, new Uint8Array([...header, 0x0a]));
  const changed = /the pod's header changed since it was opened; open it again/;
  await assert.rejects(files.write("b.ttl", encoded("b")), changed);
  await assert.rejects(files.read("a.ttl"), changed);
  assert.deepEqual(await memory.list(""), ["a.ttl", HEADER]);
});
