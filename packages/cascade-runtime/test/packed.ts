import { createHash } from "node:crypto";
import type { FolderFiles } from "@cascade-runtime/runtime/node";

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

/**
 * Moves the pod's files at the paths into one ZIP archive in `archives/`, named by the SHA-256 of its bytes, and removes
 * them from their own paths, as a host that keeps archives holds them (X1): stored entries in path order, UTF-8 paths,
 * every date 1980-01-01 00:00, no extra field. A test's writer until the runtime has its own; returns the archive's path.
 */
export async function packedFolder(
  files: FolderFiles,
  paths: readonly string[],
): Promise<string> {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const sorted = [...paths].sort();
  for (const path of sorted) {
    const data = Buffer.from((await files.read(path)) ?? []);
    const name = Buffer.from(path, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(header, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...parts, directory, end]);
  const path = `archives/${createHash("sha256").update(archive).digest("hex")}.zip`;
  await files.write(path, new Uint8Array(archive));
  await files.remove(sorted);
  return path;
}
