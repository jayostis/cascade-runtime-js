import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, mock } from "node:test";
import {
  ARGON2_PARAMS,
  type Argon2Params,
  type DeriveKey,
  newHeader,
  openHeader,
  Unopened,
} from "../src/encryption.js";
import { argon2id } from "../src/node/encryption.js";

const SECRET = "abacus abdomen abdominal abide abiding zoom";
const encoded = (value: string) => new TextEncoder().encode(value);
const base64 = (length: number) => Buffer.alloc(length).toString("base64");

/** A stand-in for Argon2id that counts its calls and opens nothing. */
function counting(): DeriveKey & { calls: number } {
  const derive = async (secret: Uint8Array, salt: Uint8Array) => {
    derive.calls += 1;
    return new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array([...secret, ...salt]),
      ),
    );
  };
  derive.calls = 0;
  return derive;
}

/** The bytes of a header of the version whose passphrase wraps ask for `costs`; a `1.0` header shares the first one's. */
function headerAsking(
  costs: readonly Argon2Params[],
  version: "1.0" | "1.2" = "1.2",
): Uint8Array {
  const wrap = (kdfParams: Argon2Params) => ({
    by: "passphrase",
    ...(version === "1.0" ? {} : { label: null, createdAt: null }),
    ...(version === "1.0" ? {} : { kdf: "argon2id" }),
    ...(version === "1.0"
      ? {}
      : { kdfParams: { salt: base64(16), ...kdfParams } }),
    wrappedDek: base64(60),
  });
  const [first] = costs;
  return encoded(
    JSON.stringify({
      version,
      algorithm: "aes-256-gcm",
      ...(version === "1.0"
        ? { kdf: "argon2id", kdfParams: { salt: base64(16), ...first } }
        : { resourceFormat: 2 }),
      wraps: costs.map(wrap),
    }),
  );
}

const WORST: Argon2Params = { t: 6, m: 131072, p: 1 };
const SMALLEST: Argon2Params = { t: 1, m: 8, p: 1 };

async function outcomeOf(opening: Promise<unknown>): Promise<string> {
  try {
    await opening;
    return "opened";
  } catch (error) {
    if (error instanceof Unopened) return error.outcome;
    throw error;
  }
}

describe("Sealing a pod's files · newHeader(), openHeader(), EncryptedFiles", () => {
  describe("given a header whose passphrase wraps ask for Argon2 work in total", () => {
    it("throws Unopened, `malformed`, with no key derived, when the total of t times m is over the cap", async () => {
      const over: [string, Uint8Array][] = [
        [
          "six wraps of the largest cost each, the 30 s case",
          headerAsking(Array(6).fill(WORST)),
        ],
        [
          "two of the largest and one of the smallest, one step over",
          headerAsking([WORST, WORST, SMALLEST]),
        ],
        [
          "a 1.0 header's shared parameters, four times over",
          headerAsking(Array(4).fill(WORST), "1.0"),
        ],
      ];
      for (const [what, header] of over) {
        const derive = counting();
        assert.equal(
          await outcomeOf(openHeader(header, SECRET, derive)),
          "malformed",
          what,
        );
        assert.equal(derive.calls, 0, what);
      }
    });

    it("tries every wrap of a header at the cap, and of six wraps at the default cost", async () => {
      const within: [string, Uint8Array, number][] = [
        ["two of the largest cost", headerAsking([WORST, WORST]), 2],
        [
          "six at the cost a new pod's wrap has",
          headerAsking(Array(6).fill(ARGON2_PARAMS)),
          6,
        ],
      ];
      for (const [what, header, wraps] of within) {
        const derive = counting();
        assert.equal(
          await outcomeOf(openHeader(header, SECRET, derive)),
          "incorrect secret",
          what,
        );
        assert.equal(derive.calls, wraps, what);
      }
    });
  });

  describe("newHeader(secret, derive)", () => {
    it("zeroes each copy it makes of the pod's data key", async () => {
      const subtle = globalThis.crypto.subtle;
      const keyCopies: Uint8Array[] = [];
      const importKey = subtle.importKey.bind(subtle);
      const encrypt = subtle.encrypt.bind(subtle);
      mock.method(subtle, "importKey", (...args: unknown[]) => {
        keyCopies.push(args[1] as Uint8Array);
        return (importKey as (...a: unknown[]) => unknown)(...args);
      });
      mock.method(subtle, "encrypt", (...args: unknown[]) => {
        keyCopies.push(args[2] as Uint8Array);
        return (encrypt as (...a: unknown[]) => unknown)(...args);
      });
      try {
        await newHeader(SECRET, counting());
      } finally {
        mock.restoreAll();
      }
      assert.equal(
        keyCopies.length,
        4,
        "the wrapping key's, and the data key's for its wrap, its AES key and its names key",
      );
      for (const copy of keyCopies) {
        assert.equal(copy.length, 32);
        assert.ok(
          copy.every((byte) => byte === 0),
          "a copy of a 32-byte key still holds its bytes",
        );
      }
    });
  });

  describe("argon2id(secret, salt, params)", () => {
    it("answers an HTTP request, on Node, while a derivation runs, and derives the same key twice from one secret", async () => {
      const server = createServer((_request, response) => response.end("up"));
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const { port } = server.address() as AddressInfo;
        const secret = encoded(SECRET);
        const salt = new Uint8Array(16).fill(7);
        const params = { ...ARGON2_PARAMS, t: 4 };
        let running = true;
        const first = argon2id(secret, salt, params).finally(() => {
          running = false;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const answer = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(await answer.text(), "up");
        assert.ok(
          running,
          "the derivation ended before the request was answered",
        );
        const key = await first;
        assert.deepEqual(await argon2id(secret, salt, params), key);
      } finally {
        server.close();
      }
    });
  });
});
