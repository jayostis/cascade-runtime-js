/**
 * A folder's files as one JSON document, for a host that fetches them: `paths` lists every file of the folder, as its
 * `files.json` does; `text` and `base64` hold the bytes of those packed, as UTF-8 text where they are that, else as
 * base64. A listed path in neither is read from the folder.
 */
export interface FolderPack {
  readonly paths: readonly string[];
  readonly text: Readonly<Record<string, string>>;
  readonly base64: Readonly<Record<string, string>>;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const CHUNK = 0x8000;

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary);
}

function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** The pack of a folder listing `paths`, holding the files given. */
export function packFolder(
  paths: readonly string[],
  files: ReadonlyMap<string, Uint8Array>,
): FolderPack {
  const text: Record<string, string> = {};
  const base64: Record<string, string> = {};
  for (const [path, bytes] of files) {
    try {
      text[path] = UTF8.decode(bytes);
    } catch {
      base64[path] = base64Of(bytes);
    }
  }
  return { paths, text, base64 };
}

/** The bytes of each file the pack holds, by its path. */
export function unpackFolder(pack: FolderPack): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  return new Map([
    ...Object.entries(pack.text).map(
      ([path, text]) => [path, encoder.encode(text)] as const,
    ),
    ...Object.entries(pack.base64).map(
      ([path, base64]) => [path, bytesOf(base64)] as const,
    ),
  ]);
}
