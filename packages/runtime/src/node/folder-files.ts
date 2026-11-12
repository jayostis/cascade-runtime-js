import { constants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative as relativePath,
  sep,
} from "node:path";
import { pid } from "node:process";
import { pathToFileURL } from "node:url";
import { type Files, relative } from "../files.js";
import { Refusal } from "../step.js";

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

/** The calls a folder that refuses links makes to look at a path, handed in so that a test can count them. */
export interface LinkChecks {
  readonly lstat: (path: string) => Promise<Stats>;
  readonly realpath: (path: string) => Promise<string>;
  readonly mkdir: (path: string) => Promise<unknown>;
  /** The flag that makes opening a file fail at a link, where the platform has one. */
  readonly noFollow: number | undefined;
}

const NODE_CHECKS: LinkChecks = {
  lstat: (path) => lstat(path),
  realpath: (path) => realpath(path),
  mkdir: (path) => mkdir(path),
  noFollow: constants.O_NOFOLLOW,
};

export interface FolderFilesOptions {
  /**
   * Refuses, with a `Refusal`, a read or a write of a path with a link in any part under the folder, the file's own
   * included. The folder itself may be behind a link, and a hard link is no link. Off, a link is followed.
   */
  readonly refuseLinks?: boolean;
  readonly fs?: Partial<LinkChecks>;
}

const linked = (path: string): Refusal =>
  new Refusal(
    `${path} is, or lies behind, a link: a pod's files are never read or written through one.`,
  );

/** Files in a local folder, named by the folder's file IRI unless given another. */
export class FolderFiles implements Files {
  readonly iri: string;
  readonly #refuse: boolean;
  readonly #fs: LinkChecks;
  #root: Promise<string> | undefined;
  /** The folders under the folder found to be folders, no link and none of their parents; one that is none is not kept. */
  readonly #checked = new Map<string, Promise<boolean>>();
  /** The files a listing found to be files, no link, as the folders are: a read of one skips the look at the file where the platform has no flag for it. */
  readonly #listed = new Set<string>();

  constructor(
    readonly folder: string,
    iri?: string,
    options: FolderFilesOptions = {},
  ) {
    this.iri = iri ?? `${pathToFileURL(folder).href.replace(/\/?$/, "/")}`;
    this.#refuse = options.refuseLinks === true;
    this.#fs = { ...NODE_CHECKS, ...options.fs };
  }

  #local(pathOrIri: string): string {
    return join(this.folder, ...relative(this, pathOrIri).split("/"));
  }

  #parts(pathOrIri: string): string[] {
    return relative(this, pathOrIri)
      .split("/")
      .filter((part) => part !== "");
  }

  /** The folder as the system resolves it, once, for it may be behind a link; none while it does not exist, unless made. */
  async #resolved(make: boolean): Promise<string | undefined> {
    if (this.#root === undefined) {
      const resolving = (async () => {
        if (make) await mkdir(this.folder, { recursive: true });
        return this.#fs.realpath(this.folder);
      })();
      this.#root = resolving;
      resolving.catch(() => {
        if (this.#root === resolving) this.#root = undefined;
      });
    }
    try {
      return await this.#root;
    } catch (error) {
      if (absent(error)) return undefined;
      throw error;
    }
  }

  /** Whether the folder is one, no link and none of its parents either, looked at once however many files are in it. */
  #isFolder(root: string, parts: readonly string[]): Promise<boolean> {
    const key = parts.join("/");
    let found = this.#checked.get(key);
    if (found === undefined) {
      const checking = (async () => {
        if (parts.length === 0) return true;
        if (!(await this.#isFolder(root, parts.slice(0, -1)))) return false;
        let stat: Stats;
        try {
          stat = await this.#fs.lstat(join(root, ...parts));
        } catch (error) {
          if (absent(error)) return false;
          throw error;
        }
        if (stat.isSymbolicLink()) throw linked(key);
        return stat.isDirectory();
      })();
      found = checking;
      this.#checked.set(key, checking);
      const forget = (): void => {
        if (this.#checked.get(key) === checking) this.#checked.delete(key);
      };
      checking.then((is) => (is ? undefined : forget()), forget);
    }
    return found;
  }

  /** The folder made, as far as it is not, one at a time, each looked at once it is there. */
  async #made(root: string, parts: readonly string[]): Promise<void> {
    if (await this.#isFolder(root, parts)) return;
    await this.#made(root, parts.slice(0, -1));
    try {
      await this.#fs.mkdir(join(root, ...parts));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!(await this.#isFolder(root, parts)))
      throw new Error(`${join(root, ...parts)} is no folder`);
  }

  /** Where to open the file and how; none when no file can be there. A file is looked at only where it cannot be opened without following a link. */
  async #opening(
    pathOrIri: string,
  ): Promise<{ path: string; flag: string | number } | undefined> {
    if (!this.#refuse) return { path: this.#local(pathOrIri), flag: "r" };
    const parts = this.#parts(pathOrIri);
    const root = await this.#resolved(false);
    if (root === undefined) return undefined;
    if (!(await this.#isFolder(root, parts.slice(0, -1)))) return undefined;
    const path = join(root, ...parts);
    const { noFollow } = this.#fs;
    if (noFollow !== undefined)
      return { path, flag: constants.O_RDONLY | noFollow };
    if (
      !this.#listed.has(parts.join("/")) &&
      !(await this.#notLink(path, parts))
    )
      return undefined;
    return { path, flag: "r" };
  }

  /** Whether the file can be there: false when it is not, and a refusal when it is a link. */
  async #notLink(path: string, parts: readonly string[]): Promise<boolean> {
    let stat: Stats;
    try {
      stat = await this.#fs.lstat(path);
    } catch (error) {
      if (absent(error)) return false;
      throw error;
    }
    if (stat.isSymbolicLink()) throw linked(parts.join("/"));
    return true;
  }

  /** Where to write the file, its folders made; a link in them, or at the file's path, is refused. */
  async #writable(pathOrIri: string): Promise<string> {
    if (!this.#refuse) {
      const local = this.#local(pathOrIri);
      await mkdir(dirname(local), { recursive: true });
      return local;
    }
    const parts = this.#parts(pathOrIri);
    // A listing that ran first may have shared a failed resolve of a folder not yet made; the second makes it.
    const root = (await this.#resolved(true)) ?? (await this.#resolved(true));
    if (root === undefined) throw new Error(`${this.folder} cannot be made`);
    await this.#made(root, parts.slice(0, -1));
    const path = join(root, ...parts);
    await this.#notLink(path, parts);
    // The folders were looked at once; the folder the file goes in is resolved again, for a swap since then.
    const inside = relativePath(root, await this.#fs.realpath(dirname(path)));
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw linked(parts.join("/"));
    return path;
  }

  /** The error a read or a write failed with, or the refusal of the link it was stopped at. */
  #stopped(error: unknown, pathOrIri: string): unknown {
    const code = (error as NodeJS.ErrnoException).code;
    return this.#refuse && (code === "ELOOP" || code === "EMLINK")
      ? linked(this.#parts(pathOrIri).join("/"))
      : error;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const local = this.#local(pathOrIri);
    const state = await enter(local, (t) => t.renames > 0, "reads");
    try {
      const opening = await this.#opening(pathOrIri);
      if (opening === undefined) return undefined;
      return new Uint8Array(
        await readFile(opening.path, { flag: opening.flag }),
      );
    } catch (error) {
      if (absent(error)) return undefined;
      throw this.#stopped(error, pathOrIri);
    } finally {
      state.reads -= 1;
      settled(local, state);
    }
  }

  async readRange(
    pathOrIri: string,
    start: number,
    length: number,
  ): Promise<Uint8Array | undefined> {
    const local = this.#local(pathOrIri);
    const state = await enter(local, (t) => t.renames > 0, "reads");
    try {
      const opening = await this.#opening(pathOrIri);
      if (opening === undefined) return undefined;
      const handle = await open(opening.path, opening.flag);
      try {
        const size = (await handle.stat()).size;
        const from = start < 0 ? Math.max(0, size + start) : start;
        const bytes = new Uint8Array(
          Math.max(0, Math.min(length, size - from)),
        );
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, from);
        return bytes.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (absent(error)) return undefined;
      throw this.#stopped(error, pathOrIri);
    } finally {
      state.reads -= 1;
      settled(local, state);
    }
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    const local = this.#local(pathOrIri);
    const at = await this.#writable(pathOrIri);
    const writing = join(
      dirname(at),
      `${basename(at)}.${pid}.${(writes += 1)}.writing`,
    );
    try {
      await writeFile(writing, bytes, this.#refuse ? { flag: "wx" } : {});
      const state = await enter(local, () => false, "renames");
      try {
        while (state.reads > 0)
          await new Promise<void>((resolve) => state.changed.push(resolve));
        await renamedOver(writing, at);
      } finally {
        state.renames -= 1;
        settled(local, state);
      }
    } catch (error) {
      await rm(writing, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Writes the file only when none is at its path, whole or not at all; false when one is. */
  async writeNew(pathOrIri: string, bytes: Uint8Array): Promise<boolean> {
    const at = await this.#writable(pathOrIri);
    const writing = join(
      dirname(at),
      `${basename(at)}.${pid}.${(writes += 1)}.writing`,
    );
    try {
      await writeFile(writing, bytes, this.#refuse ? { flag: "wx" } : {});
      await link(writing, at);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      await rm(writing, { force: true }).catch(() => undefined);
    }
  }

  async list(folder: string): Promise<string[]> {
    let root = this.folder;
    let files;
    try {
      if (this.#refuse) {
        const resolved = await this.#resolved(false);
        const parts = this.#parts(folder);
        if (resolved === undefined || !(await this.#isFolder(resolved, parts)))
          return [];
        root = resolved;
        files = await filesUnder(join(root, ...parts), (found) =>
          this.#checked.set(
            relativePath(resolved, found).split(sep).join("/"),
            Promise.resolve(true),
          ),
        );
      } else files = await filesUnder(this.#local(folder));
    } catch (error) {
      if (absent(error)) return [];
      throw error;
    }
    const paths = files.map((file) =>
      relativePath(root, file).split(sep).join("/"),
    );
    if (this.#refuse) for (const path of paths) this.#listed.add(path);
    return paths.sort();
  }
}

/** Every file under the folder, its subfolders read in parallel: on Windows a third of a recursive `readdir`'s time. */
async function filesUnder(
  folder: string,
  seen?: (folder: string) => void,
): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  seen?.(folder);
  const found = await Promise.all(
    entries.map((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return filesUnder(path, seen);
      return entry.isFile() && !WRITING.test(entry.name) ? [path] : [];
    }),
  );
  return found.flat();
}
