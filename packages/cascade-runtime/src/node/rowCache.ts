import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The folder that keeps the tables' row files between runs; unset, nothing is kept. */
export const ROWS_CACHE = "CASCADE_ROWS_CACHE";

const NAMED_BY_CONTENT = /\/rows\/([0-9a-f]{64})\.nq\.gz$/;

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

let hits = 0;
let fetched = 0;
let reporting = false;
let keptIn = "";

const report = (folder: string): void => {
  keptIn = folder;
  if (reporting) return;
  reporting = true;
  process.once("exit", () => {
    if (hits + fetched > 0)
      console.error(
        `row files: ${hits} from the cache ${keptIn}, ${fetched} fetched`,
      );
  });
};

/**
 * `fetching`, except that a row file named by its content (`rows/<sha-256>.nq.gz`) is read from the folder
 * `CASCADE_ROWS_CACHE` names when it is there and its bytes still hash to its name, and kept in it when it is not.
 * Anything else is fetched live.
 */
export function keptRows(
  fetching: typeof fetch,
  folder: string | undefined = process.env[ROWS_CACHE],
): typeof fetch {
  if (folder === undefined || folder === "") return fetching;
  report(folder);
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const hash = NAMED_BY_CONTENT.exec(new URL(url).pathname)?.[1];
    if (hash === undefined) return fetching(input, init);
    const path = join(folder, `${hash}.nq.gz`);
    const kept = await readFile(path).catch(() => undefined);
    if (kept !== undefined && sha256(kept) === hash) {
      hits += 1;
      return new Response(kept);
    }
    const response = await fetching(input, init);
    if (!response.ok) return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    fetched += 1;
    if (sha256(bytes) === hash) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(folder, { recursive: true });
        await writeFile(temporary, bytes);
        await rename(temporary, path);
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }
    return new Response(bytes, { status: response.status });
  };
}
