import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { argon2id as hashed } from "hash-wasm";
import { type DeriveKey, HEADER, Unopened } from "../encryption.js";

const READ_AT_MOST = 65537;

/** Argon2id on the calling thread, every parameter stated. */
export const argon2id: DeriveKey = async (secret, salt, params) =>
  hashed({
    password: secret,
    salt,
    iterations: params.t,
    memorySize: params.m,
    parallelism: params.p,
    hashLength: 32,
    outputType: "binary",
  });

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
