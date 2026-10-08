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

const isRecordOfText = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((text) => typeof text === "string");

/** Whether a value read as JSON is a `FolderPack`. */
export function isFolderPack(value: unknown): value is FolderPack {
  if (typeof value !== "object" || value === null) return false;
  const { paths, text, base64 } = value as Partial<Record<string, unknown>>;
  return (
    Array.isArray(paths) &&
    paths.every((path) => typeof path === "string") &&
    isRecordOfText(text) &&
    isRecordOfText(base64)
  );
}

/** The bytes of the file at `path`, decoded from the pack when it is read; none where the pack does not hold it. */
export function unpackFile(
  pack: FolderPack,
  path: string,
): Uint8Array | undefined {
  const text = Object.hasOwn(pack.text, path) ? pack.text[path] : undefined;
  if (text !== undefined) return new TextEncoder().encode(text);
  const base64 = Object.hasOwn(pack.base64, path)
    ? pack.base64[path]
    : undefined;
  return base64 === undefined ? undefined : bytesOf(base64);
}

/** The bytes of each file the pack holds, by its path. */
export function unpackFolder(pack: FolderPack): Map<string, Uint8Array> {
  return new Map(
    [...Object.keys(pack.text), ...Object.keys(pack.base64)].flatMap((path) => {
      const bytes = unpackFile(pack, path);
      return bytes === undefined ? [] : [[path, bytes] as const];
    }),
  );
}
