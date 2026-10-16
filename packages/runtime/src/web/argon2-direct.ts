import { argon2id } from "hash-wasm";
import type { DeriveKey } from "../encryption.js";

/** Argon2id on the calling thread, every parameter stated: what the worker runs, and what runs when it cannot start. */
export const argon2idHere: DeriveKey = (secret, salt, params) =>
  argon2id({
    password: secret,
    salt,
    iterations: params.t,
    memorySize: params.m,
    parallelism: params.p,
    hashLength: 32,
    outputType: "binary",
  });

export interface Argon2Request {
  readonly id: number;
  readonly secret: Uint8Array;
  readonly salt: Uint8Array;
  readonly params: {
    readonly t: number;
    readonly m: number;
    readonly p: number;
  };
}

export type Argon2Response =
  | { readonly id: number; readonly key: Uint8Array }
  | { readonly id: number; readonly error: string };
