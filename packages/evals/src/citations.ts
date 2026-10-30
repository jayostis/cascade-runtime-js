// The citation checker: whether a cited record or line exists and says what is claimed, and whether a claim that
// something is absent is backed by a query that ran and says what it covered. The harness checks answers with it; an
// app can check a model's answer before showing it.
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Where a citation points: a line of a download, a FHIR resource in one, or a pod entry as a pod's rows name it. */
export type Cite =
  | { readonly file: string; readonly line: number }
  | { readonly file: string; readonly resource: string }
  | { readonly entry: string };

/** A cited record and what the answer says it holds: a date and values, each to be found where it points. */
export interface Claim {
  readonly cite: Cite;
  readonly date?: string;
  readonly values?: readonly string[];
}

export type Verdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "no such record" | "not at that line" | "says otherwise";
      /** The claimed date and values not found where the citation points. */
      readonly missing: readonly string[];
      /** For a line cited, the lines of the file that hold what is missing there. */
      readonly foundAt?: readonly number[];
    };

/** What a citation reads: the text it points at, and for a line, the file's lines around it. */
export interface Source {
  at(cite: Cite): Promise<Pointed | undefined>;
}

export interface Pointed {
  /** The text the citation points at: a window of lines, a resource's JSON, an entry's rows. */
  readonly text: string;
  /** For a line cited, every line of the file, to say where what is missing is. */
  readonly lines?: readonly string[];
}

/** A claim that a record is absent, with what was looked through and the query that looked. */
export interface Absence {
  readonly what: string;
  readonly coverage: string;
  readonly query?: Call;
}

/** A tool call as it ran, or as an answer says it ran. */
export interface Call {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type Backing =
  | { readonly backed: true }
  | {
      readonly backed: false;
      readonly reason: "no query" | "query not run" | "no coverage";
    };

/** How many lines either side of a cited line still count as the line: a C-CDA entry spans a dozen or so. */
export const WINDOW = 12;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The ways a record writes a date: ISO, HL7's digits, and the month in words, long or short. */
function datesFor(date: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return [date];
  const [, year, month, day] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  const name = MONTHS[Number(month) - 1] ?? "";
  const d = String(Number(day));
  return [
    date,
    `${year}${month}${day}`,
    `${name} ${d}, ${year}`,
    `${name.slice(0, 3)} ${d}, ${year}`,
    `${d} ${name} ${year}`,
  ];
}

const NUMBER = /-?\d+(?:\.\d+)?/g;

/** Whether `text` holds `wanted`: a number as a number (7.9 is 7.90), a date in any of its forms, words as words. */
export function holds(text: string, wanted: string): boolean {
  const lower = text.toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(wanted.trim())) {
    const value = Number(wanted);
    return (text.match(NUMBER) ?? []).some((found) => Number(found) === value);
  }
  return datesFor(wanted.trim()).some((form) =>
    lower.includes(form.toLowerCase()),
  );
}

function wantedOf(claim: Claim): string[] {
  return [
    ...(claim.date === undefined ? [] : [claim.date]),
    ...(claim.values ?? []),
  ];
}

/** Whether a citation points at what there is and holds what is claimed of it. */
export async function checkCitation(
  claim: Claim,
  source: Source,
): Promise<Verdict> {
  const pointed = await source.at(claim.cite);
  if (pointed === undefined)
    return { ok: false, reason: "no such record", missing: [] };
  const missing = wantedOf(claim).filter(
    (wanted) => !holds(pointed.text, wanted),
  );
  if (missing.length === 0) return { ok: true };
  if (pointed.lines !== undefined) {
    const foundAt = pointed.lines.flatMap((line, at) =>
      missing.some((wanted) => holds(line, wanted)) ? [at + 1] : [],
    );
    const everywhere = pointed.lines.join("\n");
    if (missing.every((wanted) => holds(everywhere, wanted)))
      return { ok: false, reason: "not at that line", missing, foundAt };
  }
  return { ok: false, reason: "says otherwise", missing };
}

function sameInput(a: unknown, b: unknown): boolean {
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  )
    return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      sameInput(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    )
  );
}

/** Whether a claim of absence names a query, the query ran (`ran`), and the claim says what the query covered. */
export function checkAbsence(absence: Absence, ran: readonly Call[]): Backing {
  const { query } = absence;
  if (query === undefined) return { backed: false, reason: "no query" };
  if (
    !ran.some(
      (call) => call.tool === query.tool && sameInput(call.input, query.input),
    )
  )
    return { backed: false, reason: "query not run" };
  if (absence.coverage.trim() === "")
    return { backed: false, reason: "no coverage" };
  return { backed: true };
}

/** The resource `Type/id` in a FHIR bundle, or the file when it is that one resource. */
function resourceIn(json: unknown, wanted: string): unknown {
  const named = (resource: unknown) => {
    const { resourceType, id } = (resource ?? {}) as Record<string, unknown>;
    return `${String(resourceType)}/${String(id)}` === wanted;
  };
  if (named(json)) return json;
  const { entry } = (json ?? {}) as { entry?: { resource?: unknown }[] };
  return (entry ?? []).map(({ resource }) => resource).find(named);
}

/** The downloads in `folder`, cited by file and line or by FHIR resource; a path out of the folder names nothing. */
export function downloadsSource(folder: string): Source {
  const root = resolve(folder);
  const read = new Map<string, Promise<string | undefined>>();
  const fileText = (file: string) => {
    const path = resolve(root, file);
    if (
      relative(root, path).startsWith("..") ||
      isAbsolute(relative(root, path))
    )
      return Promise.resolve(undefined);
    let found = read.get(path);
    if (found === undefined) {
      found = readFile(path, "utf8").catch(() => undefined);
      read.set(path, found);
    }
    return found;
  };
  return {
    async at(cite) {
      if (!("file" in cite)) return undefined;
      const text = await fileText(cite.file);
      if (text === undefined) return undefined;
      if ("line" in cite) {
        const lines = text.split(/\r?\n/);
        if (
          !Number.isInteger(cite.line) ||
          cite.line < 1 ||
          cite.line > lines.length
        )
          return undefined;
        const from = Math.max(0, cite.line - 1 - WINDOW);
        return {
          text: lines.slice(from, cite.line + WINDOW).join("\n"),
          lines,
        };
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return undefined;
      }
      const resource = resourceIn(json, cite.resource);
      return resource === undefined
        ? undefined
        : { text: JSON.stringify(resource) };
    },
  };
}

/** A pod's entries, each read by `rowsOf` as rows of a field and its value; undefined for an entry there is not. */
export function podRowsSource(
  rowsOf: (
    entry: string,
  ) => Promise<readonly Readonly<Record<string, string>>[] | undefined>,
): Source {
  return {
    async at(cite) {
      if (!("entry" in cite)) return undefined;
      const rows = await rowsOf(cite.entry);
      return rows === undefined || rows.length === 0
        ? undefined
        : { text: rows.map((row) => Object.values(row).join(" ")).join("\n") };
    },
  };
}
