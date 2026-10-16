import { type Files, relative, writeAll } from "./files.js";
import { same } from "./pod.js";
import { Refusal } from "./step.js";
import { looseNumbers, parseStrictJson } from "./strict-json.js";

/** The encryption header's path in a pod: plaintext, and present only in an encrypted pod. */
export const HEADER = "settings/encryption.json";
/** The pod's files that stay plaintext in an encrypted pod (`pod-encryption.md` §3.2). */
const PLAINTEXT = new Set([HEADER, "README.md", "provenance/egress-log.jsonl"]);
const HEADER_MAX_BYTES = 65536;
const MAX_WRAPS = 16;
const MAX_PASSPHRASE_WRAPS = 6;
const SEAL_MAX_BYTES = 256 * 1024 * 1024;
const NONCE = 12;
const TAG = 16;

export interface Argon2Params {
  readonly t: number;
  readonly m: number;
  readonly p: number;
}

/** What a new passphrase wrap derives its key with. */
export const ARGON2_PARAMS: Argon2Params = { t: 3, m: 65536, p: 1 };

/**
 * Argon2id (version 0x13, a 32-byte output, no secret value or associated data) of the secret's UTF-8 bytes: the key
 * that wraps a pod's data key. Handed in, as a store factory is, so the core runs none itself.
 */
export type DeriveKey = (
  secret: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
) => Promise<Uint8Array>;

/** Why an encrypted pod did not open: `pod-encryption.md` §5.4's outcomes, and two of the package's own. */
export type UnopenedOutcome =
  | "malformed"
  | "unsupported version"
  | "cannot open"
  | "incorrect secret"
  | "secret needed"
  | "not encrypted";

/** An encrypted pod that did not open, and why. Its message names a field, never a header's value or the secret. */
export class Unopened extends Refusal {
  constructor(
    readonly outcome: UnopenedOutcome,
    message: string,
  ) {
    super(message);
  }
}

interface PassphraseWrap {
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly params: Argon2Params;
  readonly wrapped: Uint8Array<ArrayBuffer>;
}

export type HeaderVersion = "1.0" | "1.1" | "1.2";

/** A header that validated: its version, and its passphrase wraps in order. */
export interface Header {
  readonly version: HeaderVersion;
  readonly passphrases: readonly PassphraseWrap[];
}

/** An encrypted pod's data key, opened from the header bytes it was opened with. */
export interface PodKey {
  readonly version: HeaderVersion;
  readonly header: Uint8Array;
  readonly key: CryptoKey;
}

const encoded = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(text));

function copied(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function joined(...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const random = (length: number): Uint8Array<ArrayBuffer> =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Canonical padded base64's bytes, or none: decoding and encoding again must give the same text. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!BASE64.test(text)) return undefined;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return base64(bytes) === text ? bytes : undefined;
}

const malformed = (what: string): never => {
  throw new Unopened(
    "malformed",
    `The pod's encryption header is malformed: ${what}.`,
  );
};

type Members = Record<string, unknown>;
const isObject = (value: unknown): value is Members =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const has = (object: Members, name: string) =>
  Object.prototype.hasOwnProperty.call(object, name);

function binary(
  value: unknown,
  what: string,
  length: number,
): Uint8Array<ArrayBuffer> {
  const bytes = typeof value === "string" ? fromBase64(value) : undefined;
  if (bytes === undefined) return malformed(`${what} is not canonical base64`);
  if (bytes.length !== length)
    return malformed(`${what} is not ${length} bytes`);
  return bytes;
}

function digits(object: Members, name: string, what: string): number {
  const value = object[name];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    looseNumbers(object).has(name)
  )
    return malformed(`${what} is not written as plain decimal digits`);
  return value;
}

function kdfParams(
  value: unknown,
  at: string,
): { salt: Uint8Array<ArrayBuffer>; params: Argon2Params } {
  if (!isObject(value)) return malformed(`${at}kdfParams is not an object`);
  const salt = binary(value.salt, `${at}kdfParams.salt`, 16);
  const t = digits(value, "t", `${at}kdfParams.t`);
  const m = digits(value, "m", `${at}kdfParams.m`);
  const p = digits(value, "p", `${at}kdfParams.p`);
  if (t < 1 || t > 6) malformed(`${at}kdfParams.t is outside 1 to 6`);
  if (p < 1 || p > 4) malformed(`${at}kdfParams.p is outside 1 to 4`);
  if (m < 8 * p || m > 131072)
    malformed(`${at}kdfParams.m is outside 8p to 131072`);
  return { salt, params: { t, m, p } };
}

function headerOf(value: unknown): Header {
  if (!isObject(value)) return malformed("it is not a JSON object");
  const { version } = value;
  if (typeof version !== "string")
    return malformed("version is missing or not a string");
  if (version !== "1.0" && version !== "1.1" && version !== "1.2")
    throw new Unopened(
      "unsupported version",
      "The pod's encryption header has a version this runtime does not know.",
    );
  if (value.algorithm !== "aes-256-gcm")
    malformed("algorithm is not aes-256-gcm");
  const { wraps } = value;
  if (!Array.isArray(wraps)) return malformed("wraps is not an array");
  if (wraps.length === 0) malformed("wraps is empty");
  if (wraps.length > MAX_WRAPS)
    malformed(`it has more than ${MAX_WRAPS} wraps`);
  let shared: ReturnType<typeof kdfParams> | undefined;
  if (version === "1.0") {
    if (!has(value, "kdf")) malformed("a 1.0 header has no kdf");
    if (!has(value, "kdfParams")) malformed("a 1.0 header has no kdfParams");
    if (value.kdf !== "argon2id") malformed("kdf is not argon2id");
    shared = kdfParams(value.kdfParams, "");
  } else {
    if (has(value, "kdf") || has(value, "kdfParams"))
      malformed(`a ${version} header has a top-level kdf or kdfParams`);
    if (
      version === "1.2" &&
      (value.resourceFormat !== 2 || looseNumbers(value).has("resourceFormat"))
    )
      malformed("resourceFormat is not 2");
  }
  const passphrases: PassphraseWrap[] = [];
  wraps.forEach((wrap: unknown, index) => {
    const at = `wraps[${index}].`;
    if (!isObject(wrap)) return malformed(`wraps[${index}] is not an object`);
    if (typeof wrap.by !== "string" || wrap.by === "")
      return malformed(`${at}by is missing, empty or not a string`);
    if (version !== "1.0")
      for (const name of ["label", "createdAt"])
        if (
          !has(wrap, name) ||
          (wrap[name] !== null && typeof wrap[name] !== "string")
        )
          malformed(`${at}${name} is missing, or neither a string nor null`);
    if (wrap.by !== "passphrase") return undefined;
    let derived = shared;
    if (derived === undefined) {
      if (wrap.kdf !== "argon2id") malformed(`${at}kdf is not argon2id`);
      derived = kdfParams(wrap.kdfParams, at);
    }
    const wrapped = binary(wrap.wrappedDek, `${at}wrappedDek`, 60);
    passphrases.push({ ...derived, wrapped });
    return undefined;
  });
  if (passphrases.length > MAX_PASSPHRASE_WRAPS)
    malformed(`it has more than ${MAX_PASSPHRASE_WRAPS} passphrase wraps`);
  if (passphrases.length === 0)
    throw new Unopened(
      "cannot open",
      "The pod's encryption header has no passphrase wrap: it is opened some other way.",
    );
  return { version, passphrases };
}

/** The header in the bytes, every rule and limit checked before anything is derived; throws `Unopened` otherwise. */
export function readHeader(bytes: Uint8Array): Header {
  if (bytes.length > HEADER_MAX_BYTES)
    malformed(`it is over ${HEADER_MAX_BYTES} bytes`);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    malformed("it begins with a byte order mark");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return malformed("it is not UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJson(text);
  } catch (error) {
    return malformed(`it is not strict JSON: ${(error as Error).message}`);
  }
  return headerOf(parsed);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  const bytes = copied(raw);
  try {
    return await globalThis.crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    bytes.fill(0);
  }
}

/** `nonce(12) || ciphertext || tag(16)`, under a fresh nonce. */
async function seal(
  key: CryptoKey,
  plain: Uint8Array,
  aad?: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = random(NONCE);
  const sealed = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: TAG * 8,
      ...(aad === undefined ? {} : { additionalData: aad }),
    },
    key,
    copied(plain),
  );
  return joined(iv, new Uint8Array(sealed));
}

/** The plaintext of a sealed file, or none when it does not authenticate. */
async function opened(
  key: CryptoKey,
  sealed: Uint8Array,
  aad?: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array | undefined> {
  if (sealed.length < NONCE + TAG) return undefined;
  const bytes = copied(sealed);
  try {
    return new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes.subarray(0, NONCE),
          tagLength: TAG * 8,
          ...(aad === undefined ? {} : { additionalData: aad }),
        },
        key,
        bytes.subarray(NONCE),
      ),
    );
  } catch (error) {
    if ((error as Error).name === "OperationError") return undefined;
    throw error;
  }
}

async function dataKey(raw: Uint8Array): Promise<CryptoKey> {
  try {
    return await aesKey(raw);
  } finally {
    raw.fill(0);
  }
}

/**
 * The pod's key: the header read (`readHeader`), then each passphrase wrap tried in order with the secret's UTF-8
 * bytes exactly as given. Throws `Unopened` with "incorrect secret" when none opens.
 */
export async function openHeader(
  bytes: Uint8Array,
  secret: string,
  derive: DeriveKey,
): Promise<PodKey> {
  const { version, passphrases } = readHeader(bytes);
  const header = copied(bytes);
  const secretBytes = encoded(secret);
  try {
    for (const wrap of passphrases) {
      const kek = await derive(secretBytes, wrap.salt, wrap.params);
      let raw: Uint8Array | undefined;
      try {
        raw = await opened(await aesKey(kek), wrap.wrapped);
      } finally {
        kek.fill(0);
      }
      if (raw === undefined) continue;
      if (raw.length !== 32) {
        raw.fill(0);
        continue;
      }
      return { version, header, key: await dataKey(raw) };
    }
  } finally {
    secretBytes.fill(0);
  }
  throw new Unopened(
    "incorrect secret",
    "The secret opens none of the pod's passphrase wraps.",
  );
}

/** A new `1.2` header holding one passphrase wrap, labelled "primary", of a new data key under the secret; and that key. */
export async function newHeader(
  secret: string,
  derive: DeriveKey,
): Promise<{ readonly bytes: Uint8Array; readonly key: PodKey }> {
  const salt = random(16);
  const raw = random(32);
  const secretBytes = encoded(secret);
  let kek: Uint8Array;
  try {
    kek = await derive(secretBytes, salt, ARGON2_PARAMS);
  } finally {
    secretBytes.fill(0);
  }
  let wrapped: Uint8Array;
  try {
    wrapped = await seal(await aesKey(kek), raw);
  } finally {
    kek.fill(0);
  }
  const bytes = encoded(
    `${JSON.stringify(
      {
        version: "1.2",
        algorithm: "aes-256-gcm",
        resourceFormat: 2,
        wraps: [
          {
            by: "passphrase",
            label: "primary",
            createdAt: new Date().toISOString(),
            kdf: "argon2id",
            kdfParams: { salt: base64(salt), ...ARGON2_PARAMS },
            wrappedDek: base64(wrapped),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  readHeader(bytes);
  return {
    bytes,
    key: { version: "1.2", header: copied(bytes), key: await dataKey(raw) },
  };
}

/** What a file is bound to: its path in a `1.2` pod (D-SEAL-1), its name in an answer cache; nothing in a `1.0` or `1.1` pod. */
function boundTo(
  kind: "pod" | "answers",
  version: HeaderVersion,
  path: string,
): Uint8Array<ArrayBuffer> | undefined {
  if (kind === "answers")
    return joined(encoded("cascade-runtime-answers"), [0], encoded(path));
  if (version !== "1.2") return undefined;
  return joined(
    encoded("cascade-pod-resource"),
    [0],
    encoded("2"),
    [0],
    encoded(path),
  );
}

export interface EncryptedFilesOptions {
  /** The largest file sealed, in bytes; 256 MiB unless given. */
  readonly maxBytes?: number;
  /** A pod's files, or its answer cache's, which has no plaintext files and no header. */
  readonly kind?: "pod" | "answers";
}

/**
 * The files beneath, each sealed on write and opened on read under the pod's key, but a pod's plaintext ones; a pod's
 * header is never listed. A pod's file that does not open is refused, naming its path, and never read as plaintext; an
 * answer cache's reads as absent.
 */
export class EncryptedFiles implements Files {
  readonly #files: Files;
  readonly #key: PodKey;
  readonly #maxBytes: number;
  readonly #kind: "pod" | "answers";

  constructor(files: Files, key: PodKey, options: EncryptedFilesOptions = {}) {
    this.#files = files;
    this.#key = key;
    this.#maxBytes = options.maxBytes ?? SEAL_MAX_BYTES;
    this.#kind = options.kind ?? "pod";
  }

  get iri(): string {
    return this.#files.iri;
  }

  #plain(path: string): boolean {
    return this.#kind === "pod" && PLAINTEXT.has(path);
  }

  /** The canonical path, which is what is stored and what a file is bound to; any other spelling of one is refused. */
  #path(pathOrIri: string): string {
    const path = pathOrIri.startsWith(this.iri)
      ? pathOrIri.slice(this.iri.length)
      : pathOrIri;
    if (
      path === "" ||
      path.includes("\\") ||
      path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    )
      throw new Refusal(
        `${path} is not a canonical path: it has a leading or doubled slash, a . or .. segment, or a backslash`,
      );
    return relative(this, path);
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const path = this.#path(pathOrIri);
    const bytes = await this.#files.read(path);
    if (bytes === undefined || this.#plain(path)) return bytes;
    const plain = await opened(
      this.#key.key,
      bytes,
      boundTo(this.#kind, this.#key.version, path),
    );
    if (plain !== undefined || this.#kind === "answers") return plain;
    await this.#headerUnchanged();
    throw new Refusal(
      `${path} does not open under the pod's key: it was changed, moved from another path or sealed under another key`,
    );
  }

  write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    return this.writeAll([[pathOrIri, bytes]]);
  }

  /** Refuses when a pod's header on disk is not the one the key was opened from; an answer cache has none. */
  async #headerUnchanged(): Promise<void> {
    if (this.#kind !== "pod") return;
    const header = await this.#files.read(HEADER);
    if (header === undefined || !same(header, this.#key.header))
      throw new Refusal(
        "the pod's header changed since it was opened; open it again",
      );
  }

  /** Seals every file, then writes them in one `writeAll` beneath, once the header is the one the key was opened from. */
  async writeAll(
    files: Iterable<readonly [string, Uint8Array]>,
  ): Promise<void> {
    const given: (readonly [string, Uint8Array])[] = [];
    for (const [pathOrIri, bytes] of files) {
      const path = this.#path(pathOrIri);
      if (this.#kind === "pod" && path.toLowerCase() === HEADER.toLowerCase())
        throw new Refusal(
          `${HEADER} is written only when the pod's encryption is made`,
        );
      if (!this.#plain(path) && bytes.length > this.#maxBytes)
        throw new Refusal(
          `${path} is too large to seal as one file: ${bytes.length} bytes, over ${this.#maxBytes}`,
        );
      given.push([path, bytes]);
    }
    if (this.#kind === "pod") await this.#headerUnchanged();
    const sealed: (readonly [string, Uint8Array])[] = [];
    for (const [path, bytes] of given)
      sealed.push([
        path,
        this.#plain(path)
          ? bytes
          : await seal(
              this.#key.key,
              bytes,
              boundTo(this.#kind, this.#key.version, path),
            ),
      ]);
    await writeAll(this.#files, sealed);
  }

  /** Every path beneath, but a pod's header: above the sealing, a pod holds only its own files. */
  async list(folder: string): Promise<string[]> {
    const paths = await this.#files.list(folder);
    return this.#kind === "pod"
      ? paths.filter((path) => path !== HEADER)
      : paths;
  }
}
