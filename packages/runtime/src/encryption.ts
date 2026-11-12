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
/** Where a 1.3 pod keeps its sealed index. */
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

/** How an upgrade to 1.3 waits on, and takes over, another opening's claim. */
export interface UpgradeTiming {
  /** How long a claim holds once it was last renewed, in milliseconds; 30 seconds unless given. */
  readonly claimHolds?: number;
  /** How often a claim is renewed while its upgrade runs, and looked at by an opening waiting on it; 5 seconds and 100 milliseconds unless given. */
  readonly renewEvery?: number;
  readonly lookEvery?: number;
  /** The time now, in milliseconds. */
  readonly now?: () => number;
  /**
   * `files.list("")`, begun before the key was derived so the two overlap; a file the index names that it lacks is
   * looked for in a listing taken again before the pod is refused.
   */
  readonly listing?: Promise<readonly string[]>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The files a pod holds as an earlier version stores them: by their own paths, but its header, its plaintext ones, a claim and a 1.3 pod's sealed folder. */
const isEarlierFile = (path: string) =>
  !PLAINTEXT.has(path) && path !== UPGRADE_CLAIM && !under(SEALED, path);

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
   * `changed outside the runtime`, for an index that does not open, a file it names that is missing, a pod with files
   * and no index, or an earlier header beside an index. Waits while another opening upgrades the pod.
   */
  static async open(
    files: Files,
    key: PodKey,
    timing: UpgradeTiming = {},
  ): Promise<SealedIndex> {
    const now = timing.now ?? Date.now;
    const holds = timing.claimHolds ?? 30_000;
    const lookEvery = timing.lookEvery ?? 100;
    const upgraded = upgradedHeader(key.header);
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
      const [stored, claim] = await Promise.all([
        files.read(SEALED_INDEX),
        files.read(UPGRADE_CLAIM),
      ]);
      if (stored !== undefined) {
        if (current.version !== "1.3")
          throw changed(
            `its header says version ${current.version} beside a 1.3 sealed index`,
          );
        const index = await SealedIndex.#opened(
          files,
          current,
          stored,
          (await timing.listing?.catch(() => undefined)) ??
            (await files.list("")),
        );
        if (claim !== undefined) await index.#sweep(await files.list(""));
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
        await files.remove?.([UPGRADE_CLAIM]);
        const taken = await SealedIndex.#upgrade(
          files,
          { ...current, version: claimed.from },
          timing,
        );
        if (taken !== undefined) return taken;
        continue;
      }
      if (current.version === "1.3") {
        const listing = await files.list("");
        if (listing.some((path) => !PLAINTEXT.has(path)))
          throw changed("its sealed index is missing");
        const empty = await seal(
          current.key,
          indexBytes(0, new Map()),
          INDEX_BOUND,
        );
        if (await replaced(files, SEALED_INDEX, empty, undefined))
          return new SealedIndex(files, current, 0, new Map(), empty, listing);
        continue;
      }
      const upgrading = await SealedIndex.#upgrade(files, current, timing);
      if (upgrading !== undefined) return upgrading;
    }
  }

  /** The index in the stored bytes, each file it names there. */
  static async #opened(
    files: Files,
    key: PodKey,
    stored: Uint8Array,
    listing: readonly string[],
  ): Promise<SealedIndex> {
    const plain = await opened(key.key, stored, INDEX_BOUND);
    const read = plain === undefined ? undefined : indexOf(plain);
    if (read === undefined)
      throw changed("its sealed index does not open under its key");
    let held = new Set(listing);
    for (const [path, { name }] of read.entries)
      if (!held.has(name)) {
        held = new Set((listing = await files.list("")));
        if (!held.has(name)) throw changed(`${path} is missing`);
      }
    return new SealedIndex(
      files,
      key,
      read.counter,
      read.entries,
      stored,
      listing,
    );
  }

  /**
   * The pod, held as an earlier version, upgraded in place to 1.3: claimed, its 1.3 header written, every file sealed
   * again under its keyed name, the index written, then the earlier files and the claim removed. None when another
   * opening claimed or finished it first. A crash before the index is written leaves the claim and the earlier files,
   * from which the next opening upgrades again; after it, the earlier files, which the next opening removes.
   */
  static async #upgrade(
    files: Files,
    earlier: PodKey,
    timing: UpgradeTiming,
  ): Promise<SealedIndex | undefined> {
    const now = timing.now ?? Date.now;
    const claim = async () =>
      seal(
        earlier.key,
        encoded(
          `# cascade-runtime upgrades this pod from ${earlier.version} to 1.3; claimed ${now()}\n`,
        ),
        boundTo("pod", earlier.version, UPGRADE_CLAIM),
      );
    const won = files.writeNew
      ? await files.writeNew(UPGRADE_CLAIM, await claim())
      : await replaced(files, UPGRADE_CLAIM, await claim(), undefined);
    if (!won) return undefined;
    let renewed: Promise<unknown> = Promise.resolve();
    const renewing = setInterval(() => {
      renewed = renewed
        .then(async () => files.write(UPGRADE_CLAIM, await claim()))
        .catch(() => undefined);
    }, timing.renewEvery ?? 5000);
    (renewing as { unref?: () => void }).unref?.();
    const renewalsStopped = async () => {
      clearInterval(renewing);
      await renewed;
    };
    try {
      const header = upgradedHeader(earlier.header);
      const key: PodKey = { ...earlier, version: "1.3", header };
      if (!same((await files.read(HEADER)) ?? new Uint8Array(), header))
        await files.write(HEADER, header);
      const reading = new EncryptedFiles(files, { ...earlier, header });
      const listing = await files.list("");
      const index = new SealedIndex(
        files,
        key,
        0,
        new Map(),
        undefined,
        listing,
      );
      const paths = listing.filter(isEarlierFile);
      const entries = new Map<string, Named>();
      const written: string[] = [];
      try {
        for (let at = 0; at < paths.length; at += UPGRADE_BATCH) {
          const read = await Promise.all(
            paths.slice(at, at + UPGRADE_BATCH).map(async (path) => {
              try {
                return [path, await reading.read(path)] as const;
              } catch (error) {
                if (error instanceof Refusal)
                  throw changed(`${path} does not open under its key`);
                throw error;
              }
            }),
          );
          const sealed = await index.#sealed(
            read.flatMap(([path, bytes]) =>
              bytes === undefined ? [] : [[path, bytes] as const],
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
        if (!committed) {
          await files.remove?.(written).catch(() => undefined);
          return undefined;
        }
      } catch (error) {
        await files.remove?.(written).catch(() => undefined);
        throw error;
      }
      await renewalsStopped();
      await index.#sweep(await files.list(""));
      return index;
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

  /** Writes the index with these entries and counter, unless the stored index is no longer the one held; false then. */
  async #committed(
    counter: number,
    entries: Map<string, Named>,
  ): Promise<boolean> {
    const bytes = await seal(
      this.#key.key,
      indexBytes(counter, entries),
      INDEX_BOUND,
    );
    if (!(await replaced(this.#files, SEALED_INDEX, bytes, this.#stored)))
      return false;
    this.#stored = bytes;
    this.#counter = counter;
    this.#entries = entries;
    this.#sorted = undefined;
    return true;
  }

  /** Removes each file of the listing the index does not name, but the header, the plaintext files and the index. */
  async #sweep(listing: readonly string[]): Promise<void> {
    const named = new Set([...this.#entries.values()].map(({ name }) => name));
    const unnamed = listing.filter(
      (path) =>
        !PLAINTEXT.has(path) && path !== SEALED_INDEX && !named.has(path),
    );
    await this.#files.remove?.(unnamed).catch(() => undefined);
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

  /** Refuses when the stored index is not the one held: a later one is another opening's write, any other a change from outside. */
  async #storedUnchanged(): Promise<void> {
    const stored = await this.#files.read(SEALED_INDEX);
    if (sameBytes(stored, this.#stored)) return;
    const plain =
      stored === undefined
        ? undefined
        : await opened(this.#key.key, stored, INDEX_BOUND);
    const read = plain === undefined ? undefined : indexOf(plain);
    if (read !== undefined && read.counter > this.#counter)
      throw new Refusal(
        "the pod was written by another opening since this one opened it; open it again",
      );
    throw changed(
      read === undefined
        ? "its sealed index does not open under its key"
        : "its sealed index is older than the one it was opened with",
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
   * then removes the earlier copy of each file written again, and, at an opening's first write, every stored file the
   * index does not name. Refuses, writing no index, when the header or the stored index changed since the pod was opened.
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
    const before = this.#swept ? [] : await this.#files.list("");
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
    if (!(await this.#committed(this.#counter + 1, entries))) {
      await this.#files
        .remove?.(sealed.map(([, name]) => name))
        .catch(() => undefined);
      await this.#storedUnchanged();
      throw changed("its sealed index changed while it was written");
    }
    for (const [path] of plain) this.#plaintext.add(path);
    this.#sorted = undefined;
    this.#swept = true;
    await this.#sweep([...before, ...replacedNames]);
  }

  /** Each path the index names under the folder, and each plaintext file there is, sorted; nothing is read. */
  async list(folder: string): Promise<string[]> {
    this.#sorted ??= [...this.#entries.keys(), ...this.#plaintext].sort();
    return this.#sorted.filter((path) => under(folder, path));
  }
}

const UPGRADE_BATCH = 64;

/** The upgrade a claim's bytes state, from the version they are sealed as: when it was claimed, and from which version. */
async function claimOf(
  key: PodKey,
  bytes: Uint8Array,
): Promise<{ readonly from: HeaderVersion; readonly at: number } | undefined> {
  for (const from of ["1.2", "1.1"] as const) {
    const plain = await opened(
      key.key,
      bytes,
      boundTo("pod", from, UPGRADE_CLAIM),
    );
    if (plain === undefined) continue;
    const stated =
      /^# cascade-runtime upgrades this pod from (1\.[0-2]) to 1\.3; claimed (\d+)\n$/.exec(
        new TextDecoder().decode(plain),
      );
    if (stated === null) return undefined;
    const version = stated[1] as HeaderVersion;
    if ((version === "1.2") !== (from === "1.2")) return undefined;
    return { from: version, at: Number(stated[2]) };
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
