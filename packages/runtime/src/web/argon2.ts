import type { DeriveKey } from "../encryption.js";
import {
  type Argon2Request,
  type Argon2Response,
  argon2idHere,
} from "./argon2-direct.js";

interface Job {
  readonly resolve: (key: Uint8Array) => void;
  readonly reject: (error: Error) => void;
  readonly here: () => void;
}

let worker: Worker | undefined;
let broken = false;
let next = 1;
const jobs = new Map<number, Job>();

/** The worker, started once; none where workers are unavailable or it failed to start, and the page derives instead. */
function started(): Worker | undefined {
  if (broken || typeof Worker === "undefined") return undefined;
  if (worker !== undefined) return worker;
  try {
    const starting = new Worker(
      new URL("./argon2-worker.js", import.meta.url),
      {
        type: "module",
      },
    );
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
  } catch {
    broken = true;
    return undefined;
  }
}

/** Argon2id in a module worker, so the page does not freeze while it runs; on the page's own thread when none starts. */
export const argon2id: DeriveKey = (secret, salt, params) => {
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
