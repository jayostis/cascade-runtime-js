// The citation checker: whether a cited record or line exists and says what is claimed, and whether a claim that
// something is absent is backed by a query that ran and says what it covered. The harness checks answers with it; an
// app can check a model's answer before showing it.

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

/** The downloads in `folder`, cited by file and line or by FHIR resource. */
export function downloadsSource(folder: string): Source {
  void folder;
  return { at: async () => undefined };
}

/** A pod's entries, each read by `rowsOf` as rows of a field and its value; undefined for an entry there is not. */
export function podRowsSource(
  rowsOf: (
    entry: string,
  ) => Promise<readonly Readonly<Record<string, string>>[] | undefined>,
): Source {
  void rowsOf;
  return { at: async () => undefined };
}

export async function checkCitation(
  claim: Claim,
  source: Source,
): Promise<Verdict> {
  void claim;
  void source;
  return { ok: false, reason: "no such record", missing: [] };
}

export function checkAbsence(absence: Absence, ran: readonly Call[]): Backing {
  void absence;
  void ran;
  return { backed: true };
}
