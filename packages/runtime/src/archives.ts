import { type Files, relative, sameBytes, under } from "./files.js";
import type { Layout } from "./layout.js";
import { counted, timedAside } from "./probe.js";
import { Refusal } from "./step.js";

const END = 0x06054b50;
const END_LENGTH = 22;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_LENGTH = 20;
const CENTRAL = 0x02014b50;
const CENTRAL_LENGTH = 46;
const LOCAL = 0x04034b50;
const LOCAL_LENGTH = 30;
const MOST_COMMENT = 0xffff;
/** A field at its largest value, which in a ZIP says that the value is in a ZIP64 field. */
const ZIP64_SIZE = 0xffffffff;
const ZIP64_EXTRA = 0x0001;
const ENCRYPTED = 0x0001;
const STRONGLY_ENCRYPTED = 0x0040;
const UTF8 = 0x0800;
const STORED = 0;
const DEFLATED = 8;

/** An archive's name in its folder (N9): the SHA-256 of its bytes in lowercase hex, adding `.zip`. */
export const ARCHIVE_NAME = /^[0-9a-f]{64}\.zip$/;

/** One file an archive holds, as its central directory gives it. */
export interface ArchiveEntry {
  /** The archive's path in the pod. */
  readonly archive: string;
  /** The file's path. */
  readonly path: string;
  readonly method: typeof STORED | typeof DEFLATED;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  /** Where its local header starts, and where the next entry's, or the directory, does. */
  readonly offset: number;
  readonly end: number;
  readonly name: Uint8Array;
}

const notInProfile = (archive: string, why: string): Refusal =>
  new Refusal(
    `${archive} is no archive of the pod's files: ${why}; nothing is read from it`,
  );

const torn = (archive: string): Refusal =>
  new Refusal(
    `${archive} has no end of central directory record: it is torn, and nothing is read from it`,
  );

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let at = 0; at < bytes.length; at++)
    c = (CRC_TABLE[(c ^ (bytes[at] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** The path an entry's name bytes give, or why they give none. */
function pathOf(name: Uint8Array, flags: number): string | { why: string } {
  if ((flags & UTF8) === 0 && name.some((byte) => byte >= 0x80))
    return { why: "a path is not in UTF-8" };
  try {
    return UTF8_DECODER.decode(name);
  } catch {
    return { why: "a path is not in UTF-8" };
  }
}

/** The ZIP64 field among an entry's extra fields, if it has one. */
function hasZip64(extra: Uint8Array): boolean {
  const fields = view(extra);
  for (
    let at = 0;
    at + 4 <= extra.length;
    at += 4 + fields.getUint16(at + 2, true)
  )
    if (fields.getUint16(at, true) === ZIP64_EXTRA) return true;
  return false;
}

/** The end of central directory record in the bytes at the end of an archive: where it starts in them. */
function endIn(tail: Uint8Array): number | undefined {
  const fields = view(tail);
  for (let at = tail.length - END_LENGTH; at >= 0; at--)
    if (
      fields.getUint32(at, true) === END &&
      fields.getUint16(at + 20, true) === tail.length - at - END_LENGTH
    )
      return at;
  return undefined;
}

/**
 * Every file the archive holds, from its directory alone: two ranged reads, its end and its central directory. An
 * archive with no end record is torn and refused; one outside the ISO/IEC 21320-1 profile as X1 narrows it (entries
 * stored or deflated, UTF-8 paths, no ZIP encryption, no ZIP64, one disk, one entry a path) is refused, naming it.
 * An entry in `folder`, the archives' own, is refused; an entry for a folder holds no file and is passed over.
 */
export async function archiveDirectory(
  files: Files,
  archive: string,
  folder?: string,
): Promise<ArchiveEntry[]> {
  const ranged = async (start: number, length: number): Promise<Uint8Array> => {
    const read =
      files.readRange === undefined
        ? (await files.read(archive))?.slice(
            start,
            start < 0 ? undefined : start + length,
          )
        : await files.readRange(archive, start, length);
    if (read === undefined) throw new Error(`${archive} is gone`);
    return read;
  };
  let tail = await ranged(
    -(END_LENGTH + ZIP64_LOCATOR_LENGTH),
    END_LENGTH + ZIP64_LOCATOR_LENGTH,
  );
  let at = endIn(tail);
  if (at === undefined) {
    const longest = END_LENGTH + ZIP64_LOCATOR_LENGTH + MOST_COMMENT;
    tail = await ranged(-longest, longest);
    at = endIn(tail);
  }
  if (at === undefined) throw torn(archive);
  const end = view(tail);
  if (
    at >= ZIP64_LOCATOR_LENGTH &&
    end.getUint32(at - ZIP64_LOCATOR_LENGTH, true) === ZIP64_LOCATOR
  )
    throw notInProfile(archive, "it has a ZIP64 end record");
  const count = end.getUint16(at + 10, true);
  const size = end.getUint32(at + 12, true);
  const offset = end.getUint32(at + 16, true);
  if (
    end.getUint16(at + 4, true) !== 0 ||
    end.getUint16(at + 6, true) !== 0 ||
    end.getUint16(at + 8, true) !== count
  )
    throw notInProfile(archive, "it spans more than one disk");
  if (size === ZIP64_SIZE || offset === ZIP64_SIZE)
    throw notInProfile(archive, "it has a ZIP64 field");
  const directory = await ranged(offset, size + 4);
  if (
    directory.length !== size + 4 ||
    view(directory).getUint32(size, true) !== END
  )
    throw notInProfile(
      archive,
      "its central directory is not where its end record says",
    );
  const fields = view(directory);
  const entries: ArchiveEntry[] = [];
  const paths = new Set<string>();
  let next = 0;
  for (let n = 0; n < count; n++) {
    if (
      next + CENTRAL_LENGTH > size ||
      fields.getUint32(next, true) !== CENTRAL
    )
      throw notInProfile(archive, "its central directory is malformed");
    const flags = fields.getUint16(next + 8, true);
    const method = fields.getUint16(next + 10, true);
    const crc = fields.getUint32(next + 16, true);
    const compressed = fields.getUint32(next + 20, true);
    const length = fields.getUint32(next + 24, true);
    const nameLength = fields.getUint16(next + 28, true);
    const extraLength = fields.getUint16(next + 30, true);
    const commentLength = fields.getUint16(next + 32, true);
    const disk = fields.getUint16(next + 34, true);
    const local = fields.getUint32(next + 42, true);
    const nameAt = next + CENTRAL_LENGTH;
    next = nameAt + nameLength + extraLength + commentLength;
    if (next > size)
      throw notInProfile(archive, "its central directory is malformed");
    const name = directory.slice(nameAt, nameAt + nameLength);
    const extra = directory.subarray(
      nameAt + nameLength,
      nameAt + nameLength + extraLength,
    );
    if ((flags & (ENCRYPTED | STRONGLY_ENCRYPTED)) !== 0)
      throw notInProfile(archive, "an entry is encrypted");
    if (method !== STORED && method !== DEFLATED)
      throw notInProfile(
        archive,
        `an entry is compressed by method ${method}, and only stored and deflated entries are read`,
      );
    if (
      hasZip64(extra) ||
      compressed === ZIP64_SIZE ||
      length === ZIP64_SIZE ||
      local === ZIP64_SIZE
    )
      throw notInProfile(archive, "it has a ZIP64 field");
    if (disk !== 0) throw notInProfile(archive, "it spans more than one disk");
    const path = pathOf(name, flags);
    if (typeof path !== "string") throw notInProfile(archive, path.why);
    if (path.endsWith("/") && length === 0 && compressed === 0) continue;
    try {
      if (
        path === "" ||
        path.includes("\0") ||
        relative({ iri: "urn:archive:" }, path) !== path
      )
        throw new Error(path);
      if (path.split("/").some((part) => part === "" || part === "."))
        throw new Error(path);
    } catch {
      throw notInProfile(
        archive,
        `it holds ${JSON.stringify(path)}, which is no path`,
      );
    }
    if (folder !== undefined && under(folder, path))
      throw notInProfile(archive, `it holds ${path}, in the archives' folder`);
    if (paths.has(path)) throw notInProfile(archive, `it holds ${path} twice`);
    if (method === STORED && compressed !== length)
      throw notInProfile(archive, `${path} is stored, yet its sizes differ`);
    paths.add(path);
    entries.push({
      archive,
      path,
      method,
      crc,
      compressed,
      size: length,
      offset: local,
      end: offset,
      name,
    });
  }
  if (next !== size)
    throw notInProfile(archive, "its central directory is malformed");
  const byOffset = [...entries].sort((one, other) => one.offset - other.offset);
  const spanned = new Map<ArchiveEntry, number>();
  byOffset.forEach((entry, index) => {
    const ends = byOffset[index + 1]?.offset ?? offset;
    if (
      entry.offset + LOCAL_LENGTH + entry.name.length + entry.compressed >
      ends
    )
      throw notInProfile(archive, "its entries overlap");
    spanned.set(entry, ends);
  });
  return entries.map((entry) => ({
    ...entry,
    end: spanned.get(entry) ?? offset,
  }));
}

/** The bytes inflated, when they inflate to exactly `size` of them; none otherwise. */
async function inflated(
  data: Uint8Array,
  size: number,
): Promise<Uint8Array | undefined> {
  const reader = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const out = new Uint8Array(size);
  let at = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > size) {
        await reader.cancel();
        return undefined;
      }
      out.set(value, at);
      at += value.length;
    }
  } catch {
    return undefined;
  }
  return at === size ? out : undefined;
}

/**
 * The file an entry holds, by one ranged read of its local header and its data, inflated when it is deflated; refused,
 * naming it and its archive, when the bytes are not those its directory says.
 */
export async function archiveEntryBytes(
  files: Files,
  entry: ArchiveEntry,
): Promise<Uint8Array> {
  counted("archives.entries.read");
  const span = entry.end - entry.offset;
  const read =
    files.readRange === undefined
      ? (await files.read(entry.archive))?.slice(entry.offset, entry.end)
      : await files.readRange(entry.archive, entry.offset, span);
  if (read === undefined) throw new Error(`${entry.archive} is gone`);
  const wrong = new Refusal(
    `${entry.path} in ${entry.archive} does not hold the bytes its directory says`,
  );
  if (read.length !== span) throw wrong;
  const fields = view(read);
  if (
    fields.getUint32(0, true) !== LOCAL ||
    fields.getUint16(8, true) !== entry.method ||
    fields.getUint16(26, true) !== entry.name.length ||
    !sameBytes(
      read.subarray(LOCAL_LENGTH, LOCAL_LENGTH + entry.name.length),
      entry.name,
    )
  )
    throw wrong;
  const start = LOCAL_LENGTH + entry.name.length + fields.getUint16(28, true);
  if (start + entry.compressed > span) throw wrong;
  const data = read.subarray(start, start + entry.compressed);
  const bytes =
    entry.method === STORED ? data.slice() : await inflated(data, entry.size);
  if (
    bytes === undefined ||
    bytes.length !== entry.size ||
    crc32(bytes) !== entry.crc
  )
    throw wrong;
  return bytes;
}

/** Each path an opening's archives hold, with the entry it is read from. */
type Held = ReadonlyMap<string, ArchiveEntry>;

/**
 * A pod's files over a host that may keep some of them in ZIP archives, in `folder` (X1): every file at its own path and
 * every entry of every archive named as N9 names one, the archives' folder itself no part of the pod. Each archive's
 * directory is read once, at the first call, and held for the life of this opening; an entry is one ranged read
 * through the host, which keeps no handle on an archive once its reads have ended. A path held in two places with other bytes is refused, naming it,
 * when a listing finds both. A file an archive holds is never written over nor removed.
 */
export class ArchivedFiles implements Files {
  readonly #files: Files;
  readonly #folder: string;
  #held: Promise<Held> | undefined;
  /** The paths found at their own paths and in an archive, compared once. */
  readonly #compared = new Set<string>();

  constructor(files: Files, folder: string) {
    this.#files = files;
    this.iri = files.iri;
    this.#folder = folder.endsWith("/") ? folder : `${folder}/`;
    const { writeAll, writeMany, writeNew, replace, remove } = files;
    if (writeAll !== undefined)
      this.writeAll = async (written) =>
        writeAll.call(files, await this.#kept(written));
    if (writeMany !== undefined)
      this.writeMany = async (written) =>
        writeMany.call(files, await this.#kept(written));
    if (writeNew !== undefined)
      this.writeNew = async (pathOrIri, bytes) => {
        const path = this.#path(pathOrIri);
        if ((await this.#index()).has(path)) return false;
        return writeNew.call(files, path, bytes);
      };
    if (replace !== undefined)
      this.replace = async (pathOrIri, bytes, holds) => {
        const path = this.#path(pathOrIri);
        const entry = (await this.#index()).get(path);
        if (entry === undefined) return replace.call(files, path, bytes, holds);
        const held = await archiveEntryBytes(files, entry);
        if (!sameBytes(held, holds)) return false;
        if (!sameBytes(held, bytes)) throw this.#otherBytes(path);
        return true;
      };
    if (remove !== undefined)
      this.remove = async (pathsOrIris) => {
        const held = await this.#index();
        for (const pathOrIri of pathsOrIris) {
          const entry = held.get(relative(this, pathOrIri));
          if (entry !== undefined)
            throw new Error(
              `${entry.path} is held in ${entry.archive}, and a file an archive holds is never removed`,
            );
        }
        return remove.call(files, pathsOrIris);
      };
  }

  readonly writeAll?: (
    files: Iterable<readonly [string, Uint8Array]>,
  ) => Promise<void>;
  readonly writeMany?: (
    files: Iterable<readonly [string, Uint8Array]>,
  ) => Promise<void>;
  readonly writeNew?: (
    pathOrIri: string,
    bytes: Uint8Array,
  ) => Promise<boolean>;
  readonly replace?: (
    pathOrIri: string,
    bytes: Uint8Array,
    holds: Uint8Array | undefined,
  ) => Promise<boolean>;
  readonly remove?: (pathsOrIris: readonly string[]) => Promise<void>;

  /** The pod's IRI, a value and no getter, so that a proxy over these files reads it as it reads the host's. */
  readonly iri: string;

  /** The path, refused when it is in the archives' folder, which only a host's own writer of archives writes. */
  #path(pathOrIri: string): string {
    const path = relative(this, pathOrIri);
    if (under(this.#folder, path))
      throw new Error(
        `${path} is in the archives' folder, which no file of the pod is written in`,
      );
    return path;
  }

  #otherBytes(path: string): Refusal {
    return new Refusal(`${path} is in the pod already, holding other bytes`);
  }

  /** The files to write but those an archive holds with the same bytes; one an archive holds with other bytes is refused. */
  async #kept(
    written: Iterable<readonly [string, Uint8Array]>,
  ): Promise<[string, Uint8Array][]> {
    const held = await this.#index();
    const kept: [string, Uint8Array][] = [];
    for (const [pathOrIri, bytes] of written) {
      const path = this.#path(pathOrIri);
      const entry = held.get(path);
      if (entry === undefined) kept.push([path, bytes]);
      else if (!sameBytes(await archiveEntryBytes(this.#files, entry), bytes))
        throw this.#otherBytes(path);
    }
    return kept;
  }

  /** Every archive's directory, read at the first call and held; a path two archives hold must hold the same bytes. */
  #index(): Promise<Held> {
    if (this.#held === undefined) {
      const reading = timedAside("archives.open", async () => {
        const archives = (await this.#files.list(this.#folder))
          .filter((path) => ARCHIVE_NAME.test(path.slice(this.#folder.length)))
          .sort();
        const directories = await Promise.all(
          archives.map((archive) =>
            archiveDirectory(this.#files, archive, this.#folder),
          ),
        );
        const held = new Map<string, ArchiveEntry>();
        for (const entries of directories) {
          counted("archives.opened");
          counted("archives.entries", entries.length);
          for (const entry of entries) {
            const first = held.get(entry.path);
            if (first === undefined) held.set(entry.path, entry);
            else if (
              first.size !== entry.size ||
              first.crc !== entry.crc ||
              !sameBytes(
                await archiveEntryBytes(this.#files, first),
                await archiveEntryBytes(this.#files, entry),
              )
            )
              throw new Refusal(
                `${entry.path} is held twice with other bytes, in ${first.archive} and in ${entry.archive}`,
              );
          }
        }
        return held;
      });
      this.#held = reading;
      reading.catch(() => {
        if (this.#held === reading) this.#held = undefined;
      });
    }
    return this.#held;
  }

  /** Refuses the pod when the file at its own path holds other bytes than the archive's entry at that path. */
  async #same(entry: ArchiveEntry): Promise<void> {
    if (this.#compared.has(entry.path)) return;
    const [loose, archived] = await Promise.all([
      this.#files.read(entry.path),
      archiveEntryBytes(this.#files, entry),
    ]);
    if (loose !== undefined && !sameBytes(loose, archived))
      throw new Refusal(
        `${entry.path} is held twice with other bytes, at its own path and in ${entry.archive}`,
      );
    this.#compared.add(entry.path);
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const path = relative(this, pathOrIri);
    if (under(this.#folder, path)) return undefined;
    const entry = (await this.#index()).get(path);
    return entry === undefined
      ? this.#files.read(path)
      : archiveEntryBytes(this.#files, entry);
  }

  async readRange(
    pathOrIri: string,
    start: number,
    length: number,
  ): Promise<Uint8Array | undefined> {
    const path = relative(this, pathOrIri);
    if (under(this.#folder, path)) return undefined;
    const entry = (await this.#index()).get(path);
    if (entry === undefined && this.#files.readRange !== undefined)
      return this.#files.readRange(path, start, length);
    const whole =
      entry === undefined
        ? await this.#files.read(path)
        : await archiveEntryBytes(this.#files, entry);
    if (whole === undefined) return undefined;
    const from = start < 0 ? Math.max(0, whole.length + start) : start;
    return whole.slice(from, from + length);
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    for (const [path, kept] of await this.#kept([[pathOrIri, bytes]]))
      await this.#files.write(path, kept);
  }

  /** Every file at its own path and every entry of every archive under the folder, sorted; none in the archives' folder. */
  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder);
    const [held, loose] = await Promise.all([
      this.#index(),
      this.#files.list(folder),
    ]);
    const paths = new Set(loose.filter((path) => !under(this.#folder, path)));
    for (const [path, entry] of held) {
      if (!under(prefix, path)) continue;
      if (paths.has(path)) await this.#same(entry);
      else paths.add(path);
    }
    return [...paths].sort();
  }
}

/** The pod's files over the host: `ArchivedFiles` in the layout's archives' folder, or, where it gives none, the host's. */
export function archivedFiles(files: Files, layout: Layout): Files {
  return layout.archivesFolder === undefined
    ? files
    : new ArchivedFiles(files, layout.archivesFolder);
}
