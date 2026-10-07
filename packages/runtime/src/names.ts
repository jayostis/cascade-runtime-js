import { canonize } from "rdf-canonize";
import type { Triple } from "./rdf.js";

const NI = "ni:///sha-256;";
const UUID = "urn:uuid:";
const RECORD_NAMESPACE = "90c60849-c5ef-4ca6-bfb8-8662bd07d2b5";

export const THIS_VERSION = "urn:cascade:this-version";
export const THIS_REVISION = "urn:cascade:this-revision";
export const THIS_ENTRY = "urn:cascade:this-entry";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      bytes as Uint8Array<ArrayBuffer>,
    ),
  );
}

/** A document's name from its bytes (runtime/rules.md, N5). */
export async function documentName(bytes: Uint8Array): Promise<string> {
  return NI + base64url(await sha256(bytes));
}

/** A record's name from its inputs, by the Bridge's record rule (runtime/rules.md, N2). */
export async function recordName(inputs: readonly string[]): Promise<string> {
  const digest = await sha256(
    new TextEncoder().encode([RECORD_NAMESPACE, ...inputs].join("|")),
  );
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const text = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${UUID}${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

/** A set's fingerprint, as cascade-bridge-spec's engine/sparql.md writes it: no order or repeat of the strings enters it. */
export async function fingerprint(strings: Iterable<string>): Promise<string> {
  let sum = 0n;
  for (const text of new Set(strings)) {
    const digest = await sha256(new TextEncoder().encode(text));
    const hex = [...digest.slice(0, 6)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    sum += BigInt(`0x${hex}`);
  }
  return sum.toString();
}

/** What a C-CDA record's name is computed from: a handle's class, identifier and key, as far as it gives them. */
export interface CcdaInputs {
  readonly class: string;
  /** `root:extension`, or the root alone; empty or absent where the record has no usable identifier. */
  readonly identifier?: string;
  /** The key's `field=value` strings, given where the name takes the key's fingerprint. */
  readonly key?: readonly string[];
}

/** A C-CDA record's name, by cascade-bridge-spec's rows for one. */
export async function ccdaRecordName(inputs: CcdaInputs): Promise<string> {
  const { identifier, key } = inputs;
  return recordName([
    inputs.class,
    ...(identifier === undefined && key === undefined
      ? []
      : [identifier ?? ""]),
    ...(key === undefined ? [] : [await fingerprint(key)]),
  ]);
}

/** The triples' canonical N-Quads by RDFC-1.0: two sets of triples have the same exactly when they are one graph. */
export function canonical(triples: Iterable<Triple>): Promise<string> {
  const quads = [...triples].map(([subject, predicate, object]) => ({
    subject,
    predicate,
    object,
    graph: { termType: "DefaultGraph", value: "" },
  }));
  return canonize(quads, { algorithm: "RDFC-1.0" });
}

/**
 * A version's name from its triples about `urn:cascade:this-version`, or a revision's from its triples about
 * `urn:cascade:this-revision` (runtime/rules.md, N3 and N4).
 */
export async function contentName(triples: Iterable<Triple>): Promise<string> {
  const content = [...triples];
  if (content.some((triple) => triple.some((t) => t.termType === "BlankNode")))
    throw new Error("content to be named holds a blank node");
  return documentName(new TextEncoder().encode(await canonical(content)));
}

const DATE_TIME =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/;

/**
 * An `xsd:dateTime`'s lexical form moved to UTC, written `YYYY-MM-DDThh:mm:ssZ` with any fraction of a second kept
 * less its trailing zeros (runtime/rules.md, N2).
 */
export function inUtc(dateTime: string): string {
  const parts = DATE_TIME.exec(dateTime);
  if (parts === null) throw new Error(`${dateTime} is not an xsd:dateTime`);
  const zone = parts[8];
  if (zone === undefined) throw new Error(`${dateTime} has no time zone`);
  const fraction = (parts[7] ?? "").replace(/0+$/, "");
  const [year, month, day, hour, minute, second] = parts
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  const endOfDay = hour === 24 && minute === 0 && second === 0;
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(endOfDay ? 0 : hour, minute, second);
  if (
    (endOfDay && fraction !== "") ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== (endOfDay ? 0 : hour) ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    throw new Error(`${dateTime} is not an xsd:dateTime`);
  }
  const offset =
    zone === "Z"
      ? 0
      : (zone.startsWith("-") ? -1 : 1) *
        (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const moment = new Date(
    local.getTime() + (endOfDay ? 86_400_000 : 0) - offset * 60_000,
  );
  const utcYear = moment.getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999)
    throw new Error(
      `${dateTime} falls outside the years a name can be given in`,
    );
  return `${moment.toISOString().slice(0, 19)}${fraction === "" ? "" : `.${fraction}`}Z`;
}

/** Whether the first `xsd:dateTime` is an instant before the second. */
export function earlierInUtc(first: string, second: string): boolean {
  const [[firstWhole, firstFraction], [secondWhole, secondFraction]] = [
    first,
    second,
  ].map((dateTime) => {
    const [whole = "", fraction = ""] = inUtc(dateTime).slice(0, -1).split(".");
    return [whole, fraction];
  }) as [[string, string], [string, string]];
  if (firstWhole !== secondWhole) return firstWhole < secondWhole;
  const width = Math.max(firstFraction.length, secondFraction.length);
  return firstFraction.padEnd(width, "0") < secondFraction.padEnd(width, "0");
}

/** The name a file holding the named thing takes, before its folder and suffix (runtime/rules.md, N9). */
export function fileStem(name: string): string {
  if (name.startsWith(UUID)) return name.slice(UUID.length);
  if (name.startsWith(NI)) {
    const encoded = name.slice(NI.length).replace(/-/g, "+").replace(/_/g, "/");
    return [...atob(encoded)]
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }
  throw new Error(`${name} names no file`);
}
