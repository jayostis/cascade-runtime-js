import {
  type Files,
  relative,
  replaced,
  sameBytes,
  under,
  writeAll,
} from "./files.js";
import { same } from "./pod.js";
import { Refusal } from "./step.js";
import { looseNumbers, parseStrictJson } from "./strict-json.js";

/** The encryption header's path in a pod: plaintext, and present only in an encrypted pod. */
export const HEADER = "settings/encryption.json";
/** The pod's files that stay plaintext in an encrypted pod (`pod-encryption.md` §3.2). */
const PLAINTEXT = new Set([HEADER, "README.md", "provenance/egress-log.jsonl"]);
/** The folder a 1.3 pod keeps its sealed files in, each under its keyed name, in one of 256 folders by its first two letters. */
const SEALED = "sealed";
/**
 * The folder a 1.3 pod keeps its sealed index in: each write of the index a new file, named by its counter in decimal
 * and made only where none is, so that of two openings that write one pod from the same index only one writes it.
 */
export const SEALED_INDEX = "sealed/index";
/** The claim an upgrade to 1.3 holds while it runs: sealed as a file of the version it upgrades from, a Turtle comment. */
export const UPGRADE_CLAIM = "upgrading.ttl";
const HEADER_MAX_BYTES = 65536;
const MAX_WRAPS = 16;
const MAX_PASSPHRASE_WRAPS = 6;
/** The most Argon2 work, the sum of `t` times `m` over a header's passphrase wraps, that a header may ask for: eight times a new pod's wrap, or two wraps of the largest cost. */
export const MAX_ARGON2_COST = 8 * 3 * 65536;
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
  | "not encrypted"
  | "changed outside the runtime";

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

export type HeaderVersion = "1.0" | "1.1" | "1.2" | "1.3";

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
  /** HMAC-SHA-256 under HKDF-SHA-256 of the data key, no salt, info `cascade-pod-names`: what a 1.3 pod's files are named by. */
  readonly names: CryptoKey;
}

const changed = (what: string): Unopened =>
  new Unopened(
    "changed outside the runtime",
    `The pod was changed outside the runtime: ${what}. Restore it from a copy.`,
  );

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
  if (
    version !== "1.0" &&
    version !== "1.1" &&
    version !== "1.2" &&
    version !== "1.3"
  )
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
    const format = version === "1.2" ? 2 : version === "1.3" ? 3 : undefined;
    if (
      format !== undefined &&
      (value.resourceFormat !== format ||
        looseNumbers(value).has("resourceFormat"))
    )
      malformed(`resourceFormat is not ${format}`);
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
  const cost = passphrases.reduce(
    (sum, { params }) => sum + params.t * params.m,
    0,
  );
  if (cost > MAX_ARGON2_COST)
    malformed(
      `its passphrase wraps ask for more than ${MAX_ARGON2_COST} of t times m in all`,
    );
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
  const bytes = copied(plain);
  try {
    const sealed = await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: TAG * 8,
        ...(aad === undefined ? {} : { additionalData: aad }),
      },
      key,
      bytes,
    );
    return joined(iv, new Uint8Array(sealed));
  } finally {
    bytes.fill(0);
  }
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

async function namesKey(raw: Uint8Array): Promise<CryptoKey> {
  const bytes = copied(raw);
  try {
    const base = await globalThis.crypto.subtle.importKey(
      "raw",
      bytes,
      "HKDF",
      false,
      ["deriveKey"],
    );
    return await globalThis.crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: encoded("cascade-pod-names"),
      },
      base,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    );
  } finally {
    bytes.fill(0);
  }
}

/** The data key, and the key its files are named by, derived before its raw bytes are zeroed. */
async function dataKey(
  raw: Uint8Array,
): Promise<{ readonly key: CryptoKey; readonly names: CryptoKey }> {
  try {
    const [key, names] = await Promise.all([aesKey(raw), namesKey(raw)]);
    return { key, names };
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
      return { version, header, ...(await dataKey(raw)) };
    }
  } finally {
    secretBytes.fill(0);
  }
  throw new Unopened(
    "incorrect secret",
    "The secret opens none of the pod's passphrase wraps.",
  );
}

/**
 * A new `1.3` header holding one passphrase wrap, labelled "primary", of a new data key under the secret; and that key.
 * Each byte copy of the data key and of the key that wraps it is zeroed after use, as far as JavaScript allows: a string
 * or WebAssembly memory cannot be cleared.
 */
export async function newHeader(
  secret: string,
  derive: DeriveKey,
): Promise<{ readonly bytes: Uint8Array; readonly key: PodKey }> {
  const salt = random(16);
  const secretBytes = encoded(secret);
  let kek: Uint8Array;
  try {
    kek = await derive(secretBytes, salt, ARGON2_PARAMS);
  } finally {
    secretBytes.fill(0);
  }
  const raw = random(32);
  let wrapped: Uint8Array;
  try {
    wrapped = await seal(await aesKey(kek), raw);
  } finally {
    kek.fill(0);
  }
  const bytes = encoded(
    `${JSON.stringify(
      {
        version: "1.3",
        algorithm: "aes-256-gcm",
        resourceFormat: 3,
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
    key: { version: "1.3", header: copied(bytes), ...(await dataKey(raw)) },
  };
}

/**
 * The `1.3` header of a pod whose header is an earlier version: the same wraps of the same data key, each passphrase
 * wrap stating its own `kdf` and `kdfParams` and every wrap its `label` and `createdAt`, as from `1.1` on. Its bytes
 * depend on the earlier header's alone, so two openings that upgrade one pod write the same header.
 */
export function upgradedHeader(earlier: Uint8Array): Uint8Array {
  const { version } = readHeader(earlier);
  if (version === "1.3") return copied(earlier);
  const value = JSON.parse(new TextDecoder().decode(earlier)) as Members;
  const { kdf, kdfParams, ...rest } = value;
  const wraps = (value.wraps as Members[]).map((wrap) =>
    version !== "1.0"
      ? wrap
      : {
          label: null,
          createdAt: null,
          ...wrap,
          ...(wrap.by === "passphrase" ? { kdf, kdfParams } : {}),
        },
  );
  const bytes = encoded(
    `${JSON.stringify({ ...rest, version: "1.3", resourceFormat: 3, wraps }, null, 2)}\n`,
  );
  readHeader(bytes);
  return bytes;
}

const RESOURCE = encoded("cascade-pod-resource");
/** What a 1.3 pod's sealed index is bound to: its own domain, apart from any file's. */
const INDEX_BOUND = joined(encoded("cascade-pod-index"), [0], encoded("3"));

/**
 * What a file is bound to: its path in a `1.2` pod (D-SEAL-1) and in a `1.3` pod, under resource format 2 and 3, its
 * name in an answer cache; nothing in a `1.0` or `1.1` pod. A 1.3 pod's path is the file's own, not the keyed name it is
 * stored under, so a file moved to another's name does not open.
 */
function boundTo(
  kind: "pod" | "answers",
  version: HeaderVersion,
  path: string,
): Uint8Array<ArrayBuffer> | undefined {
  if (kind === "answers")
    return joined(encoded("cascade-runtime-answers"), [0], encoded(path));
  if (version !== "1.2" && version !== "1.3") return undefined;
  return joined(
    RESOURCE,
    [0],
    encoded(version === "1.2" ? "2" : "3"),
    [0],
    encoded(path),
  );
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

const HEX = /^(?:[0-9a-f]{2})+$/;

function fromHex(text: string, length: number): Uint8Array | undefined {
  if (text.length !== length * 2 || !HEX.test(text)) return undefined;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++)
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * The name a 1.3 pod stores a sealed file under: HMAC-SHA-256 under the names key of the path's UTF-8 bytes, a zero
 * byte and the file's GCM tag, in lower-case hex, in the folder its first two letters name. The tag makes each sealing
 * of a path a file of its own, so a write never replaces a file the stored index names.
 */
async function keyedName(
  names: CryptoKey,
  path: string,
  tag: Uint8Array,
): Promise<string> {
  const mac = hex(
    new Uint8Array(
      await globalThis.crypto.subtle.sign(
        "HMAC",
        names,
        joined(encoded(path), [0], tag),
      ),
    ),
  );
  return `${SEALED}/${mac.slice(0, 2)}/${mac.slice(2)}`;
}

const tagOf = (sealed: Uint8Array): Uint8Array =>
  sealed.subarray(sealed.length - TAG);

/** Where a 1.3 pod's sealed index names a file to be: its keyed name, and the GCM tag of its sealing. */
interface Named {
  readonly name: string;
  readonly tag: Uint8Array;
}

/** A sealed index's plaintext: its counter, and each path with its keyed name and its tag in hex, sorted by path. */
function indexBytes(counter: number, entries: Map<string, Named>): Uint8Array {
  const files = [...entries]
    .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
    .map(([path, { name, tag }]) => [
      path,
      name.slice(SEALED.length + 1).replace("/", ""),
      hex(tag),
    ]);
  return encoded(JSON.stringify({ counter, files }));
}

function indexOf(
  plain: Uint8Array,
): { counter: number; entries: Map<string, Named> } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    return undefined;
  }
  if (!isObject(value) || !Array.isArray(value.files)) return undefined;
  const { counter } = value;
  if (typeof counter !== "number" || !Number.isSafeInteger(counter))
    return undefined;
  const entries = new Map<string, Named>();
  for (const entry of value.files as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 3) return undefined;
    const [path, mac, tag] = entry as unknown[];
    if (typeof path !== "string" || typeof mac !== "string") return undefined;
    const tagBytes = typeof tag === "string" ? fromHex(tag, TAG) : undefined;
    if (fromHex(mac, 32) === undefined || tagBytes === undefined)
      return undefined;
    entries.set(path, {
      name: `${SEALED}/${mac.slice(0, 2)}/${mac.slice(2)}`,
      tag: tagBytes,
    });
  }
  return { counter, entries };
}

/** What opening a pod's sealed index takes besides the pod: how it waits on an upgrade's claim, and what the pod layout uses. */
export interface SealedIndexOptions {
  /** How long a claim holds once it was last renewed, in milliseconds; 30 seconds unless given. */
  readonly claimHolds?: number;
  /** How often a claim is renewed while its upgrade runs, and looked at by an opening waiting on it; 5 seconds and 100 milliseconds unless given. */
  readonly renewEvery?: number;
  readonly lookEvery?: number;
  /** The time now, in milliseconds. */
  readonly now?: () => number;
  /**
   * `files.list("")`, begun before the key was derived so the two overlap; a file the index names that it lacks, or an
   * index it lacks, is looked for in a listing taken again before the pod is refused.
   */
  readonly listing?: Promise<readonly string[]>;
  /**
   * Whether the pod layout uses the path. An upgrade leaves where it is a file that does not open at a path the layout
   * does not use, such as a `.DS_Store`, and refuses the pod as changed outside the runtime for one at a path it uses.
   * Every path, unless given.
   */
  readonly laidOut?: (path: string) => boolean;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The files a pod holds as an earlier version stores them: by their own paths, but its header, its plaintext ones, a claim and a 1.3 pod's sealed folder. */
const isEarlierFile = (path: string) =>
  !PLAINTEXT.has(path) && path !== UPGRADE_CLAIM && !under(SEALED, path);

const AGAIN =
  "the pod was written by another opening since this one opened it; open it again";

const indexAt = (counter: number): string => `${SEALED_INDEX}/${counter}`;

/** The counters of the stored indexes among the paths, highest first. */
function countersIn(paths: readonly string[]): number[] {
  const counters: number[] = [];
  for (const path of paths) {
    if (!under(SEALED_INDEX, path)) continue;
    const counter = path.slice(SEALED_INDEX.length + 1);
    if (/^(?:0|[1-9]\d{0,14})$/.test(counter)) counters.push(Number(counter));
  }
  return counters.sort((one, other) => other - one);
}

/** Writes the file only where none is: `writeNew`, or, where the files have none, a `replace` of no file. */
const created = (
  files: Files,
  path: string,
  bytes: Uint8Array,
): Promise<boolean> =>
  files.writeNew
    ? files.writeNew(path, bytes)
    : replaced(files, path, bytes, undefined);

/** Whether the bytes are a file an earlier version sealed at the path under the pod's key. */
async function sealedEarlier(
  key: PodKey,
  bytes: Uint8Array,
  path: string,
): Promise<boolean> {
  for (const version of ["1.2", "1.1"] as const)
    if (
      (await opened(key.key, bytes, boundTo("pod", version, path))) !==
      undefined
    )
      return true;
  return false;
}

/**
 * Makes a new 1.3 pod in the files, with the header and key `newHeader` gave: its empty sealed index, then its header,
 * each only where none is, so that a 1.3 header with no index beside it is never a pod being made. False when another
 * opening made the pod, or is making it.
 */
export async function madeNewPod(
  files: Files,
  made: { readonly bytes: Uint8Array; readonly key: PodKey },
): Promise<boolean> {
  const empty = await seal(made.key.key, indexBytes(0, new Map()), INDEX_BOUND);
  if (!(await created(files, indexAt(0), empty))) return false;
  if (await created(files, HEADER, made.bytes)) return true;
  await files.remove?.([indexAt(0)]);
  return false;
}

/**
 * A 1.3 pod's sealed index, read and opened once per open and held: each of its files' path, with the keyed name it is
 * stored under and the GCM tag it was sealed with, and a counter that rises with every write of the index. A file is
 * read only when it is the copy the index names; writes are one index write each, refused when the stored index is
 * no longer the one held.
 */
export class SealedIndex {
  readonly #files: Files;
  #key: PodKey;
  #entries: Map<string, Named>;
  #counter: number;
  /** The index's bytes as last read or written; none before its first write. */
  #stored: Uint8Array | undefined;
  #sorted: string[] | undefined;
  #writing: Promise<unknown> = Promise.resolve();
  /** Whether a write of this opening has removed every stored file the index did not name. */
  #swept = false;
  /** The plaintext files the pod holds, but its header: found when it was opened, and each written since. */
  readonly #plaintext: Set<string>;

  private constructor(
    files: Files,
    key: PodKey,
    counter: number,
    entries: Map<string, Named>,
    stored: Uint8Array | undefined,
    listing: readonly string[],
  ) {
    this.#files = files;
    this.#key = key;
    this.#counter = counter;
    this.#entries = entries;
    this.#stored = stored;
    this.#plaintext = new Set(
      listing.filter((path) => PLAINTEXT.has(path) && path !== HEADER),
    );
  }

  /** The 1.3 key the index was opened under. */
  get key(): PodKey {
    return this.#key;
  }

  /**
   * The pod's sealed index, the pod upgraded to 1.3 first when its header is an earlier version. Throws `Unopened`,
   * `changed outside the runtime`, for an index that does not open, a file it names that is missing, a 1.3 header with
   * no index, or an earlier header beside an index. Waits while another opening upgrades the pod, and opens again from
   * the start when another opening writes the pod while it opens.
   */
  static async open(
    files: Files,
    key: PodKey,
    options: SealedIndexOptions = {},
  ): Promise<SealedIndex> {
    const now = options.now ?? Date.now;
    const holds = options.claimHolds ?? 30_000;
    const lookEvery = options.lookEvery ?? 100;
    const upgraded = upgradedHeader(key.header);
    let early = options.listing;
    for (;;) {
      const header = await files.read(HEADER);
      let current = key;
      if (header === undefined || !same(header, key.header)) {
        if (header === undefined || !same(header, upgraded))
          throw new Refusal(
            "the pod's header changed since it was opened; open it again",
          );
        current = { ...key, version: "1.3", header: upgraded };
      }
      const begun = await early?.catch(() => undefined);
      early = undefined;
      const [listing, claim] = await Promise.all([
        begun ?? files.list(""),
        files.read(UPGRADE_CLAIM),
      ]);
      const [counter] = countersIn(listing);
      if (counter === undefined && begun !== undefined) continue;
      if (counter !== undefined) {
        if (current.version !== "1.3")
          throw changed(
            `its header says version ${current.version} beside a 1.3 sealed index`,
          );
        const index = await SealedIndex.#opened(
          files,
          current,
          counter,
          listing,
        );
        if (index === undefined) continue;
        if (claim !== undefined) await index.#upgradeEnded(listing);
        return index;
      }
      if (claim !== undefined) {
        const claimed = await claimOf(current, claim);
        if (claimed === undefined)
          throw changed("its upgrade's claim does not open under its key");
        if (now() - claimed.at < holds) {
          await sleep(lookEvery);
          continue;
        }
        const taken = await SealedIndex.#upgrade(
          files,
          { ...current, version: claimed.from },
          options,
          { bytes: claim, count: claimed.count },
        );
        if (taken !== undefined) return taken;
        continue;
      }
      if (current.version === "1.3")
        throw changed("its sealed index is missing");
      const upgrading = await SealedIndex.#upgrade(files, current, options);
      if (upgrading !== undefined) return upgrading;
    }
  }

  /**
   * The index stored under the counter, each file it names found in the listing or in one taken again; none when
   * another opening wrote a later index since the listing, so that the pod is opened again.
   */
  static async #opened(
    files: Files,
    key: PodKey,
    counter: number,
    listing: readonly string[],
  ): Promise<SealedIndex | undefined> {
    const stored = await files.read(indexAt(counter));
    if (stored === undefined) return undefined;
    const plain = await opened(key.key, stored, INDEX_BOUND);
    const read = plain === undefined ? undefined : indexOf(plain);
    if (read === undefined || read.counter !== counter)
      throw changed("its sealed index does not open under its key");
    let held = new Set(listing);
    let listedAgain = false;
    for (const [path, { name }] of read.entries) {
      if (held.has(name)) continue;
      if (!listedAgain) {
        listedAgain = true;
        held = new Set((listing = await files.list("")));
        if (held.has(name)) continue;
      }
      if (countersIn(await files.list(SEALED_INDEX))[0] !== counter)
        return undefined;
      throw changed(`${path} is missing`);
    }
    return new SealedIndex(files, key, counter, read.entries, stored, listing);
  }

  /**
   * Ends an upgrade that stopped after writing its index: removes each file the earlier version stored at a path the
   * index names, then the claim. A failure leaves both for the next opening.
   */
  async #upgradeEnded(listing: readonly string[]): Promise<void> {
    const earlier: string[] = [];
    for (const path of listing.filter(isEarlierFile))
      if (this.#entries.has(path)) {
        const bytes = await this.#files.read(path);
        if (
          bytes !== undefined &&
          (await sealedEarlier(this.#key, bytes, path))
        )
          earlier.push(path);
      }
    await Promise.resolve(this.#files.remove?.(earlier))
      .then(() => this.#files.remove?.([UPGRADE_CLAIM]))
      .catch(() => undefined);
  }

  /**
   * The pod, held as an earlier version, upgraded in place to 1.3. Claimed, or a claim held too long taken over by
   * replacing its bytes, so that a claim is there until the upgrade ends; every earlier file looked at before the 1.3
   * header is written, and how many open stated in the claim; then each sealed again under its keyed name, the index
   * written, and the earlier files removed, the claim last. None when another opening claimed or finished it first.
   * Refused while the pod is still whole as the earlier version, its claim removed, for a file that does not open at a
   * path the layout uses; and, once its header says 1.3, for fewer files than the claim states.
   */
  static async #upgrade(
    files: Files,
    earlier: PodKey,
    options: SealedIndexOptions,
    stale?: { readonly bytes: Uint8Array; readonly count: number | undefined },
  ): Promise<SealedIndex | undefined> {
    const now = options.now ?? Date.now;
    const laidOut = options.laidOut ?? (() => true);
    const header = upgradedHeader(earlier.header);
    const stated = (await files.read(HEADER)) ?? new Uint8Array();
    const resumed = same(stated, header);
    if (!resumed && !same(stated, earlier.header))
      throw new Refusal(
        "the pod's header changed since it was opened; open it again",
      );
    let count = stale?.count;
    if (resumed && count === undefined)
      throw changed("its sealed index is missing");
    const claim = async () =>
      seal(
        earlier.key,
        encoded(claimText(earlier.version, now(), count)),
        boundTo("pod", earlier.version, UPGRADE_CLAIM),
      );
    const won =
      stale === undefined
        ? await created(files, UPGRADE_CLAIM, await claim())
        : await replaced(files, UPGRADE_CLAIM, await claim(), stale.bytes);
    if (!won) return undefined;
    let renewed: Promise<unknown> = Promise.resolve();
    const renewing = setInterval(() => {
      renewed = renewed
        .then(async () => files.write(UPGRADE_CLAIM, await claim()))
        .catch(() => undefined);
    }, options.renewEvery ?? 5000);
    (renewing as { unref?: () => void }).unref?.();
    const renewalsStopped = async () => {
      clearInterval(renewing);
      await renewed;
    };
    const indexed = async () =>
      countersIn(await files.list(SEALED_INDEX)).length > 0;
    const openedEarlier = async (path: string) => {
      const bytes = await files.read(path);
      return bytes === undefined
        ? undefined
        : opened(earlier.key, bytes, boundTo("pod", earlier.version, path));
    };
    let headerWritten = resumed;
    const written: string[] = [];
    try {
      const listing = await files.list("");
      if (countersIn(listing).length > 0) return undefined;
      const paths = listing.filter(isEarlierFile);
      const carried: string[] = [];
      let gone = false;
      for (let at = 0; at < paths.length; at += UPGRADE_BATCH) {
        const looked = await Promise.all(
          paths.slice(at, at + UPGRADE_BATCH).map(async (path) => {
            const bytes = await files.read(path);
            const opens =
              bytes === undefined
                ? undefined
                : (await opened(
                    earlier.key,
                    bytes,
                    boundTo("pod", earlier.version, path),
                  )) !== undefined;
            return [path, opens] as const;
          }),
        );
        for (const [path, opens] of looked)
          if (opens === undefined) gone = true;
          else if (opens) carried.push(path);
          else if (laidOut(path)) {
            if (await indexed()) return undefined;
            throw changed(`${path} does not open under its key`);
          }
      }
      if (gone && (await indexed())) return undefined;
      if (resumed && carried.length < (count ?? 0)) {
        if (await indexed()) return undefined;
        throw changed("its sealed index is missing");
      }
      if (!resumed) {
        count = carried.length;
        await files.write(UPGRADE_CLAIM, await claim());
        await files.write(HEADER, header);
        headerWritten = true;
      }
      const key: PodKey = { ...earlier, version: "1.3", header };
      const index = new SealedIndex(
        files,
        key,
        0,
        new Map(),
        undefined,
        listing,
      );
      const entries = new Map<string, Named>();
      for (let at = 0; at < carried.length; at += UPGRADE_BATCH) {
        const read = await Promise.all(
          carried
            .slice(at, at + UPGRADE_BATCH)
            .map(async (path) => [path, await openedEarlier(path)] as const),
        );
        const lost = read.find(([, plain]) => plain === undefined);
        if (lost !== undefined) {
          if (await indexed()) return undefined;
          throw changed(`${lost[0]} is missing`);
        }
        const sealed = await index.#sealed(
          read.flatMap(([path, plain]) =>
            plain === undefined ? [] : [[path, plain] as const],
          ),
        );
        await writeAll(
          files,
          sealed.map(([, name, bytes]) => [name, bytes] as const),
        );
        for (const [path, name, bytes] of sealed) {
          entries.set(path, { name, tag: tagOf(bytes) });
          written.push(name);
        }
      }
      const committed = await index.#committed(1, entries);
      if (committed === "taken")
        await files.remove?.(written).catch(() => undefined);
      written.length = 0;
      if (committed !== "written") return undefined;
      await renewalsStopped();
      await Promise.resolve(files.remove?.(carried))
        .then(() => files.remove?.([UPGRADE_CLAIM]))
        .catch(() => undefined);
      return index;
    } catch (error) {
      await files.remove?.(written).catch(() => undefined);
      if (!headerWritten)
        await files.remove?.([UPGRADE_CLAIM]).catch(() => undefined);
      throw error;
    } finally {
      await renewalsStopped();
    }
  }

  /** Each file sealed under the 1.3 key and named by its keyed name: path, keyed name, sealed bytes. */
  async #sealed(
    files: readonly (readonly [string, Uint8Array])[],
  ): Promise<(readonly [string, string, Uint8Array])[]> {
    return Promise.all(
      files.map(async ([path, bytes]) => {
        const sealed = await seal(
          this.#key.key,
          bytes,
          boundTo("pod", "1.3", path),
        );
        return [
          path,
          await keyedName(this.#key.names, path, tagOf(sealed)),
          sealed,
        ] as const;
      }),
    );
  }

  /**
   * Writes the index with these entries under the counter, only where no index of that counter is: `taken` when one is,
   * another opening's; `unsure` when by the time it is written a later index is there, which another opening may have
   * written from it or from the one this took the place of. Held as the pod's index only when `written`.
   */
  async #committed(
    counter: number,
    entries: Map<string, Named>,
  ): Promise<"written" | "taken" | "unsure"> {
    const bytes = await seal(
      this.#key.key,
      indexBytes(counter, entries),
      INDEX_BOUND,
    );
    if (!(await created(this.#files, indexAt(counter), bytes))) return "taken";
    if (countersIn(await this.#files.list(SEALED_INDEX))[0] !== counter)
      return "unsure";
    this.#stored = bytes;
    this.#counter = counter;
    this.#entries = entries;
    this.#sorted = undefined;
    return "written";
  }

  /** Each file of the listing under `sealed/` that the index does not name, the index's own aside. */
  #unnamed(listing: readonly string[]): string[] {
    const named = new Set([...this.#entries.values()].map(({ name }) => name));
    return listing.filter(
      (path) =>
        under(SEALED, path) && !under(SEALED_INDEX, path) && !named.has(path),
    );
  }

  /**
   * Why a named file did not read: the header or the stored index changed since the pod was opened, which another
   * opening's write explains, or else the pod was changed outside the runtime.
   */
  async #notRead(what: string): Promise<never> {
    const header = await this.#files.read(HEADER);
    if (header === undefined || !same(header, this.#key.header))
      throw new Refusal(
        "the pod's header changed since it was opened; open it again",
      );
    await this.#storedUnchanged();
    throw changed(what);
  }

  /**
   * The counters of the stored indexes, once the latest is the one held; refused when it is not, a later one being
   * another opening's write and any other a change from outside.
   */
  async #storedUnchanged(): Promise<number[]> {
    const counters = countersIn(await this.#files.list(SEALED_INDEX));
    const [latest] = counters;
    if (latest !== undefined && latest > this.#counter)
      throw new Refusal(AGAIN);
    if (latest === undefined) throw changed("its sealed index is missing");
    if (latest < this.#counter)
      throw changed(
        "its sealed index is older than the one it was opened with",
      );
    const stored = await this.#files.read(indexAt(latest));
    if (stored === undefined) return this.#storedUnchanged();
    if (sameBytes(stored, this.#stored)) return counters;
    const plain = await opened(this.#key.key, stored, INDEX_BOUND);
    const read = plain === undefined ? undefined : indexOf(plain);
    throw changed(
      read === undefined
        ? "its sealed index does not open under its key"
        : read.counter < this.#counter
          ? "its sealed index is older than the one it was opened with"
          : "its sealed index is not the copy the pod last wrote",
    );
  }

  /** The file's plaintext, when the index names it and it is the copy the index names; else undefined, or refused. */
  async read(path: string): Promise<Uint8Array | undefined> {
    const named = this.#entries.get(path);
    if (named === undefined) return undefined;
    const bytes = await this.#files.read(named.name);
    if (bytes === undefined) return this.#notRead(`${path} is missing`);
    if (bytes.length < NONCE + TAG || !same(tagOf(bytes), named.tag))
      return this.#notRead(`${path} is not the copy the pod last wrote`);
    const plain = await opened(
      this.#key.key,
      bytes,
      boundTo("pod", "1.3", path),
    );
    return plain ?? this.#notRead(`${path} does not open under its key`);
  }

  /**
   * Seals and writes the files, the plaintext ones as they are, then the index naming them, one write of it for all;
   * then removes the earlier indexes, the earlier copy of each file written again, and, at an opening's first write,
   * every file under `sealed/` the index does not name. Refuses, writing no index, when the header or the stored index
   * changed since the pod was opened, or another opening wrote an index of the same counter first.
   */
  write(files: readonly (readonly [string, Uint8Array])[]): Promise<void> {
    const writing = this.#writing.then(() => this.#write(files));
    this.#writing = writing.catch(() => undefined);
    return writing;
  }

  async #write(
    files: readonly (readonly [string, Uint8Array])[],
  ): Promise<void> {
    if (files.length === 0) return;
    const header = await this.#files.read(HEADER);
    if (header === undefined || !same(header, this.#key.header))
      throw new Refusal(
        "the pod's header changed since it was opened; open it again",
      );
    const plain = files.filter(([path]) => PLAINTEXT.has(path));
    const sealed = await this.#sealed(
      files.filter(([path]) => !PLAINTEXT.has(path)),
    );
    const counters = await this.#storedUnchanged();
    const before = this.#swept ? [] : await this.#files.list(SEALED);
    await writeAll(this.#files, [
      ...sealed.map(([, name, bytes]) => [name, bytes] as const),
      ...plain,
    ]);
    const entries = new Map(this.#entries);
    const replacedNames: string[] = [];
    for (const [path, name, bytes] of sealed) {
      const was = entries.get(path);
      if (was !== undefined && was.name !== name) replacedNames.push(was.name);
      entries.set(path, { name, tag: tagOf(bytes) });
    }
    const committed = await this.#committed(this.#counter + 1, entries);
    if (committed !== "written") {
      if (committed === "taken")
        await this.#files
          .remove?.(sealed.map(([, name]) => name))
          .catch(() => undefined);
      throw new Refusal(AGAIN);
    }
    for (const [path] of plain) this.#plaintext.add(path);
    this.#sorted = undefined;
    this.#swept = true;
    await this.#files
      .remove?.([
        ...counters.filter((counter) => counter < this.#counter).map(indexAt),
        ...replacedNames,
        ...this.#unnamed(before),
      ])
      .catch(() => undefined);
  }

  /** Each path the index names under the folder, and each plaintext file there is, sorted; nothing is read. */
  async list(folder: string): Promise<string[]> {
    this.#sorted ??= [...this.#entries.keys(), ...this.#plaintext].sort();
    return this.#sorted.filter((path) => under(folder, path));
  }
}

const UPGRADE_BATCH = 64;

/** A claim's text: the upgrade, when it was claimed, and, once its files are looked at, how many it carries over. */
const claimText = (
  from: HeaderVersion,
  at: number,
  count: number | undefined,
): string =>
  `# cascade-runtime upgrades this pod from ${from} to 1.3; claimed ${at}${count === undefined ? "" : `; ${count} files`}\n`;

/** The upgrade a claim's bytes state, from the version they are sealed as: when it was claimed, from which version, and how many files it carries over. */
async function claimOf(
  key: PodKey,
  bytes: Uint8Array,
): Promise<
  | {
      readonly from: HeaderVersion;
      readonly at: number;
      readonly count: number | undefined;
    }
  | undefined
> {
  for (const from of ["1.2", "1.1"] as const) {
    const plain = await opened(
      key.key,
      bytes,
      boundTo("pod", from, UPGRADE_CLAIM),
    );
    if (plain === undefined) continue;
    const stated =
      /^# cascade-runtime upgrades this pod from (1\.[0-2]) to 1\.3; claimed (\d+)(?:; (\d+) files)?\n$/.exec(
        new TextDecoder().decode(plain),
      );
    if (stated === null) return undefined;
    const version = stated[1] as HeaderVersion;
    if ((version === "1.2") !== (from === "1.2")) return undefined;
    return {
      from: version,
      at: Number(stated[2]),
      count: stated[3] === undefined ? undefined : Number(stated[3]),
    };
  }
  return undefined;
}

export interface EncryptedFilesOptions {
  /** The largest file sealed, in bytes; 256 MiB unless given. */
  readonly maxBytes?: number;
  /** A pod's files, or its answer cache's, which has no plaintext files and no header. */
  readonly kind?: "pod" | "answers";
  /** A 1.3 pod's sealed index (`SealedIndex.open`), which a 1.3 pod's files are read, written and listed through. */
  readonly index?: SealedIndex;
}

/**
 * The files beneath, each sealed on write and opened on read under the pod's key, but a pod's plaintext ones; a pod's
 * header is never listed. A pod's file that does not open is refused, naming its path, and never read as plaintext; an
 * answer cache's reads as absent. A 1.3 pod's files are its index's: stored under keyed names, read only as the copy
 * the index names, listed from it, written with one write of it for each `writeAll`.
 */
export class EncryptedFiles implements Files {
  readonly #files: Files;
  readonly #key: PodKey;
  readonly #maxBytes: number;
  readonly #kind: "pod" | "answers";
  readonly #index: SealedIndex | undefined;

  constructor(files: Files, key: PodKey, options: EncryptedFilesOptions = {}) {
    this.#files = files;
    this.#maxBytes = options.maxBytes ?? SEAL_MAX_BYTES;
    this.#kind = options.kind ?? "pod";
    this.#index = this.#kind === "pod" ? options.index : undefined;
    this.#key = this.#index?.key ?? key;
    if (
      this.#kind === "pod" &&
      this.#key.version === "1.3" &&
      this.#index === undefined
    )
      throw new Error(
        "a 1.3 pod's files are read through its sealed index: open it with SealedIndex.open",
      );
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
    if (this.#index !== undefined && !this.#plain(path))
      return this.#index.read(path);
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
      const lower = path.toLowerCase();
      if (this.#kind === "pod" && lower === HEADER.toLowerCase())
        throw new Refusal(
          `${HEADER} is written only when the pod's encryption is made`,
        );
      if (
        this.#kind === "pod" &&
        (lower === UPGRADE_CLAIM || under(SEALED, lower))
      )
        throw new Refusal(
          `${path} is where a pod's own sealed files and claims are stored: no file of the pod is written there`,
        );
      if (!this.#plain(path) && bytes.length > this.#maxBytes)
        throw new Refusal(
          `${path} is too large to seal as one file: ${bytes.length} bytes, over ${this.#maxBytes}`,
        );
      given.push([path, bytes]);
    }
    if (this.#index !== undefined) return this.#index.write(given);
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
    if (this.#index !== undefined)
      return this.#index.list(relative(this, folder));
    const paths = await this.#files.list(folder);
    return this.#kind === "pod"
      ? paths.filter((path) => path !== HEADER)
      : paths;
  }
}
