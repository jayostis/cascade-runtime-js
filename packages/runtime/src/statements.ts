import { createSHA256, type IHasher } from "hash-wasm";
import type { Database, DatabaseFunction, Statement } from "./database.js";
import { codeIri, RDF_LANG_STRING, type Term, XSD, XSD_STRING } from "./rdf.js";

/** The vocabulary's schema of a pod's statements in SQLite, beside its queries. */
export const STATEMENTS_SCHEMA = "queries/statements.sql";
/** The vectors of the six functions a `.sql` calls, beside the vocabulary's queries. */
export const SQL_FUNCTION_VECTORS = "queries/sql-functions.json";

export const BLANK = 1;
export const IRI = 2;
export const LITERAL = 3;

/** An RDF term as SPARQL tells terms apart, as the statements schema keeps it. */
export interface SqlTerm {
  readonly kind: typeof BLANK | typeof IRI | typeof LITERAL;
  /** An IRI's text, a blank node's label, or a literal's lexical form. */
  readonly value: string;
  readonly datatype?: string;
  readonly lang?: string;
}

/** A function given an input the vectors leave unpinned, which every implementation refuses rather than answer. */
export class SqlFunctionRefused extends Error {
  override readonly name = "SqlFunctionRefused";
}

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
  '"': '\\"',
  "\\": "\\\\",
};

const UNESCAPED: Readonly<Record<string, string>> = {
  t: "\t",
  b: "\b",
  n: "\n",
  r: "\r",
  f: "\f",
  '"': '"',
  "'": "'",
  "\\": "\\",
};

/** A literal's lexical form as Oxigraph's N-Triples writes it, between its quotes. */
function escapedText(text: string): string {
  let out = "";
  for (const character of text) {
    const short = SHORT_ESCAPES[character];
    if (short !== undefined) {
      out += short;
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    out +=
      code < 0x20 || code === 0x7f
        ? `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`
        : character;
  }
  return out;
}

function unescapedText(text: string): string {
  return text.replace(
    /\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[\s\S])/g,
    (_, escape: string) => {
      if (escape.length > 1)
        return String.fromCodePoint(parseInt(escape.slice(1), 16));
      const found = UNESCAPED[escape];
      if (found === undefined)
        throw new SyntaxError(`\\${escape} is no N-Triples escape`);
      return found;
    },
  );
}

/** The term in N-Triples, as Oxigraph writes it, so two terms are one exactly when this is. */
export function sqlNt(term: SqlTerm): string {
  if (term.kind === IRI) return `<${term.value}>`;
  if (term.kind === BLANK) return `_:${term.value}`;
  const text = `"${escapedText(term.value)}"`;
  if (term.lang) return `${text}@${term.lang}`;
  return term.datatype === XSD_STRING || term.datatype === undefined
    ? text
    : `${text}^^<${term.datatype}>`;
}

const NT_TERM =
  /^(?:<([^>]*)>|_:(\S+)|"((?:[^"\\]|\\[\s\S])*)"(?:@([A-Za-z0-9-]+)|\^\^<([^>]*)>)?)$/;

/** The term an N-Triples term's text writes. */
export function parsedNt(nt: string): SqlTerm {
  const match = typeof nt === "string" ? NT_TERM.exec(nt) : null;
  if (match === null)
    throw new SyntaxError(`${String(nt)} is no N-Triples term`);
  const [, iriText, blank, text, lang, datatype] = match;
  if (iriText !== undefined)
    return { kind: IRI, value: unescapedText(iriText) };
  if (blank !== undefined) return { kind: BLANK, value: blank };
  return lang !== undefined
    ? {
        kind: LITERAL,
        value: unescapedText(text ?? ""),
        datatype: RDF_LANG_STRING,
        lang,
      }
    : {
        kind: LITERAL,
        value: unescapedText(text ?? ""),
        datatype: datatype ?? XSD_STRING,
      };
}

/** A term of the runtime's own, as the schema keeps it. */
export function sqlTermOf(term: Term): SqlTerm {
  if (term.termType === "NamedNode") return { kind: IRI, value: term.value };
  if (term.termType === "BlankNode") return { kind: BLANK, value: term.value };
  return term.language
    ? {
        kind: LITERAL,
        value: term.value,
        datatype: RDF_LANG_STRING,
        lang: term.language,
      }
    : { kind: LITERAL, value: term.value, datatype: term.datatype.value };
}

// The calendar keys

const DATE_TIME =
  /^(-?\d{4,})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/;
const DATE = /^(-?\d{4,})-(\d\d)-(\d\d)(Z|[+-]\d\d:\d\d)?$/;
const GYEAR = /^(-?\d{4,})(Z|[+-]\d\d:\d\d)?$/;
const GYEAR_MONTH = /^(-?\d{4,})-(\d\d)(Z|[+-]\d\d:\d\d)?$/;
const SCALE = 10n ** 18n;
const FOURTEEN_HOURS = 14n * 3600n * SCALE;
const DATE_TIME_TYPE = `${XSD}dateTime`;
const DATE_TYPE = `${XSD}date`;

/** The floor of a quotient, as Python's `//` gives it. */
function floored(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n !== denominator < 0n
    ? quotient - 1n
    : quotient;
}

function daysFromCivil(year: bigint, month: bigint, day: bigint): bigint {
  const y = year - (month <= 2n ? 1n : 0n);
  const era = floored(y, 400n);
  const ofEra = y - era * 400n;
  const ofYear =
    floored(153n * (month + (month > 2n ? -3n : 9n)) + 2n, 5n) + day - 1n;
  return (
    era * 146097n +
    ofEra * 365n +
    floored(ofEra, 4n) -
    floored(ofEra, 100n) +
    ofYear -
    719468n
  );
}

function civilFromDays(given: bigint): [bigint, bigint, bigint] {
  const days = given + 719468n;
  const era = floored(days, 146097n);
  const ofEra = days - era * 146097n;
  const yearOfEra = floored(
    ofEra -
      floored(ofEra, 1460n) +
      floored(ofEra, 36524n) -
      floored(ofEra, 146096n),
    365n,
  );
  const ofYear =
    ofEra -
    (365n * yearOfEra + floored(yearOfEra, 4n) - floored(yearOfEra, 100n));
  const shifted = floored(5n * ofYear + 2n, 153n);
  const day = ofYear - floored(153n * shifted + 2n, 5n) + 1n;
  const month = shifted + (shifted < 10n ? 3n : -9n);
  return [yearOfEra + era * 400n + (month <= 2n ? 1n : 0n), month, day];
}

function daysIn(year: bigint, month: bigint): bigint {
  const leap = year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
  return (
    [31n, leap ? 29n : 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n][
      Number(month) - 1
    ] ?? 0n
  );
}

/** A zone's offset in minutes, none for no zone, or undefined for one out of range. */
function zoneMinutes(zone: string | undefined): bigint | null | undefined {
  if (zone === undefined) return null;
  if (zone === "Z") return 0n;
  const hours = BigInt(zone.slice(1, 3));
  const minutes = BigInt(zone.slice(4, 6));
  if (hours > 14n || minutes > 59n || (hours === 14n && minutes !== 0n))
    return undefined;
  return (zone.startsWith("-") ? -1n : 1n) * (hours * 60n + minutes);
}

/** A point on the timeline in 10^-18 s from 1970-01-01T00:00:00Z, a value with no zone read as if in UTC. */
interface Moment {
  readonly at: bigint;
  readonly zoned: boolean;
}

/** The moment an xsd:dateTime, xsd:date, xsd:gYear or xsd:gYearMonth value starts, or none when it is ill-typed. */
function moment(
  datatype: string | undefined,
  lexical: string,
): Moment | undefined {
  let seconds: bigint;
  let fractionScaled: bigint;
  let zone: string | undefined;
  if (datatype === DATE_TIME_TYPE) {
    const m = DATE_TIME.exec(lexical);
    if (m === null) return undefined;
    const [year, month, day, hour, minute, second] = m
      .slice(1, 7)
      .map((part) => BigInt(part ?? "0")) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    const fraction = m[7] ?? "";
    if (
      fraction.length > 18 ||
      month < 1n ||
      month > 12n ||
      day < 1n ||
      day > daysIn(year, month) ||
      minute > 59n ||
      second > 59n ||
      hour > 24n ||
      (hour === 24n &&
        (minute !== 0n || second !== 0n || /[1-9]/.test(fraction)))
    )
      return undefined;
    seconds =
      daysFromCivil(year, month, day) * 86400n +
      hour * 3600n +
      minute * 60n +
      second;
    fractionScaled = BigInt(fraction.padEnd(18, "0") || "0");
    zone = m[8];
  } else if (
    datatype === DATE_TYPE ||
    datatype === `${XSD}gYearMonth` ||
    datatype === `${XSD}gYear`
  ) {
    const pattern =
      datatype === DATE_TYPE
        ? DATE
        : datatype === `${XSD}gYear`
          ? GYEAR
          : GYEAR_MONTH;
    const m = pattern.exec(lexical);
    if (m === null) return undefined;
    const parts = m.slice(1, -1).map((part) => BigInt(part ?? "1"));
    zone = m.at(-1);
    const [year = 1n, month = 1n, day = 1n] = parts;
    if (month < 1n || month > 12n || day < 1n || day > daysIn(year, month))
      return undefined;
    seconds = daysFromCivil(year, month, day) * 86400n;
    fractionScaled = 0n;
  } else return undefined;
  const offset = zoneMinutes(zone);
  if (offset === undefined) return undefined;
  return {
    at: (seconds - (offset ?? 0n) * 60n) * SCALE + fractionScaled,
    zoned: offset !== null,
  };
}

const pad = (value: bigint, width: number): string =>
  value.toString().padStart(width, "0");

/**
 * A valid xsd:dateTime's or xsd:date's start in UTC, a value with no zone read as if in UTC, written
 * YYYY-MM-DDThh:mm:ss and eighteen fractional digits; none for any other term, or a year outside 1 to 9999.
 */
export function instantKey(term: SqlTerm): string | null {
  if (
    term.kind !== LITERAL ||
    (term.datatype !== DATE_TIME_TYPE && term.datatype !== DATE_TYPE)
  )
    return null;
  const found = moment(term.datatype, term.value);
  if (found === undefined) return null;
  const whole = floored(found.at, SCALE);
  const fraction = found.at - whole * SCALE;
  const days = floored(whole, 86400n);
  const seconds = whole - days * 86400n;
  const [year, month, day] = civilFromDays(days);
  if (year < 1n || year > 9999n) return null;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(seconds / 3600n, 2)}:${pad((seconds / 60n) % 60n, 2)}:${pad(seconds % 60n, 2)}.${pad(fraction, 18)}`;
}

/** A valid xsd:dateTime's or xsd:date's calendar day as its lexical form writes it, its zone ignored; else none. */
export function dayKey(term: SqlTerm): string | null {
  if (
    term.kind !== LITERAL ||
    (term.datatype !== DATE_TIME_TYPE && term.datatype !== DATE_TYPE)
  )
    return null;
  if (moment(term.datatype, term.value) === undefined) return null;
  const m = (term.datatype === DATE_TIME_TYPE ? DATE_TIME : DATE).exec(
    term.value,
  );
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

// The six functions

const ESCAPED_ALIKE = new Set("\\|.-^?*+{}()[]$nrt");
const QUANTIFIER = /\{\d+(,\d*)?\}/y;
const CASE_APART = /[\u0130\u0131]/u;
const UNASSIGNED = /\p{Cn}/u;
/** Unicode's White_Space property, which Rust's regex passes over under the x flag outside a class. */
const WHITE_SPACE = new Set(
  [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
    0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  ].map((code) => String.fromCodePoint(code)),
);
/** What Unicode 16.0 case-maps that Python 3.12's Unicode 15.0 leaves unassigned, as Oxigraph's LCASE reads it. */
const NEWLY_CASED: readonly (readonly [number, number])[] = [
  [0x1c89, 0x1c89],
  [0xa7cb, 0xa7cc],
  [0xa7ce, 0xa7ce],
  [0xa7d2, 0xa7d2],
  [0xa7d4, 0xa7d4],
  [0xa7da, 0xa7da],
  [0xa7dc, 0xa7dc],
  [0x10d50, 0x10d65],
  [0x16ea0, 0x16eb8],
];

/** An operand as the vocabulary's Python reads it, `value or ""`: a zero SQLite gives as a number is none. */
const operand = (value: unknown): unknown =>
  value === 0 || value === 0n ? null : value;

function text(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new TypeError(`${name} takes text, not ${typeof value}`);
  return value;
}

/**
 * A pattern Oxigraph's regular expressions read, as a JavaScript RegExp with the u flag reads it: `.` any character
 * but a line feed, and `^` and `$` the ends of the text, or under the m flag of a line, as Rust's regex reads them.
 * What the vectors leave out, where the two may read a pattern apart, is refused, as the vocabulary's Python refuses it.
 */
function regexSource(pattern: string, flags: string, subject: string): string {
  if (flags.includes("i")) {
    if (CASE_APART.test(pattern + subject))
      throw new SqlFunctionRefused(
        `${pattern} under the i flag meets a dotted or dotless I, which no vector covers`,
      );
    const unassigned = UNASSIGNED.exec(pattern + subject);
    if (unassigned !== null)
      throw new SqlFunctionRefused(
        `${pattern} under the i flag meets U+${(unassigned[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}, which this Unicode does not assign`,
      );
  }
  if (flags.includes("q"))
    return pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  if (flags.includes("x") && pattern.includes("#"))
    throw new SqlFunctionRefused(
      `${pattern} has a # under the x flag, which no vector covers`,
    );
  const multiline = flags.includes("m");
  const out: string[] = [];
  let inClass = false;
  let quantified = false;
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i] ?? "";
    const after = pattern[i + 1] ?? "";
    if (c === "\\") {
      if (after === "" || !ESCAPED_ALIKE.has(after))
        throw new SqlFunctionRefused(
          `${pattern} uses an escape no vector covers`,
        );
      out.push(!inClass && after === "-" ? "-" : c + after);
      i += 2;
      quantified = false;
      continue;
    }
    if (inClass) {
      const two = pattern.slice(i, i + 2);
      if (
        c === "[" ||
        two === "&&" ||
        two === "--" ||
        two === "~~" ||
        (flags.includes("x") && WHITE_SPACE.has(c))
      )
        throw new SqlFunctionRefused(`${pattern} has a class no vector covers`);
      inClass = c !== "]";
      out.push(c);
      i += 1;
      continue;
    }
    if (flags.includes("x") && WHITE_SPACE.has(c)) {
      if (c > "\u007f")
        throw new SqlFunctionRefused(
          `${pattern} has white space U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")} outside a class under the x flag, which no vector covers`,
        );
      i += 1;
      continue;
    }
    if (c === "[") {
      const opening = /^\^?\]?/.exec(pattern.slice(i + 1))?.[0] ?? "";
      out.push(`[${opening.replace("]", "\\]")}`);
      i += 1 + opening.length;
      inClass = true;
      quantified = false;
      continue;
    }
    if (c === "(" && after === "?") {
      if (pattern[i + 2] !== ":")
        throw new SqlFunctionRefused(
          `${pattern} opens a group with (? but (?:, which no vector covers`,
        );
      out.push("(?:");
      i += 3;
      quantified = false;
      continue;
    }
    QUANTIFIER.lastIndex = i;
    const quantifier = c === "{" ? QUANTIFIER.exec(pattern) : null;
    if ((c === "{" || c === "}") && quantifier === null)
      throw new SqlFunctionRefused(
        `${pattern} has a ${c} that is no quantifier, which no vector covers`,
      );
    if (c === "*" || c === "+" || c === "?" || quantifier !== null) {
      if (quantified)
        throw new SqlFunctionRefused(
          `${pattern} has a quantifier after a quantifier, which no vector covers`,
        );
      const token = quantifier?.[0] ?? c;
      out.push(token);
      i += token.length;
      quantified = true;
      continue;
    }
    if (c === ".") out.push(flags.includes("s") ? "[\\s\\S]" : "[^\\n]");
    else if (c === "^") out.push(multiline ? "(?<![^\\n])" : "^");
    else if (c === "$") out.push(multiline ? "(?![^\\n])" : "$");
    else if (c === "]") out.push("\\]");
    else out.push(c);
    i += 1;
    quantified = false;
  }
  return out.join("");
}

const REFERENCE = /\$(?:\$|\{([A-Za-z0-9_]+)\}|([A-Za-z0-9_]+))?/g;

/** The replacement with `$name`, `${name}` and `$$` read as Rust's regex reads them. */
function expanded(replacement: string, match: RegExpExecArray): string {
  return replacement.replace(
    REFERENCE,
    (found, braced?: string, bare?: string) => {
      if (found === "$$") return "$";
      const name = braced ?? bare;
      if (name === undefined) return "$";
      return /^\d+$/.test(name) ? (match[Number(name)] ?? "") : "";
    },
  );
}

/** SPARQL's REPLACE as Oxigraph gives it, over strings; null for null, bad flags or a pattern that does not compile. */
export function sparqlReplace(
  textValue: unknown,
  patternValue: unknown,
  replacementValue: unknown,
  flagsValue?: unknown,
): string | null {
  const subject = text(textValue, "sparql_replace");
  const pattern = text(patternValue, "sparql_replace");
  const replacement = text(replacementValue, "sparql_replace");
  if (subject === null || pattern === null || replacement === null) return null;
  const flags = text(flagsValue, "sparql_replace") ?? "";
  if ([...flags].some((flag) => !"smixq".includes(flag))) return null;
  let compiled: RegExp;
  try {
    compiled = new RegExp(
      regexSource(pattern, flags, subject),
      `gu${flags.includes("i") ? "i" : ""}`,
    );
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const step = (at: number): number =>
    at + ((subject.codePointAt(at) ?? 0) > 0xffff ? 2 : 1);
  let out = "";
  let at = 0;
  let previous: { start: number; end: number } | undefined;
  let from = 0;
  while (from <= subject.length) {
    compiled.lastIndex = from;
    const match = compiled.exec(subject);
    if (match === null) break;
    const start = match.index;
    const end = start + match[0].length;
    const empty = start === end;
    if (!(
      empty &&
      previous !== undefined &&
      previous.end === start &&
      previous.end > previous.start
    )) {
      out += subject.slice(at, start) + expanded(replacement, match);
      at = end;
      previous = { start, end };
    }
    from = empty ? step(end) : end;
  }
  return out + subject.slice(at);
}

/** SPARQL's ENCODE_FOR_URI: each UTF-8 byte of a character but A-Z, a-z, 0-9, `-`, `.`, `_` and `~` as upper-case %XX. */
export function sparqlEncodeForUri(value: unknown): string | null {
  const given = text(value, "sparql_encode_for_uri");
  return given === null ? null : codeIri("", given);
}

/** SPARQL's LCASE: Unicode's full lower-case mapping with the final sigma; a character Unicode 16.0 newly cases is refused. */
export function sparqlLcase(value: unknown): string | null {
  const given = text(value, "sparql_lcase");
  if (given === null) return null;
  for (const character of given) {
    const code = character.codePointAt(0) ?? 0;
    if (NEWLY_CASED.some(([low, high]) => low <= code && code <= high))
      throw new SqlFunctionRefused(
        `sparql_lcase meets U+${code.toString(16).toUpperCase().padStart(4, "0")}, which Unicode 15.0 does not assign and 16.0 lower-cases`,
      );
  }
  return given.toLowerCase();
}

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;
const INTEGER_LIMIT = 2n ** 127n;

/** A decimal or integer lexical form as a count of 10^-18, or none where Oxigraph would hold it ill-typed. */
function scaled(lexical: string | null): bigint | undefined {
  const match = DECIMAL.exec(lexical ?? "");
  if (match === null || !(match[2] || match[3])) return undefined;
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  if (fraction.length > 18) return undefined;
  const magnitude =
    BigInt(match[2] || "0") * SCALE + BigInt(fraction.padEnd(18, "0") || "0");
  const value = match[1] === "-" ? -magnitude : magnitude;
  return value >= -INTEGER_LIMIT && value < INTEGER_LIMIT ? value : undefined;
}

function decimalText(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % SCALE)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return `${sign}${magnitude / SCALE}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Exact xsd:decimal arithmetic as SPARQL 1.1 gives it at eighteen fractional digits: `+`, `-`, `*`, `/` cut off
 * towards zero, and `floor` of the left alone; null where it raises an error.
 */
export function sparqlDecimal(
  operatorValue: unknown,
  leftValue: unknown,
  rightValue?: unknown,
): string | null {
  const operator = text(operatorValue, "sparql_decimal");
  const a = scaled(text(operand(leftValue), "sparql_decimal"));
  const b =
    operator === "floor"
      ? undefined
      : scaled(text(operand(rightValue ?? null), "sparql_decimal"));
  if (a === undefined || (operator !== "floor" && b === undefined)) return null;
  let value: bigint;
  if (operator === "+") value = a + (b ?? 0n);
  else if (operator === "-") value = a - (b ?? 0n);
  else if (operator === "*") {
    const product = a * (b ?? 0n);
    if (product % SCALE !== 0n) return null;
    value = product / SCALE;
  } else if (operator === "/") {
    if (b === 0n || b === undefined) return null;
    value = (a * SCALE) / b;
  } else if (operator === "floor") value = floored(a, SCALE) * SCALE;
  else
    throw new SqlFunctionRefused(
      `${String(operator)} is no operator sparql_decimal knows`,
    );
  return value >= -INTEGER_LIMIT && value < INTEGER_LIMIT
    ? decimalText(value)
    : null;
}

const INTEGERS = new Set(
  [
    "integer",
    "nonPositiveInteger",
    "negativeInteger",
    "long",
    "int",
    "short",
    "byte",
    "nonNegativeInteger",
    "unsignedLong",
    "unsignedInt",
    "unsignedShort",
    "unsignedByte",
    "positiveInteger",
  ].map((name) => XSD + name),
);
const FLOATS = new Set([`${XSD}float`, `${XSD}double`]);
const NUMERIC = new Set([...INTEGERS, ...FLOATS, `${XSD}decimal`]);
const CALENDAR = new Set([
  DATE_TIME_TYPE,
  DATE_TYPE,
  `${XSD}gYear`,
  `${XSD}gYearMonth`,
]);
const COMPARED_ELSEWHERE = new Set(
  [
    "time",
    "duration",
    "dayTimeDuration",
    "yearMonthDuration",
    "gMonth",
    "gDay",
    "gMonthDay",
  ].map((name) => XSD + name),
);
const FLOAT =
  /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?INF|NaN)$/;
const INTEGER = /^[+-]?\d+$/;
const BOOLEAN: Readonly<Record<string, number>> = {
  false: 0,
  "0": 0,
  true: 1,
  "1": 1,
};
const LONG = 2n ** 63n;

type Value = { readonly exact: bigint } | { readonly float: number };

function numberOf(term: SqlTerm): Value | undefined {
  if (FLOATS.has(term.datatype ?? "")) {
    if (!FLOAT.test(term.value)) return undefined;
    const value = term.value
      .replace(/^(\+?)INF$/, "Infinity")
      .replace(/^-INF$/, "-Infinity");
    return { float: Number(value) };
  }
  if (INTEGERS.has(term.datatype ?? "")) {
    if (!INTEGER.test(term.value)) return undefined;
    const value = BigInt(term.value);
    return value >= -LONG && value < LONG
      ? { exact: value * SCALE }
      : undefined;
  }
  const exact = scaled(term.value);
  return exact === undefined ? undefined : { exact };
}

const order = <T extends number | bigint>(a: T, b: T): number =>
  (a > b ? 1 : 0) - (a < b ? 1 : 0);

/** Two strings' order by code point, which JavaScript's `<` over UTF-16 code units does not give. */
function codePointOrder(a: string, b: string): number {
  const shifted = (unit: number): number =>
    unit >= 0xd800 && unit <= 0xdfff
      ? unit + 0x2000
      : unit >= 0xe000
        ? unit - 0x800
        : unit;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return order(shifted(x), shifted(y));
  }
  return order(a.length, b.length);
}

const same = (a: SqlTerm, b: SqlTerm): boolean =>
  a.kind === b.kind &&
  a.value === b.value &&
  a.datatype === b.datatype &&
  a.lang === b.lang;

/**
 * -1, 0 or 1 as SPARQL 1.1's <, = and > order two terms given as N-Triples; null where that raises an error. A datatype
 * SPARQL compares but this does not, such as xsd:time or a duration, is refused.
 */
export function sparqlCompare(
  leftValue: unknown,
  rightValue: unknown,
): number | null {
  const left = text(leftValue, "sparql_compare");
  const right = text(rightValue, "sparql_compare");
  if (left === null || right === null) return null;
  const a = parsedNt(left);
  const b = parsedNt(right);
  const numeric =
    NUMERIC.has(a.datatype ?? "") && NUMERIC.has(b.datatype ?? "");
  const x = numeric ? numberOf(a) : undefined;
  const y = numeric ? numberOf(b) : undefined;
  if (same(a, b) && (x === undefined || y === undefined)) return 0;
  if (a.kind !== LITERAL || b.kind !== LITERAL) return null;
  if (numeric) {
    if (x === undefined || y === undefined) return null;
    if ("exact" in x && "exact" in y) return order(x.exact, y.exact);
    const float = (value: Value, term: SqlTerm): number =>
      "float" in value ? value.float : Number(term.value);
    const p = float(x, a);
    const q = float(y, b);
    return Number.isNaN(p) || Number.isNaN(q) ? null : order(p, q);
  }
  if (
    COMPARED_ELSEWHERE.has(a.datatype ?? "") ||
    COMPARED_ELSEWHERE.has(b.datatype ?? "")
  )
    throw new SqlFunctionRefused(
      `sparql_compare does not compare ${a.datatype} and ${b.datatype}`,
    );
  if (a.datatype !== b.datatype) return null;
  if (a.datatype === XSD_STRING) return codePointOrder(a.value, b.value);
  if (a.datatype === `${XSD}boolean`) {
    const p = BOOLEAN[a.value];
    const q = BOOLEAN[b.value];
    return p === undefined || q === undefined ? null : order(p, q);
  }
  if (a.datatype === RDF_LANG_STRING)
    return a.lang?.toLowerCase() === b.lang?.toLowerCase()
      ? codePointOrder(a.value, b.value)
      : null;
  if (CALENDAR.has(a.datatype ?? "")) {
    const p = moment(a.datatype, a.value);
    const q = moment(b.datatype, b.value);
    if (p === undefined || q === undefined) return null;
    if (p.zoned === q.zoned) return order(p.at, q.at);
    const apart = p.at > q.at ? p.at - q.at : q.at - p.at;
    return apart > FOURTEEN_HOURS ? order(p.at, q.at) : null;
  }
  return null;
}

let hasher: Promise<IHasher> | undefined;

/** The six functions a `.sql` calls, by their names, as the vectors in `queries/sql-functions.json` pin them. */
export async function sqlFunctions(): Promise<
  Readonly<Record<string, (...values: unknown[]) => string | number | null>>
> {
  const sha = await (hasher ??= createSHA256());
  return {
    sparql_replace: (...values) =>
      sparqlReplace(values[0], values[1], values[2], values[3]),
    sparql_sha256: (value) => {
      const given = text(value, "sparql_sha256");
      if (given === null) return null;
      sha.init();
      sha.update(given);
      return sha.digest("hex");
    },
    sparql_encode_for_uri: (value) => sparqlEncodeForUri(value),
    sparql_lcase: (value) => sparqlLcase(value),
    sparql_decimal: (...values) =>
      sparqlDecimal(values[0], values[1], values[2]),
    sparql_compare: (left, right) => sparqlCompare(left, right),
  };
}

/** The six functions, to register on a connection: a whole number is given to SQL as an integer, as Python's is. */
export async function sqlDatabaseFunctions(): Promise<DatabaseFunction[]> {
  return Object.entries(await sqlFunctions()).map(([name, apply]) => ({
    name,
    deterministic: true,
    apply: (...values: unknown[]) => {
      const answer = apply(...values);
      return typeof answer === "number" && Number.isInteger(answer)
        ? BigInt(answer)
        : answer;
    },
  }));
}

// The loader

/** A named graph and its statements, as N-Triples written by Oxigraph. */
export interface GraphStatements {
  readonly graph: string;
  readonly ntriples: string;
}

const LINE_TERM =
  /<[^>]*>|_:\S+|"(?:[^"\\]|\\[\s\S])*"(?:@[A-Za-z0-9-]+|\^\^<[^>]*>)?/y;
const RECORD = "<https://ns.cascadeprotocol.org/cascade#Record>";
const ENTRY_MEMBER = "<https://ns.cascadeprotocol.org/cascade#entryMember>";
const RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";

function lineTerms(line: string): [string, string, string] {
  const terms: string[] = [];
  let at = 0;
  while (terms.length < 3) {
    LINE_TERM.lastIndex = at;
    const found = LINE_TERM.exec(line);
    if (found === null) break;
    terms.push(found[0]);
    at = LINE_TERM.lastIndex + 1;
  }
  if (terms.length !== 3 || line.slice(at - 1).trim() !== ".")
    throw new SyntaxError(`${line} is no N-Triples statement`);
  return terms as [string, string, string];
}

/** Each index the schema makes: made once the statements are loaded, which sorts each once instead of keeping it sorted. */
const INDEX = /^CREATE INDEX\b[^;]*;/gim;

/** The SQLite version the schema says it needs, as numbers. */
function minimumVersion(schema: string): number[] {
  const found = /SQLite (\d+)\.(\d+)\.(\d+)/.exec(schema);
  return found === null ? [0, 0, 0] : found.slice(1).map(Number);
}

const versionOrder = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((found, part, at) => found || order(part, b[at] ?? 0), 0);

const XSD_INTEGER = `${XSD}integer`;
const XSD_DECIMAL = `${XSD}decimal`;
const XSD_BOOLEAN = `${XSD}boolean`;

/** A time, date or dateTime: what comes before its seconds' fraction, the fraction's digits, and its offset. */
const CALENDAR_LEXICAL: Readonly<Record<string, RegExp>> = {
  [`${XSD}dateTime`]:
    /^(-?\d{4,}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/,
  [`${XSD}time`]:
    /^((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/,
  [`${XSD}date`]:
    /^(-?\d{4,}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))()(Z|[+-]\d\d:\d\d)?$/,
};

/**
 * A valid xsd:integer's, xsd:decimal's or xsd:boolean's lexical form as Oxigraph's store holds it ("01" as "1", "1.50"
 * as "1.5", "1" as "true"), and a time's, date's or dateTime's ("01.710Z" as "01.71Z", "+00:00" as "Z"); any other
 * term's as it is.
 */
function canonicalLexical(term: SqlTerm): string {
  if (term.kind !== LITERAL) return term.value;
  const calendar =
    term.datatype === undefined
      ? undefined
      : CALENDAR_LEXICAL[term.datatype]?.exec(term.value);
  if (calendar) {
    const [, before = "", fraction = "", zone = ""] = calendar;
    const digits = fraction.replace(/0+$/, "");
    return `${before}${digits === "" ? "" : `.${digits}`}${zone === "+00:00" || zone === "-00:00" ? "Z" : zone}`;
  }
  if (term.datatype === XSD_INTEGER && INTEGER.test(term.value)) {
    const value = BigInt(term.value);
    return value >= -LONG && value < LONG ? value.toString() : term.value;
  }
  if (term.datatype === XSD_DECIMAL) {
    const value = scaled(term.value);
    return value === undefined ? term.value : decimalText(value);
  }
  if (term.datatype === XSD_BOOLEAN && Object.hasOwn(BOOLEAN, term.value))
    return BOOLEAN[term.value] === 1 ? "true" : "false";
  return term.value;
}

/** Each term's id in a pod's statements, put in `term` the first time it is asked for. */
class TermIds {
  readonly #ids = new Map<string, number>();
  readonly #put: Statement;
  readonly #held: Statement | undefined;
  #next: number;

  /** Over a database that may hold terms already, unless `empty` says it holds none, so none is looked up. */
  constructor(db: Database, empty: boolean) {
    this.#put = db.prepare(
      "INSERT INTO term (id, nt, kind, lex, datatype, lang, instant, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.#held = empty
      ? undefined
      : db.prepare("SELECT id FROM term WHERE nt = ?");
    this.#next = empty
      ? 1
      : Number(db.prepare("SELECT max(id) AS id FROM term").get()?.id ?? 0) + 1;
  }

  /** The id of the term the N-Triples text writes, which is as Oxigraph writes it. */
  id(nt: string, term?: SqlTerm): number {
    let found = this.held(nt);
    if (found !== undefined) return found;
    const parsed = term ?? parsedNt(nt);
    found = this.#next++;
    this.#put.run(
      found,
      nt,
      parsed.kind,
      parsed.kind === BLANK ? null : parsed.value,
      parsed.datatype ?? null,
      parsed.lang ?? null,
      instantKey(parsed),
      dayKey(parsed),
    );
    this.#ids.set(nt, found);
    return found;
  }

  /** The id of the term, if the pod's statements have one. */
  held(nt: string): number | undefined {
    const found = this.#ids.get(nt);
    if (found !== undefined || this.#held === undefined) return found;
    const held = this.#held.get(nt)?.id;
    if (held === undefined) return undefined;
    this.#ids.set(nt, Number(held));
    return Number(held);
  }
}

/** The term as Oxigraph's store holds it, in N-Triples: an integer, decimal or boolean in its canonical form. */
export function heldNt(term: Term): string {
  const sql = sqlTermOf(term);
  return sqlNt({ ...sql, value: canonicalLexical(sql) });
}

/**
 * Makes the schema on an empty database and loads the graphs' statements into it: each term once, by its N-Triples as
 * Oxigraph writes it, with its kind, lexical form, datatype, language and calendar keys; every record and entry in
 * scope, as a whole run fills it; and the ledger's one row naming what the whole was built from. A term written
 * otherwise than Oxigraph writes it, escaped otherwise or an integer, decimal or boolean not in the canonical form its
 * store holds, is refused, as is an SQLite older than the schema needs. The graphs given are a `Union`'s, so the default
 * graph a query reads is their union by construction, which the vocabulary's loader has to check of an Oxigraph store.
 */
export function loadStatements(
  db: Database,
  schema: string,
  graphs: Iterable<GraphStatements>,
  fingerprint: string,
): void {
  const version = String(
    db.prepare("SELECT sqlite_version() AS v").get()?.v ?? "0.0.0",
  )
    .split(".")
    .map(Number);
  if (versionOrder(version, minimumVersion(schema)) < 0)
    throw new Error(
      `SQLite ${version.join(".")} is older than the ${minimumVersion(schema).join(".")} the schema needs`,
    );
  const indexes = schema.match(INDEX) ?? [];
  db.exec(schema.replace(INDEX, ""));
  const putQuad = db.prepare(
    "INSERT OR IGNORE INTO quad (s, p, o, g) VALUES (?, ?, ?, ?)",
  );
  const terms = new TermIds(db, true);
  const id = (nt: string): number => {
    const known = terms.held(nt);
    if (known !== undefined) return known;
    const term = parsedNt(nt);
    const canonical = sqlNt({ ...term, value: canonicalLexical(term) });
    if (canonical !== nt)
      throw new Error(
        `${nt} is written ${canonical} here, not as Oxigraph writes it`,
      );
    return terms.id(nt, term);
  };
  db.transaction(() => {
    for (const { graph, ntriples } of graphs) {
      const g = id(`<${graph}>`);
      for (const line of ntriples.split("\n")) {
        if (line.trim() === "") continue;
        const [s, p, o] = lineTerms(line);
        putQuad.run(id(s), id(p), id(o), g);
      }
    }
    for (const index of indexes) db.exec(index);
    ledgerNamed(db, fingerprint);
    wholeScope(db);
  });
}

/** A graph's triples, each term as Oxigraph's store holds it, in N-Triples. */
export type HeldTriples = Iterable<readonly [string, string, string]>;

/**
 * Keyed writes of a pod's statements loaded before: each a delete or an insert by key, never a table read whole, so a
 * step writes what it changed and no more. Each subject removed or written is kept, for a keyed run's scope.
 */
export class KeyedStatements {
  readonly #db: Database;
  readonly #terms: TermIds;
  readonly #touched = new Set<number>();
  readonly #put: Statement;
  readonly #removeSubject: Statement;
  readonly #subjectsOf: Statement;
  readonly #removeGraph: Statement;

  constructor(db: Database) {
    this.#db = db;
    this.#terms = new TermIds(db, false);
    this.#put = db.prepare(
      "INSERT OR IGNORE INTO quad (s, p, o, g) VALUES (?, ?, ?, ?)",
    );
    this.#removeSubject = db.prepare("DELETE FROM quad WHERE g = ? AND s = ?");
    this.#subjectsOf = db.prepare(
      "SELECT DISTINCT s FROM quad INDEXED BY quad_g WHERE g = ?",
    );
    this.#removeGraph = db.prepare("DELETE FROM quad WHERE g = ?");
  }

  /** Removes from the graph every statement whose subject is one of the IRIs, as `Store.removeSubjects` does. */
  removeSubjects(graph: string, subjects: Iterable<string>): void {
    const g = this.#terms.held(`<${graph}>`);
    for (const subject of subjects) {
      const s = this.#terms.held(sqlNt({ kind: IRI, value: subject }));
      if (s === undefined) continue;
      this.#touched.add(s);
      if (g !== undefined) this.#removeSubject.run(g, s);
    }
  }

  /** Removes every statement of the graph. */
  removeGraph(graph: string): void {
    const g = this.#terms.held(`<${graph}>`);
    if (g === undefined) return;
    for (const { s } of this.#subjectsOf.all(g)) this.#touched.add(Number(s));
    this.#removeGraph.run(g);
  }

  /** Puts the triples in the graph. */
  add(graph: string, triples: HeldTriples): void {
    const g = this.#terms.id(`<${graph}>`);
    for (const [subject, predicate, object] of triples) {
      const s = this.#terms.id(subject);
      this.#touched.add(s);
      this.#put.run(s, this.#terms.id(predicate), this.#terms.id(object), g);
    }
  }

  /** Puts each subject removed or written in `scope`, and nothing else, as a keyed run is given them. */
  scoped(): void {
    this.#db.prepare("DELETE FROM scope").run();
    if (hasAsked(this.#db)) this.#db.prepare("DELETE FROM asked").run();
    const put = this.#db.prepare(
      "INSERT OR IGNORE INTO scope (term) VALUES (?)",
    );
    for (const term of this.#touched) put.run(term);
  }
}

/** The ledger's fingerprint of what the whole was built from; none for a database the schema was never made in. */
export function ledgerFingerprint(db: Database): string | undefined {
  const made =
    db
      .prepare(
        "SELECT 1 AS found FROM sqlite_schema WHERE type = 'table' AND name = 'ledger'",
      )
      .get() !== undefined;
  if (!made) return undefined;
  const found = db
    .prepare("SELECT fingerprint FROM ledger WHERE built = 'pod'")
    .get()?.fingerprint;
  return typeof found === "string" ? found : undefined;
}

/** Names in the ledger the fingerprint of what the whole now holds. */
export function ledgerNamed(db: Database, fingerprint: string): void {
  db.prepare(
    "INSERT INTO ledger (built, fingerprint) VALUES ('pod', ?) ON CONFLICT (built) DO UPDATE SET fingerprint = excluded.fingerprint",
  ).run(fingerprint);
}

/**
 * The graphs a store's dump holds, those `kept` names, each block of it the N-Triples Oxigraph writes of a graph:
 * decoded a block at a time, so the whole is never held as text.
 */
export function* graphsOfDump(
  bytes: Uint8Array,
  kept: ReadonlySet<string>,
): Generator<GraphStatements> {
  const decoder = new TextDecoder();
  let at = bytes.indexOf(0x0a) + 1;
  while (at > 0 && at < bytes.length) {
    const opened = bytes.indexOf(0x0a, at);
    if (opened < 0) return;
    const graph = /^<(.*)> \{$/.exec(
      decoder.decode(bytes.subarray(at, opened)),
    )?.[1];
    let close = opened;
    while (close >= 0 && bytes[close + 1] !== 0x7d)
      close = bytes.indexOf(0x0a, close + 1);
    if (close < 0) return;
    if (graph !== undefined && kept.has(graph))
      yield {
        graph,
        ntriples: decoder.decode(bytes.subarray(opened + 1, close)),
      };
    at = close + 3;
  }
}

/** Every record and entry in scope, as a whole run fills it, and a question asked of the whole pod. */
export function wholeScope(db: Database): void {
  if (hasAsked(db)) db.prepare("DELETE FROM asked").run();
  everyRecordInScope(db);
}

function everyRecordInScope(db: Database): void {
  db.prepare("DELETE FROM scope").run();
  db.prepare(
    "INSERT INTO scope (term) SELECT s FROM quad WHERE p = (SELECT id FROM term WHERE nt = ?) " +
      "AND o = (SELECT id FROM term WHERE nt = ?) UNION SELECT s FROM quad WHERE p = (SELECT id FROM term WHERE nt = ?)",
  ).run(RDF_TYPE, RECORD, ENTRY_MEMBER);
}

/** Whether the schema has `asked`; one made before it had binds a question through `scope`. */
const hasAsked = (db: Database): boolean =>
  db
    .prepare(
      "SELECT 1 AS found FROM sqlite_schema WHERE type = 'table' AND name = 'asked'",
    )
    .get() !== undefined;

/**
 * A question asked of the records alone, as a runtime asks it bound to them: the ones the pod holds put in `asked`.
 * False when it holds none of them, and the question then gives no rows and is not run, since an empty `asked` is
 * the whole pod.
 */
export function askedOf(db: Database, records: readonly string[]): boolean {
  const table = hasAsked(db) ? "asked" : "scope";
  db.prepare(`DELETE FROM ${table}`).run();
  const put = db.prepare(
    `INSERT INTO ${table} (term) SELECT id FROM term WHERE nt = ?`,
  );
  let held = 0;
  for (const record of records) held += put.run(`<${record}>`).changes;
  return held > 0;
}

/** A question asked of the whole pod again: `asked` emptied, or, in a schema without it, every record in scope. */
export function askedWhole(db: Database): void {
  if (hasAsked(db)) db.prepare("DELETE FROM asked").run();
  else everyRecordInScope(db);
}

/** The parts of a view's `.sql`, by name, each opened by a line `-- part: NAME`; none for a `.sql` of one statement. */
export function sqlParts(sql: string): ReadonlyMap<string, string> {
  const parts = new Map<string, string>();
  let name: string | undefined;
  let lines: string[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const opened = /^--\s*part:\s*(\S+)\s*$/.exec(line);
    if (opened === null) {
      lines.push(line);
      continue;
    }
    if (name !== undefined) parts.set(name, lines.join("\n"));
    name = opened[1];
    lines = [];
  }
  if (name !== undefined) parts.set(name, lines.join("\n"));
  return parts;
}

/** The column a list question gives last, its row's entry key: a sort key, not a term. */
export const PAGE_KEY = "page_key";

/**
 * What a `.sql` gives: its columns, and its rows with each value a term's N-Triples, or null where unbound; for a list
 * question, its trailing `page_key` taken off both and each row's key as written in `keys`.
 */
export interface SqlAnswer {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly keys?: readonly (string | null)[];
}

/** Runs the `.sql`'s one statement with the named parameters given. A value that is no N-Triples term is refused. */
export function sqlAnswer(
  db: Database,
  sql: string,
  parameters?: Readonly<Record<string, unknown>>,
): SqlAnswer {
  const statement = db.prepare(sql);
  const named = statement.columns();
  const paged = named.at(-1) === PAGE_KEY;
  const columns = paged ? named.slice(0, -1) : named;
  const found =
    parameters === undefined ? statement.all() : statement.all(parameters);
  const keys = found.map((row) => {
    const key = row[PAGE_KEY];
    return typeof key === "string" ? key : null;
  });
  const rows = found.map((row) =>
    columns.map((column) => {
      const value = row[column];
      if (value === null || value === undefined) return null;
      if (typeof value !== "string")
        throw new TypeError(
          `the column ${column} gives ${String(value)}, no N-Triples term`,
        );
      return sqlNt(parsedNt(value));
    }),
  );
  return paged ? { columns, rows, keys } : { columns, rows };
}

/**
 * The statements of a script, each without its closing `;`: split where a `;` stands outside a string, a quoted name
 * and a comment. A script that makes a trigger, whose body holds `;`, is not split right.
 */
export function sqlStatements(script: string): string[] {
  const found: string[] = [];
  let start = 0;
  let at = 0;
  const closing: Readonly<Record<string, string>> = {
    "'": "'",
    '"': '"',
    "`": "`",
    "[": "]",
  };
  while (at < script.length) {
    const character = script[at] ?? "";
    const close = closing[character];
    if (close !== undefined) {
      const end = script.indexOf(close, at + 1);
      at = end < 0 ? script.length : end + 1;
    } else if (script.startsWith("--", at)) {
      const end = script.indexOf("\n", at);
      at = end < 0 ? script.length : end + 1;
    } else if (script.startsWith("/*", at)) {
      const end = script.indexOf("*/", at + 2);
      at = end < 0 ? script.length : end + 2;
    } else if (character === ";") {
      found.push(script.slice(start, at));
      at += 1;
      start = at;
    } else at += 1;
  }
  found.push(script.slice(start));
  return found.filter(
    (statement) =>
      statement
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim() !== "",
  );
}
