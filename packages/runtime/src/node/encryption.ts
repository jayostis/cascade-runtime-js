import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  type Argon2Params,
  type DeriveKey,
  HEADER,
  Unopened,
} from "../encryption.js";

const READ_AT_MOST = 65537;

/** What the worker is asked: the secret, the salt and the parameters of one derivation. */
export interface Argon2Request {
  readonly id: number;
  readonly secret: Uint8Array;
  readonly salt: Uint8Array;
  readonly params: Argon2Params;
}

export type Argon2Response =
  | { readonly id: number; readonly key: Uint8Array }
  | { readonly id: number; readonly error: string };

interface Job {
  readonly on: Worker;
  readonly resolve: (key: Uint8Array) => void;
  readonly reject: (error: Error) => void;
}

/** How long the worker, which holds the memory of its last derivation, is kept for the next one. */
const IDLE_MS = 2000;

let worker: Worker | undefined;
let idle: NodeJS.Timeout | undefined;
let next = 1;
const jobs = new Map<number, Job>();

function lost(from: Worker, error: Error): void {
  if (worker === from) worker = undefined;
  for (const [id, job] of jobs)
    if (job.on === from) {
      jobs.delete(id);
      job.reject(error);
    }
}

function started(): Worker {
  clearTimeout(idle);
  if (worker !== undefined) return worker;
  const starting = new Worker(new URL("./argon2-worker.js", import.meta.url));
  starting.unref();
  starting.on("message", (response: Argon2Response) => {
    const job = jobs.get(response.id);
    if (job === undefined) return;
    jobs.delete(response.id);
    if ("key" in response) job.resolve(response.key);
    else job.reject(new Error(response.error));
    if ([...jobs.values()].some((other) => other.on === starting)) return;
    starting.unref();
    idle = setTimeout(() => {
      if (worker === starting) worker = undefined;
      void starting.terminate();
    }, IDLE_MS);
    idle.unref();
  });
  starting.on("error", (error) => lost(starting, error));
  starting.on("exit", (code) =>
    lost(starting, new Error(`the Argon2 worker exited with code ${code}`)),
  );
  worker = starting;
  return starting;
}

/**
 * Argon2id in a worker thread, every parameter stated, so that the event loop keeps answering while it runs. The worker
 * is started by the first derivation, kept for two seconds after the last, and keeps the process alive only while a
 * derivation waits on it.
 */
export const argon2id: DeriveKey = (secret, salt, params) => {
  const running = started();
  const id = next++;
  const request: Argon2Request = {
    id,
    secret: new Uint8Array(secret),
    salt: new Uint8Array(salt),
    params: { t: params.t, m: params.m, p: params.p },
  };
  return new Promise<Uint8Array>((resolve, reject) => {
    jobs.set(id, { on: running, resolve, reject });
    running.ref();
    running.postMessage(request, [request.secret.buffer as ArrayBuffer]);
  });
};

function absent(error: unknown): undefined {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return undefined;
  throw error;
}

const notAFile = (what: string, is = "is not a regular file"): Unopened =>
  new Unopened(
    "malformed",
    `The pod's encryption header is malformed: ${what} ${is}.`,
  );

/**
 * The bytes of the pod's encryption header in the folder, at most 65,537 of them; none when nothing is at its path. No
 * link is followed: anything at the path but a regular file, or a `settings` that is a link, is a malformed header.
 */
export async function headerIn(
  folder: string,
): Promise<Uint8Array | undefined> {
  const settings = join(folder, "settings");
  const found = await lstat(settings).catch(absent);
  if (found === undefined) return undefined;
  if (found.isSymbolicLink()) throw notAFile("settings", "is a link");
  if (!found.isDirectory()) return undefined;
  const path = join(folder, ...HEADER.split("/"));
  const header = await lstat(path).catch(absent);
  if (header === undefined) return undefined;
  if (!header.isFile()) throw notAFile(HEADER);
  const handle = await open(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ELOOP") throw notAFile(HEADER);
    throw error;
  });
  try {
    if (!(await handle.stat()).isFile()) throw notAFile(HEADER);
    const bytes = new Uint8Array(READ_AT_MOST);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return bytes.slice(0, length);
  } finally {
    await handle.close();
  }
}
