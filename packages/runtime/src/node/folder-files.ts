import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative as relativePath,
  sep,
} from "node:path";
import { pid } from "node:process";
import { pathToFileURL } from "node:url";
import { type Files, relative } from "../files.js";

/** The name of a file being written, which is no file of the folder until it is renamed over its name. */
const WRITING = /\.\d+\.\d+\.writing$/;
let writes = 0;

/** What touches one path in this process: Windows refuses a rename over a file while any handle on it is open, so a write waits for the reads to end and holds new ones. */
interface Touching {
  reads: number;
  renames: number;
  changed: Array<() => void>;
}
const touching = new Map<string, Touching>();

/** Waits while `blocked`, then enters in the same turn, so nothing can slip between the check and the count. */
async function enter(
  local: string,
  blocked: (t: Touching) => boolean,
  entering: keyof Pick<Touching, "reads" | "renames">,
): Promise<Touching> {
  for (;;) {
    let state = touching.get(local);
    if (!state)
      touching.set(local, (state = { reads: 0, renames: 0, changed: [] }));
    if (!blocked(state)) {
      state[entering] += 1;
      return state;
    }
    await new Promise<void>((resolve) => state.changed.push(resolve));
  }
}

function settled(local: string, state: Touching): void {
  for (const resolve of state.changed.splice(0)) resolve();
  if (state.reads + state.renames === 0 && touching.get(local) === state)
    touching.delete(local);
}

/** Whether a read failed because no file, or no folder, is at the path: a folder read as a file, a file as a folder. */
function absent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

/** Renames over a file that may be open: Windows refuses with EPERM or EBUSY while a reader holds it, for a moment. */
async function renamedOver(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt === 50 || (code !== "EPERM" && code !== "EBUSY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt));
    }
  }
}

/** Files in a local folder, named by the folder's file IRI unless given another. */
export class FolderFiles implements Files {
  readonly iri: string;

  constructor(
    readonly folder: string,
    iri?: string,
  ) {
    this.iri = iri ?? `${pathToFileURL(folder).href.replace(/\/?$/, "/")}`;
  }

  #local(pathOrIri: string): string {
    return join(this.folder, ...relative(this, pathOrIri).split("/"));
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const local = this.#local(pathOrIri);
    const state = await enter(local, (t) => t.renames > 0, "reads");
    try {
      return new Uint8Array(await readFile(local));
    } catch (error) {
      if (absent(error)) return undefined;
      throw error;
    } finally {
      state.reads -= 1;
      settled(local, state);
    }
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    const local = this.#local(pathOrIri);
    await mkdir(dirname(local), { recursive: true });
    const writing = join(
      dirname(local),
      `${basename(local)}.${pid}.${(writes += 1)}.writing`,
    );
    try {
      await writeFile(writing, bytes);
      const state = await enter(local, () => false, "renames");
      try {
        while (state.reads > 0)
          await new Promise<void>((resolve) => state.changed.push(resolve));
        await renamedOver(writing, local);
      } finally {
        state.renames -= 1;
        settled(local, state);
      }
    } catch (error) {
      await rm(writing, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async list(folder: string): Promise<string[]> {
    let files;
    try {
      files = await filesUnder(this.#local(folder));
    } catch (error) {
      if (absent(error)) return [];
      throw error;
    }
    return files
      .map((file) => relativePath(this.folder, file).split(sep).join("/"))
      .sort();
  }
}

/** Every file under the folder, its subfolders read in parallel: on Windows a third of a recursive `readdir`'s time. */
async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return filesUnder(path);
      return entry.isFile() && !WRITING.test(entry.name) ? [path] : [];
    }),
  );
  return found.flat();
}
