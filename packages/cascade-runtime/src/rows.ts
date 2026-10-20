import { documentName, linesAbout, rowsByCode } from "@cascade-runtime/runtime";

export const PROV = "http://www.w3.org/ns/prov#";
export const SPECIALIZATION_OF = `${PROV}specializationOf`;
export const REVISION_OF = `${PROV}wasRevisionOf`;
export const OWL = "http://www.w3.org/2002/07/owl#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
const THIS_VERSION = "urn:cascade:this-version";

/** A version's rows as a feed published them, with what they must verify against. */
export interface RowsToVerify {
  /** Gzipped canonical N-Quads. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The SHA-256 the feed gives for them, in hex. */
  readonly checksum: string;
  readonly version: string;
  readonly series: string;
  /** The version it revises, if any. */
  readonly previous: string | undefined;
  /** The properties the version's kind is found by, for its index by code. */
  readonly foundBy: readonly string[];
  /** Each code system's URI space, for its listing. */
  readonly uriSpaces: readonly string[];
}

/** Verified rows: the version's N-Triples, its index by code and its listing; or why they do not verify. */
export type Verified =
  | {
      readonly text: Uint8Array<ArrayBuffer>;
      readonly codes?: Uint8Array<ArrayBuffer>;
      readonly listed: Uint8Array<ArrayBuffer>;
    }
  | { readonly refused: string };

/** The shape of a listing; a kept listing of another is listed again. */
export const LISTING_FORMAT = 2;

/** A product ingredients row's predicate that names a precise ingredient, not an ingredient. */
export const PRECISE_INGREDIENT =
  "https://ns.cascadeprotocol.org/records/v1-draft#hasPreciseIngredient";

/** A version's codes as a search lists them, and what it reads of them. */
export interface Listed {
  readonly format: typeof LISTING_FORMAT;
  /** The code systems' URI spaces it was listed by; a kept listing by others is listed again. */
  readonly uriSpaces: readonly string[];
  /** Its rows' subjects in a code system and the sources of its mappings, in the order of their notations. */
  readonly codes: readonly string[];
  /** In a mapping series, the codes each code maps to; a product ingredients row naming a precise ingredient is not one. */
  readonly mapsTo: Readonly<Record<string, readonly string[]>>;
  /** In a product ingredients series, the precise ingredients each code has (`rec:hasPreciseIngredient`). */
  readonly precise: Readonly<Record<string, readonly string[]>>;
  /** In a names series, each code it gives a preferred name, with its names, lowercased, each after a line break. */
  readonly names: Readonly<Record<string, string>>;
}

/**
 * A version's name (N12) from its rows' canonical N-Triples lines, in order: over its series, the version it revises
 * and its rows, each of those two lines put in its place among them.
 */
export function nameOver(
  lines: readonly string[],
  series: string,
  previous: string | undefined,
): Promise<string> {
  const named = [...lines];
  for (const line of [
    `<${THIS_VERSION}> <${SPECIALIZATION_OF}> <${series}> .`,
    ...(previous === undefined
      ? []
      : [`<${THIS_VERSION}> <${REVISION_OF}> <${previous}> .`]),
  ]) {
    let [low, high] = [0, named.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (named[middle]! < line) low = middle + 1;
      else high = middle;
    }
    named.splice(low, 0, line);
  }
  return documentName(new TextEncoder().encode(`${named.join("\n")}\n`));
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class Unverified extends Error {}

export async function gunzipped(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  try {
    return await new Response(stream).text();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Unverified(`its rows are not gzip: ${error.message}`);
  }
}

/** A row's subject, predicate and object, the object's value empty when it is a literal. */
type RowTerms = readonly [
  { readonly value: string },
  { readonly value: string },
  { readonly value: string },
];

/** An absolute IRI as N-Triples writes one, without its angle brackets. */
const IRI = String.raw`[A-Za-z][A-Za-z\d+.-]*:(?:[^\p{Cc} <>"{}|^\x60\\%]|%[\dA-Fa-f]{2})*`;
const LITERAL = String.raw`"(?:[^"\\\n\r]|\\[tbnrf"'\\]|\\u[\dA-Fa-f]{4}|\\U[\dA-Fa-f]{8})*"(?:\^\^<${IRI}>|@[A-Za-z]+(?:-[A-Za-z\d]+)*)?`;
/** A row as an N-Triples line: two IRIs, then an IRI or a literal; each IRI is captured. */
const ROW_LINE = new RegExp(
  `^<(${IRI})> <(${IRI})> (?:<(${IRI})>|${LITERAL}) \\.$`,
  "u",
);

/**
 * A version's rows as its published N-Quads give them, read line by line and never into a store: a version of hundreds
 * of thousands of rows parsed whole holds gigabytes. Every line must be in the version's graph, sort after the one
 * before, so the file is canonical N-Quads (N12), and be a row of N-Triples, so a store reads them later; the rows
 * must then give the version's name. Their text is the version's N-Triples, a line each.
 */
async function rowsOf(
  nquads: string,
  version: string,
  series: string,
  previous: string | undefined,
): Promise<{ text: string; terms: RowTerms[] }> {
  const graph = ` <${version}> .`;
  const lines: string[] = [];
  const terms: RowTerms[] = [];
  let last = "";
  for (const line of nquads.split("\n")) {
    if (line === "") continue;
    if (!line.endsWith(graph))
      throw new Unverified(`a row is outside the graph named ${version}`);
    if (line <= last)
      throw new Unverified("its rows are not in canonical order, each once");
    last = line;
    const triple = `${line.slice(0, -graph.length)} .`;
    const found = ROW_LINE.exec(triple);
    if (found === null)
      throw new Unverified(
        `its rows are not N-Quads of IRIs and literals: ${triple}`,
      );
    lines.push(triple);
    terms.push([
      { value: found[1]! },
      { value: found[2]! },
      { value: found[3] ?? "" },
    ]);
  }
  const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  if ((await nameOver(lines, series, previous)) !== version)
    throw new Unverified("its rows and line do not give its name");
  return { text, terms };
}

/** Verifies published rows against their checksum and name, as a check does before it keeps a version. */
export async function verified(rows: RowsToVerify): Promise<Verified> {
  try {
    if ((await sha256(rows.bytes)) !== rows.checksum)
      throw new Unverified(`its rows do not have the checksum the feed gives`);
    const { text, terms } = await rowsOf(
      await gunzipped(rows.bytes),
      rows.version,
      rows.series,
      rows.previous,
    );
    const codes = rowsByCode(terms, rows.foundBy);
    return {
      text: new TextEncoder().encode(text),
      ...(codes === undefined
        ? {}
        : { codes: codes as Uint8Array<ArrayBuffer> }),
      listed: new TextEncoder().encode(
        JSON.stringify(listing(text, rows.uriSpaces)),
      ),
    };
  } catch (error) {
    if (!(error instanceof Unverified)) throw error;
    return { refused: error.message };
  }
}

/** A row of a version's N-Triples, its object as the row writes it. */
export interface Row {
  readonly predicate: string;
  readonly object: string;
}

const ROW = /^<[^>]*> <([^>]*)> (.*) \.$/;

/**
 * The rows of a subject in a version's N-Triples, found by halving: the lines are sorted, so a subject's are together.
 */
export function rowsAbout(text: string, subject: string): Row[] {
  const rows: Row[] = [];
  for (const line of linesAbout(text, subject)) {
    const [, predicate, object] = ROW.exec(line) ?? [];
    if (predicate !== undefined && object !== undefined)
      rows.push({ predicate, object });
  }
  return rows;
}

/** A version's N-Triples as the terms an index by code is made from; an object that is no IRI has an empty value. */
export function termsOfRows(text: string): RowTerms[] {
  const terms: RowTerms[] = [];
  for (const line of text.split("\n")) {
    const found = ROW_LINE.exec(line);
    if (found !== null)
      terms.push([
        { value: found[1]! },
        { value: found[2]! },
        { value: found[3] ?? "" },
      ]);
  }
  return terms;
}

const ESCAPED: Readonly<Record<string, string>> = {
  t: "\t",
  b: "\b",
  n: "\n",
  r: "\r",
  f: "\f",
};

/** An object's value: an IRI's, or a literal's lexical form, unescaped. */
function valueOf(object: string): string {
  if (object.startsWith("<")) return object.slice(1, -1);
  const form = object.slice(1, object.lastIndexOf('"'));
  return !form.includes("\\")
    ? form
    : form.replace(
        /\\(?:u([\dA-Fa-f]{4})|U([\dA-Fa-f]{8})|(.))/g,
        (_, short?: string, long?: string, other?: string) =>
          short !== undefined
            ? String.fromCharCode(parseInt(short, 16))
            : long !== undefined
              ? String.fromCodePoint(parseInt(long, 16))
              : (ESCAPED[other!] ?? other!),
      );
}

/** The values of a predicate's rows, in their order. */
export function values(rows: readonly Row[], predicate: string): string[] {
  return rows
    .filter((row) => row.predicate === predicate)
    .map((row) => valueOf(row.object));
}

const SOURCE = `<${OWL}annotatedSource> <`;
const TARGET = `<${OWL}annotatedTarget> <`;
const PRECISELY = `<${OWL}annotatedProperty> <${PRECISE_INGREDIENT}> .`;
const LABELS = [`<${SKOS}prefLabel> `, `<${SKOS}altLabel> `];

/** A code as written, without its code system's IRI. */
export function notation(uriSpaces: readonly string[], code: string): string {
  return code.slice(uriSpaces.find((space) => code.startsWith(space))?.length);
}

const ORDER = new Intl.Collator("en", { numeric: true });

/** Codes listed in the order of their notations, each list already in it, as one list in that order, each code once. */
export function merged(
  lists: readonly (readonly string[])[],
  uriSpaces: readonly string[],
): readonly string[] {
  if (lists.length <= 1) return lists[0] ?? [];
  type Keyed = { readonly code: string; readonly key: string };
  let level: (readonly Keyed[])[] = lists.map((list) =>
    list.map((code) => ({ code, key: notation(uriSpaces, code) })),
  );
  while (level.length > 1) {
    const next: (readonly Keyed[])[] = [];
    for (let at = 0; at < level.length; at += 2) {
      const [one, other] = [level[at]!, level[at + 1]];
      if (other === undefined) {
        next.push(one);
        continue;
      }
      const both: Keyed[] = [];
      let [i, j] = [0, 0];
      while (i < one.length && j < other.length)
        both.push(
          ORDER.compare(one[i]!.key, other[j]!.key) <= 0
            ? one[i++]!
            : other[j++]!,
        );
      while (i < one.length) both.push(one[i++]!);
      while (j < other.length) both.push(other[j++]!);
      next.push(both);
    }
    level = next;
  }
  // Codes whose notations collate equal need not meet head to head, so a repeat is dropped wherever it falls.
  return [...new Set(level[0]!.map(({ code }) => code))];
}

/** A version's listing, by the lines of its N-Triples, a subject's lines read together. */
export function listing(text: string, uriSpaces: readonly string[]): Listed {
  const codes = new Set<string>();
  const sources = new Map<string, string>();
  const targets = new Map<string, string[]>();
  const preciseRows = new Set<string>();
  const names: Record<string, string> = {};
  const preferred = new Set<string>();
  let [subject, prefix] = ["", ""];
  for (let at = 0; at < text.length;) {
    const found = text.indexOf("\n", at);
    const end = found < 0 ? text.length : found;
    if (prefix === "" || !text.startsWith(prefix, at)) {
      subject = text.slice(at + 1, text.indexOf("> ", at));
      prefix = `<${subject}> `;
      if (uriSpaces.some((space) => subject.startsWith(space)))
        codes.add(subject);
    }
    const predicate = at + prefix.length;
    const label = LABELS.find((each) => text.startsWith(each, predicate));
    if (label !== undefined) {
      names[subject] =
        `${names[subject] ?? ""}\n${valueOf(text.slice(predicate + label.length, end - 2)).toLowerCase()}`;
      if (label === LABELS[0]) preferred.add(subject);
    } else if (text.startsWith(SOURCE, predicate)) {
      const code = text.slice(predicate + SOURCE.length, end - 3);
      codes.add(code);
      sources.set(subject, code);
    } else if (text.startsWith(TARGET, predicate)) {
      const each = targets.get(subject) ?? [];
      each.push(text.slice(predicate + TARGET.length, end - 3));
      targets.set(subject, each);
    } else if (text.startsWith(PRECISELY, predicate)) preciseRows.add(subject);
    at = end + 1;
  }
  const mapsTo: Record<string, string[]> = {};
  const precise: Record<string, string[]> = {};
  for (const [axiom, code] of sources) {
    const into = preciseRows.has(axiom) ? precise : mapsTo;
    for (const target of targets.get(axiom) ?? [])
      if (!(into[code] ??= []).includes(target)) into[code].push(target);
  }
  for (const each of [...Object.values(mapsTo), ...Object.values(precise)])
    each.sort();
  for (const code of Object.keys(names))
    if (!preferred.has(code)) delete names[code];
  return {
    format: LISTING_FORMAT,
    uriSpaces,
    codes: [...codes]
      .map((code) => [notation(uriSpaces, code), code] as const)
      .sort(([a], [b]) => ORDER.compare(a, b))
      .map(([, code]) => code),
    mapsTo,
    precise,
    names,
  };
}

/** What reads a version's rows whole, which a browser does in a Web Worker. */
export interface RowsWork {
  verified(rows: RowsToVerify): Promise<Verified>;
  /** A version's N-Triples from its published rows: each line's graph dropped. */
  published(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
  /** A version's listing, as JSON, from its N-Triples. */
  listed(
    text: Uint8Array<ArrayBuffer>,
    uriSpaces: readonly string[],
  ): Promise<Uint8Array<ArrayBuffer>>;
}

export const IN_THIS_THREAD: RowsWork = {
  verified,
  published: async (bytes) =>
    new TextEncoder().encode(
      (bytes[0] === 0x1f && bytes[1] === 0x8b
        ? await gunzipped(bytes)
        : new TextDecoder().decode(bytes)
      ).replace(/ <[^<>]*> \.$/gm, " ."),
    ),
  listed: async (text, uriSpaces) =>
    new TextEncoder().encode(
      JSON.stringify(listing(new TextDecoder().decode(text), uriSpaces)),
    ),
};
