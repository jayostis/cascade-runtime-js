import { canonize } from "rdf-canonize";
import type { Triple } from "./rdf.js";
import { Refusal } from "./refusal.js";

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
  /** The member strings, given for a record with no identifier and no key, whose name takes their fingerprint. */
  readonly members?: readonly string[];
}

/** A C-CDA record's name, by cascade-bridge-spec's rows for one. */
export async function ccdaRecordName(inputs: CcdaInputs): Promise<string> {
  const { identifier = "", key, members } = inputs;
  const named =
    key !== undefined
      ? [identifier, await fingerprint(key)]
      : identifier !== ""
        ? [identifier]
        : members !== undefined
          ? ["", "", await fingerprint(members)]
          : [];
  return recordName([inputs.class, ...named]);
}

/** The triples' canonical N-Quads by RDFC-1.0: two sets of triples have the same exactly when they are one graph. */
export async function canonical(triples: Iterable<Triple>): Promise<string> {
  const quads = [...triples].map(([subject, predicate, object]) => ({
    subject,
    predicate,
    object:
      object.termType === "Literal" && object.language !== ""
        ? { ...object, language: object.language.toLowerCase() }
        : object,
    graph: { termType: "DefaultGraph", value: "" },
  }));
  const lines = new Set(
    (await canonize(quads, { algorithm: "RDFC-1.0" }))
      .split("\n")
      .filter((line) => line !== ""),
  );
  return lines.size === 0 ? "" : `${[...lines].sort(byCodePoint).join("\n")}\n`;
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

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

/** The IRI of each naming rule, by the rule term's local name less `NamingRule`. */
export const NAMING_RULES = Object.freeze({
  RecordFromServer: `${CASCADE}RecordFromServerNamingRule`,
  RecordFromDocument: `${CASCADE}RecordFromDocumentNamingRule`,
  RecordFromCcda: `${CASCADE}RecordFromCcdaNamingRule`,
  RecordFromCcdaWithoutId: `${CASCADE}RecordFromCcdaWithoutIdNamingRule`,
  ContainedRecord: `${CASCADE}ContainedRecordNamingRule`,
  EnteredRecord: `${CASCADE}EnteredRecordNamingRule`,
  Version: `${CASCADE}VersionNamingRule`,
  Revision: `${CASCADE}RevisionNamingRule`,
  Document: `${CASCADE}DocumentNamingRule`,
  Finding: `${CASCADE}FindingNamingRule`,
  TableRow: `${CASCADE}TableRowNamingRule`,
  TableVersion: `${CASCADE}TableVersionNamingRule`,
  ViewEntry: `${CASCADE}ViewEntryNamingRule`,
  Snapshot: `${CASCADE}SnapshotNamingRule`,
  Server: `${CASCADE}ServerNamingRule`,
  Organization: `${CASCADE}OrganizationNamingRule`,
  Claim: `${CASCADE}ClaimNamingRule`,
  Assertion: `${CASCADE}AssertionNamingRule`,
  Retraction: `${CASCADE}RetractionNamingRule`,
});

/** Orders strings by their Unicode code points, where `<` orders UTF-16 code units. */
export function byCodePoint(first: string, second: string): number {
  const a = [...first];
  const b = [...second];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference =
      (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** A set of names as name inputs: its count, then its distinct items in code point order. */
function counted(names: Iterable<string>): string[] {
  const distinct = [...new Set(names)].sort(byCodePoint);
  return [String(distinct.length), ...distinct];
}

function escaped(input: string): string {
  return input.replace(/%/g, "%25").replace(/\|/g, "%7C");
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A UUIDv8 name (RFC 9562 §5.8): the first 128 bits of the SHA-256 of the namespace, the rule's IRI and the inputs,
 * each escaped and joined by `|`, with the version and variant bits set.
 */
async function derivedName(
  rule: string,
  inputs: readonly string[],
): Promise<string> {
  const digest = await sha256(
    new TextEncoder().encode(
      [RECORD_NAMESPACE, rule, ...inputs].map(escaped).join("|"),
    ),
  );
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const text = hex(digest.slice(0, 16));
  return `${UUID}${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/** RFC 3986 §6.2.2.1 and §6.2.2.2: an unreserved character's triplet decoded, every other's hex in upper case. */
function percentNormalised(text: string): string {
  return text.replace(/%([0-9A-Fa-f]{2})/g, (_, digits: string) => {
    const character = String.fromCharCode(parseInt(digits, 16));
    return UNRESERVED.test(character) ? character : `%${digits.toUpperCase()}`;
  });
}

/** RFC 3986 §5.2.4. */
function withoutDotSegments(path: string): string {
  let input = path;
  let output = "";
  while (input !== "") {
    if (input.startsWith("../")) input = input.slice(3);
    else if (input.startsWith("./") || input.startsWith("/./"))
      input = input.slice(2);
    else if (input === "/.") input = "/";
    else if (input.startsWith("/../") || input === "/..") {
      input = `/${input.slice(input === "/.." ? 3 : 4)}`;
      output = output.slice(0, Math.max(output.lastIndexOf("/"), 0));
    } else if (input === "." || input === "..") input = "";
    else {
      const end = input.indexOf("/", 1);
      const segment = end === -1 ? input : input.slice(0, end);
      output += segment;
      input = input.slice(segment.length);
    }
  }
  return output;
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  http: "80",
  https: "443",
};

const URL_PARTS =
  /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;

const REG_NAME = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=]|%[0-9A-Fa-f]{2})+$/;
const H16 = /^[0-9A-Fa-f]{1,4}$/;
const DEC_OCTET = /^(?:0|[1-9][0-9]{0,2})$/;
const IPV_FUTURE = /^v[0-9a-f]+\.[A-Za-z0-9\-._~!$&'()*+,;=:]+$/i;

function ipv4(text: string): boolean {
  const octets = text.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => DEC_OCTET.test(octet) && Number(octet) <= 255)
  );
}

/** RFC 3986 §3.2.2's IPv6address. */
function ipv6(text: string): boolean {
  const halves = text.split("::");
  if (halves.length > 2) return false;
  let groups = 0;
  for (const [index, half] of halves.entries()) {
    if (half === "") continue;
    const pieces = half.split(":");
    for (const [at, piece] of pieces.entries()) {
      if (H16.test(piece)) groups += 1;
      else if (
        index === halves.length - 1 &&
        at === pieces.length - 1 &&
        ipv4(piece)
      )
        groups += 2;
      else return false;
    }
  }
  return halves.length === 2 ? groups <= 7 : groups === 8;
}

/** A bracketed host: an IPv6 address or an IPvFuture, lower-cased and otherwise as written. */
function ipLiteral(bracketed: string): string {
  const inner = bracketed.slice(1, -1);
  if (!ipv6(inner) && !IPV_FUTURE.test(inner))
    throw new Refusal(
      "a base URL's bracketed host is an IPv6 address or an IPvFuture, with no zone id",
    );
  return bracketed.toLowerCase();
}

/** An ASCII reg-name, normalised as RFC 3986 §6.2.2.1 says: unreserved triplets decoded, hex digits in upper case. */
function regName(host: string): string {
  if (!REG_NAME.test(host))
    throw new Refusal(
      "a base URL's host is an ASCII reg-name of unreserved characters, sub-delims and percent-encodings",
    );
  return percentNormalised(host.toLowerCase())
    .toLowerCase()
    .replace(/%[0-9a-f]{2}/g, (triplet) => triplet.toUpperCase());
}

/**
 * The base URL a client used, as the server and record rules take it: RFC 3986 §6.2.2 and §6.2.3 (case,
 * percent-encoding, dot segments, a default or empty port, a port's leading zeros), then every trailing `/` of the
 * path removed. Refused, with a reason that never holds the URL: userinfo (a credential must never be a name input),
 * no scheme or host, a control character or a space, a query or fragment even if empty, a host that is not an ASCII
 * reg-name or a bracketed IPv6 address or IPvFuture, and a port that is not ASCII digits or exceeds 65535.
 */
export function normalisedBaseUrl(url: string): string {
  if ([...url].some((c) => (c.codePointAt(0) ?? 0) <= 0x20 || c === "\x7f"))
    throw new Refusal(
      "a base URL holding a control character or a space names nothing",
    );
  if (/[?#]/.test(url))
    throw new Refusal(
      "a base URL carrying a query or a fragment names nothing: a credential is never a name input",
    );
  const parts = URL_PARTS.exec(url);
  if (parts === null)
    throw new Refusal("a base URL is an absolute URL with an authority");
  const [, scheme = "", authority = "", path = ""] = parts;
  if (authority === "" || authority.startsWith(":"))
    throw new Refusal("a base URL has no host");
  if (authority.includes("@"))
    throw new Refusal(
      `a base URL carrying userinfo names nothing: a credential is never a name input`,
    );
  const lowerScheme = scheme.toLowerCase();
  const bracketed = authority.startsWith("[");
  const close = authority.indexOf("]");
  if (bracketed ? close === -1 : close !== -1)
    throw new Refusal("a base URL's host has unbalanced brackets");
  const colon = authority.indexOf(":", bracketed ? close : 0);
  const written = bracketed
    ? authority.slice(0, close + 1)
    : colon === -1
      ? authority
      : authority.slice(0, colon);
  const tail = authority.slice(written.length);
  if (tail !== "" && !tail.startsWith(":"))
    throw new Refusal("a base URL's bracketed host is followed by a port only");
  const port = tail.slice(1);
  if (!/^[0-9]*$/.test(port))
    throw new Refusal("a base URL's port is ASCII digits");
  const number = port === "" ? "" : port.replace(/^0+(?=.)/, "");
  if (number.length > 5 || Number(number) > 65535)
    throw new Refusal("a base URL's port is at most 65535");
  const host = bracketed ? ipLiteral(written) : regName(written);
  const keptPort =
    number === "" || number === DEFAULT_PORTS[lowerScheme] ? "" : `:${number}`;
  const kept = withoutDotSegments(percentNormalised(path)).replace(/\/+$/, "");
  return `${lowerScheme}://${host}${keptPort}${kept}`;
}

/** A record read from a server: the base URL the client used, normalised, then the resource's type and id. */
export function recordFromServerName(
  baseUrl: string,
  type: string,
  id: string,
): Promise<string> {
  return derivedName(NAMING_RULES.RecordFromServer, [
    normalisedBaseUrl(baseUrl),
    type,
    id,
  ]);
}

/** A record from a document: the document's name, then its selector's `rdf:value`. */
export function recordFromDocumentName(
  document: string,
  selector: string,
): Promise<string> {
  return derivedName(NAMING_RULES.RecordFromDocument, [document, selector]);
}

/** A CDA `id`: its root, and its extension where it has one. */
export interface CdaId {
  readonly root: string;
  readonly extension?: string;
}

/** A record from a C-CDA entry: the custodian's id, the patient's id, then the entry's id. */
export function recordFromCcdaName(ids: {
  readonly custodian: CdaId;
  readonly patient: CdaId;
  readonly entry: CdaId;
}): Promise<string> {
  return derivedName(
    NAMING_RULES.RecordFromCcda,
    [ids.custodian, ids.patient, ids.entry].flatMap(({ root, extension }) => [
      root,
      extension ?? "",
    ]),
  );
}

/**
 * A record from a C-CDA entry with no id: the custodian's id, the patient's id, the entry's class IRI, its key
 * fingerprint, then its members fingerprint where it has no key fingerprint; each absent one the empty string.
 */
export function recordFromCcdaWithoutIdName(entry: {
  readonly custodian: CdaId;
  readonly patient: CdaId;
  readonly entryClass: string;
  readonly keyFingerprint?: string;
  readonly membersFingerprint?: string;
}): Promise<string> {
  const keyFingerprint = entry.keyFingerprint ?? "";
  return derivedName(NAMING_RULES.RecordFromCcdaWithoutId, [
    ...[entry.custodian, entry.patient].flatMap(({ root, extension }) => [
      root,
      extension ?? "",
    ]),
    entry.entryClass,
    keyFingerprint,
    keyFingerprint === "" ? (entry.membersFingerprint ?? "") : "",
  ]);
}

/**
 * A contained resource: its container's record name, the version the source gives the container (its version id,
 * else its last-updated time, else the empty string), then its own id.
 */
export function containedRecordName(
  container: string,
  containerSource: {
    readonly versionId?: string;
    readonly lastUpdated?: string;
  },
  id: string,
): Promise<string> {
  return derivedName(NAMING_RULES.ContainedRecord, [
    container,
    (containerSource.versionId === ""
      ? undefined
      : containerSource.versionId) ??
      containerSource.lastUpdated ??
      "",
    id,
  ]);
}

/** A record an entry session wrote: the session's IRI, then the draft's position. */
export function enteredRecordName(
  session: string,
  position: number,
): Promise<string> {
  if (!Number.isSafeInteger(position) || position < 0)
    throw new Error(`${position} is no draft's position`);
  return derivedName(NAMING_RULES.EnteredRecord, [session, String(position)]);
}

/** A server: the base URL the client used, normalised. */
export function serverName(baseUrl: string): Promise<string> {
  return derivedName(NAMING_RULES.Server, [normalisedBaseUrl(baseUrl)]);
}

/**
 * An organization: from a server, by the server's base URL and its `Organization` resource's id; from a document, by
 * the identifier's system and value as the document writes them (a C-CDA custodian's id root and extension).
 */
export function organizationName(
  from:
    | { readonly server: string; readonly id: string }
    | { readonly system: string; readonly value: string },
): Promise<string> {
  return derivedName(
    NAMING_RULES.Organization,
    "server" in from
      ? [normalisedBaseUrl(from.server), "Organization", from.id]
      : [from.system, from.value],
  );
}

/** A machine judgment's claim: its maker, the matcher rule, the justification, its members, and the versions used. */
export function claimName(claim: {
  readonly maker: string;
  readonly rule: string;
  readonly justification: string;
  readonly members: Iterable<string>;
  readonly used: Iterable<string>;
}): Promise<string> {
  return derivedName(NAMING_RULES.Claim, [
    claim.maker,
    claim.rule,
    claim.justification,
    ...counted(claim.members),
    ...counted(claim.used),
  ]);
}

/** A claim's assertion under a rule list version. */
export function assertionName(
  ruleListVersion: string,
  claim: string,
): Promise<string> {
  return derivedName(NAMING_RULES.Assertion, [ruleListVersion, claim]);
}

/** A release's retraction of a claim, made by the matcher rule it declares wrong. */
export function retractionName(
  release: string,
  claim: string,
  rule: string,
): Promise<string> {
  return derivedName(NAMING_RULES.Retraction, [release, claim, rule]);
}

/**
 * A mapping row: its `owl:annotatedSource`, `owl:annotatedProperty` and `owl:annotatedTarget`, and for a panel
 * member its `panelSequence` in its canonical lexical form.
 */
export function tableRowName(
  row: {
    readonly source: string;
    readonly property: string;
    readonly target: string;
  },
  panelSequence?: string | number,
): Promise<string> {
  const inputs = [row.source, row.property, row.target];
  if (panelSequence !== undefined) {
    const digits = /^\+?([0-9]+)$/.exec(String(panelSequence))?.[1];
    if (digits === undefined)
      throw new Error(`${panelSequence} is no panel sequence`);
    inputs.push(digits.replace(/^0+(?=.)/, ""));
  }
  return derivedName(NAMING_RULES.TableRow, inputs);
}

/**
 * A view entry, relative to the pod: the view's path, `#`, then the lower-case hex SHA-256 of the IRI of its least
 * member in code point order.
 */
export async function viewEntryName(
  view: string,
  members: Iterable<string>,
): Promise<string> {
  const [least] = [...members].sort(byCodePoint);
  if (least === undefined) throw new Error("a view entry has a member");
  return `${view}#${hex(await sha256(new TextEncoder().encode(least)))}`;
}

/** An act's snapshot: the act, the writer's previous snapshot where it has one, the heads it merged, and its set hash. */
export function snapshotName(snapshot: {
  readonly act: string;
  readonly firstParent?: string;
  readonly mergedParents: Iterable<string>;
  readonly setHash: string;
}): Promise<string> {
  return derivedName(NAMING_RULES.Snapshot, [
    snapshot.act,
    ...counted(
      snapshot.firstParent === undefined ? [] : [snapshot.firstParent],
    ),
    ...counted(snapshot.mergedParents),
    snapshot.setHash,
  ]);
}

/** A version, from its triples about `urn:cascade:this-version`. */
export function versionName(triples: Iterable<Triple>): Promise<string> {
  return contentName(triples);
}

/** A revision, from its triples about `urn:cascade:this-revision`. */
export function revisionName(triples: Iterable<Triple>): Promise<string> {
  return contentName(triples);
}

/** A finding, from its triples about `urn:cascade:this-finding`. */
export function findingName(triples: Iterable<Triple>): Promise<string> {
  return contentName(triples);
}

/** A table version, from its triples about `urn:cascade:this-version`: its series, what it revises, and its rows. */
export function tableVersionName(triples: Iterable<Triple>): Promise<string> {
  return contentName(triples);
}
