import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type { Files } from "../src/files.js";

/**
 * A test's ZIP writer, until the runtime has its own: the ISO/IEC 21320-1 profile the vocabulary's X1 rules (stored or
 * deflated entries, UTF-8 paths, a central directory, no extra fields, no ZIP64), with the knobs a test needs to make an
 * archive outside it.
 */
export interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly deflate?: boolean;
  /** The general purpose flags; 0x0800 (UTF-8) unless given. */
  readonly flags?: number;
  /** The compression method; 0 or 8 unless given. */
  readonly method?: number;
  /** The path's bytes, in place of its UTF-8. */
  readonly name?: Uint8Array;
  /** The extra field, in the local header and the central directory. */
  readonly extra?: Uint8Array;
  /** The CRC-32 written, in place of the bytes'. */
  readonly crc?: number;
}

export interface ZipOptions {
  /** Ends the archive before its end of central directory record, as a write that stopped does. */
  readonly torn?: boolean;
  /** Puts a ZIP64 end of central directory locator before the end record. */
  readonly zip64?: boolean;
  /** The number of the disk the central directory starts on. */
  readonly disk?: number;
  /** The archive's comment. */
  readonly comment?: string;
}

const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes)
    c = (TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The ZIP of the entries, in the order given, every date 1980-01-01 00:00. */
export function zipOf(
  entries: readonly ZipEntry[],
  options: ZipOptions = {},
): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(
      entry.name ?? new TextEncoder().encode(entry.path),
    );
    const extra = Buffer.from(entry.extra ?? new Uint8Array());
    const method = entry.method ?? (entry.deflate === true ? 8 : 0);
    const data =
      entry.deflate === true
        ? deflateRawSync(entry.bytes)
        : Buffer.from(entry.bytes);
    const crc = entry.crc ?? crc32(entry.bytes);
    const flags = entry.flags ?? 0x0800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(entry.bytes.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(offset, 42);
    parts.push(local, name, extra, data);
    central.push(header, name, extra);
    offset += local.length + name.length + extra.length + data.length;
  }
  const directory = Buffer.concat(central);
  if (options.torn === true)
    return new Uint8Array(Buffer.concat([...parts, directory]));
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(options.disk ?? 0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  const locator = Buffer.alloc(options.zip64 === true ? 20 : 0);
  if (options.zip64 === true) {
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(1, 16);
  }
  return new Uint8Array(
    Buffer.concat([...parts, directory, locator, end, comment]),
  );
}

/** An archive's name as N9 gives it: the SHA-256 of its bytes in lowercase hex, adding `.zip`. */
export function archiveName(bytes: Uint8Array): string {
  return `${createHash("sha256").update(bytes).digest("hex")}.zip`;
}

/** Writes the archive into the folder under its name, and returns its path. */
export async function archived(
  files: Files,
  bytes: Uint8Array,
  folder = "archives/",
): Promise<string> {
  const path = `${folder}${archiveName(bytes)}`;
  await files.write(path, bytes);
  return path;
}

/**
 * Moves the files at the paths into one archive of stored entries, in path order, as a host that keeps archives
 * would hold them, and removes them from their own paths; returns the archive's path.
 */
export async function packed(
  files: Files & Required<Pick<Files, "remove">>,
  paths: readonly string[],
  folder = "archives/",
): Promise<string> {
  const entries: ZipEntry[] = [];
  for (const path of [...paths].sort()) {
    const bytes = await files.read(path);
    if (bytes === undefined) throw new Error(`${path} is no file to pack`);
    entries.push({ path, bytes });
  }
  const path = await archived(files, zipOf(entries), folder);
  await files.remove(paths);
  return path;
}
