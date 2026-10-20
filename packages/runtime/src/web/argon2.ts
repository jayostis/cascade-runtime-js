import type { DeriveKey } from "../encryption.js";
import {
  type Argon2Request,
  type Argon2Response,
  argon2idHere,
} from "./argon2-direct.js";

/** This module's URL, named apart from `new URL`, so that no bundler follows the worker made from it. */
const HERE = import.meta.url;

interface Job {
  readonly resolve: (key: Uint8Array) => void;
  readonly reject: (error: Error) => void;
  readonly here: () => void;
}

/**
 * Argon2id in the module worker `start` starts, once, so the page does not freeze while it runs; on the page's own
 * thread where workers are unavailable or it failed to start.
 */
function deriving(start: () => Worker): DeriveKey {
  let worker: Worker | undefined;
  let broken = false;
  let next = 1;
  const jobs = new Map<number, Job>();

  const started = (): Worker | undefined => {
    if (broken || typeof Worker === "undefined") return undefined;
    if (worker !== undefined) return worker;
    let starting: Worker;
    try {
      starting = start();
    } catch {
      broken = true;
      return undefined;
    }
    starting.onmessage = (event: MessageEvent<Argon2Response>) => {
      const job = jobs.get(event.data.id);
      if (job === undefined) return;
      jobs.delete(event.data.id);
      if ("key" in event.data) job.resolve(event.data.key);
      else job.reject(new Error(event.data.error));
    };
    starting.onerror = (event) => {
      event.preventDefault();
      broken = true;
      worker = undefined;
      starting.terminate();
      const waiting = [...jobs.values()];
      jobs.clear();
      for (const job of waiting) job.here();
    };
    worker = starting;
    return starting;
  };

  return (secret, salt, params) => {
    const running = started();
    if (running === undefined) return argon2idHere(secret, salt, params);
    const id = next++;
    const request: Argon2Request = {
      id,
      secret: new Uint8Array(secret),
      salt: new Uint8Array(salt),
      params: { t: params.t, m: params.m, p: params.p },
    };
    return new Promise<Uint8Array>((resolve, reject) => {
      jobs.set(id, {
        resolve,
        reject,
        here: () => {
          argon2idHere(secret, salt, params).then(resolve, reject);
        },
      });
      running.postMessage(request, [request.secret.buffer as ArrayBuffer]);
    });
  };
}

/** Argon2id in the worker beside this module. */
export const argon2id: DeriveKey = deriving(
  () =>
    new Worker(new URL("./argon2-worker.js", HERE), {
      type: "module",
    }),
);

/** Argon2id in the worker at the URL. */
export function argon2idAt(worker: URL): DeriveKey {
  return deriving(() => new Worker(worker, { type: "module" }));
}
