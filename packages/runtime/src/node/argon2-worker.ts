import { parentPort } from "node:worker_threads";
import { argon2id } from "hash-wasm";
import type { Argon2Request, Argon2Response } from "./encryption.js";

parentPort?.on(
  "message",
  ({ id, secret, salt, params }: Argon2Request): void => {
    const reply = (response: Argon2Response, transfer: ArrayBuffer[]): void =>
      parentPort?.postMessage(response, transfer);
    argon2id({
      password: secret,
      salt,
      iterations: params.t,
      memorySize: params.m,
      parallelism: params.p,
      hashLength: 32,
      outputType: "binary",
    }).then(
      (derived) => {
        secret.fill(0);
        const key = new Uint8Array(derived);
        derived.fill(0);
        reply({ id, key }, [key.buffer]);
      },
      (error: unknown) => {
        secret.fill(0);
        reply(
          { id, error: error instanceof Error ? error.message : String(error) },
          [],
        );
      },
    );
  },
);
