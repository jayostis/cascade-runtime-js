import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeriveKey } from "../src/encryption.js";
import { argon2id } from "../src/node/encryption.js";
import { resolve } from "../src/node/resolver.js";
import { siblingsOf } from "../src/node/runtime.js";
import { ROOT } from "./vocabulary.js";

const CONFORMANCE = {
  repository: "https://github.com/the-cascade-protocol/conformance",
};

export interface Vector {
  readonly id: string;
  readonly header: string;
  readonly expect: string;
  readonly tryWith: string;
}

export interface Positive {
  readonly id: string;
  readonly path: string;
  readonly layout: "envelope" | "pod";
  readonly passphrases: readonly string[];
  readonly mustNotOpenWith?: readonly string[];
}

export interface Vectors {
  readonly folder: string;
  readonly positive: readonly Positive[];
  readonly vectors: readonly Vector[];
}

let found: Promise<Vectors> | undefined;

/** The conformance repository's `pod-encryption/vectors.json`, resolved as the vocabulary is, and the folder it is in. */
export function podEncryptionVectors(): Promise<Vectors> {
  found ??= (async () => {
    const { folder: repository } = await resolve(CONFORMANCE, {
      siblingsIn: await siblingsOf(ROOT),
      cache: join(ROOT, "build", "cache"),
    });
    const folder = join(repository, "pod-encryption");
    if (!existsSync(join(folder, "vectors.json")))
      throw new Error(
        `${repository} holds no pod-encryption/vectors.json: check out a conformance with the pod encryption vectors`,
      );
    const read = JSON.parse(
      await readFile(join(folder, "vectors.json"), "utf8"),
    ) as Omit<Vectors, "folder">;
    return { folder, positive: read.positive, vectors: read.vectors };
  })();
  return found;
}

const derived = new Map<string, Promise<Uint8Array>>();

/** The real Argon2id, each (secret, salt, parameters) derived once per run: the fixtures share their salts. */
export const argon2idOnce: DeriveKey = async (secret, salt, params) => {
  const key = JSON.stringify([
    [...secret],
    [...salt],
    params.t,
    params.m,
    params.p,
  ]);
  let deriving = derived.get(key);
  if (deriving === undefined) {
    deriving = argon2id(new Uint8Array(secret), salt, params);
    derived.set(key, deriving);
  }
  return new Uint8Array(await deriving);
};
