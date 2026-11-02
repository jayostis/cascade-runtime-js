// `cascade-runtime/tools`: the tools a model reads pods by, their input schemas and their answers, over the reads a
// host gives (`PodReads`), in Node and in a page alike. Every tool reads; none writes, moves an app or opens an encrypted
// pod. The reads over a folder of pods are Node's, from `cascade-runtime/tools/node`.
import { Refusal } from "@cascade-runtime/runtime/refusal";
import {
  changeTools,
  compact,
  type CompactFinding,
  type Finding,
} from "./changes.js";
import { checkInput, type InputSchema } from "./check.js";
import type { Row } from "./pod.js";
import {
  HISTORY_QUESTION,
  medicationsNotChecked,
  medicationsSharingAnIngredient,
  REPORTS_QUESTION,
  reportsDifferingFromClinVar,
  VARIANTS_QUESTION,
  variantsAsked,
  variantsNotChecked,
  type MedicationNotChecked,
  type MedicationsSharingAnIngredient,
  type ReportDifferingFromClinVar,
  type VariantNotChecked,
} from "./table-checks.js";
import type { About, VariantAsked, WhatClinVarSays } from "./tables/types.js";

export * from "./table-checks.js";

// ---- The compact read's names: its handles and its shapes. The read itself is Node's (`compact-read.ts`, behind `podReads`). ----

/** The question whose rows name each entry's records and the documents they came from. */
export const PROVENANCE_QUESTION = "entry/Where it came from";

/** The most characters one answer of the compact read holds as JSON: under the 30,000 a shell's output is cut at. */
export const PAGE_CHARACTERS = 24_000;

/** A handle: a letter of the entry's view, then the start of the entry's fragment, at least 8 of its 64 hex digits. */
export const HANDLE = /^([A-Z])([0-9a-f]{8,64})$/;
const SHORTEST = 8;
const ENTRY = /^[^#\s]+#([0-9a-f]{64})$/;

/** The letter of the view an entry is named in: the first of its view file's name (`lab-results.ttl#…`, L). */
function letterOf(entry: string): string {
  const file = entry.split("#")[0]!.split("/").pop() ?? "";
  return /[a-z]/i.test(file[0] ?? "") ? file[0]!.toUpperCase() : "E";
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The entry `handle` names among `members`, each an entry with a record merged into it: the one entry whose fragment
 * starts with the handle's digits and whose view has its letter; failing that, a handle minted before a record that
 * sorts first joined the entry, so the entry holding the one record whose name's SHA-256 starts with them (an entry's
 * fragment is the SHA-256 of its least member's name). Undefined when it names none, or more than one.
 */
export async function entryOfHandle(
  handle: string,
  members: readonly { readonly entry: string; readonly record?: string }[],
): Promise<string | undefined> {
  const parts = HANDLE.exec(handle);
  if (parts === null) return undefined;
  const [, letter, digits] = parts as unknown as [string, string, string];
  const only = (found: Iterable<string>) => {
    const one = [...new Set(found)].filter((it) => letterOf(it) === letter);
    return one.length === 1 ? one[0] : undefined;
  };
  const named = only(
    members
      .map(({ entry }) => entry)
      .filter((entry) => ENTRY.exec(entry)?.[1]!.startsWith(digits)),
  );
  if (named !== undefined) return named;
  const holding: string[] = [];
  for (const { entry, record } of members)
    if (record !== undefined && (await sha256(record)).startsWith(digits))
      holding.push(entry);
  return only(holding);
}

/** Each entry's handle: its view's letter and the shortest start of its fragment, at least 8, that no other entry's has. */
export function handlesOf(entries: Iterable<string>): Map<string, string> {
  const named = [...new Set(entries)]
    .map((entry) => [entry, ENTRY.exec(entry)?.[1]] as const)
    .filter((it): it is readonly [string, string] => it[1] !== undefined)
    .sort(([, a], [, b]) => a.localeCompare(b));
  const shared = (a = "", b = "") => {
    let at = 0;
    while (at < a.length && a[at] === b[at]) at += 1;
    return at;
  };
  return new Map(
    named.map(([entry, digits], at) => [
      entry,
      `${letterOf(entry)}${digits.slice(
        0,
        Math.max(
          SHORTEST,
          shared(digits, named[at - 1]?.[1]) + 1,
          shared(digits, named[at + 1]?.[1]) + 1,
        ),
      )}`,
    ]),
  );
}

/** One view's part of a page: its question, how many rows it has, where this part starts, how many it shows, and them. */
export interface CompactView {
  readonly question: string;
  readonly total: number;
  readonly offset: number;
  readonly shown: number;
  readonly text: string;
}

/** A page of the compact read; `next`, when the read goes on, is the input that asks for the next page. */
export interface CompactAnswer {
  readonly format: "compact";
  readonly about: string;
  readonly sources: string;
  readonly leftOut?: string;
  readonly views: readonly CompactView[];
  readonly next?: Readonly<Record<string, unknown>>;
}

/** What the compact read is asked: its questions in order, where a page starts and the entries it is cut to. */
export interface CompactInput {
  readonly questions: readonly string[];
  /** The views it leaves out, each beside the view that holds every one of its entries. */
  readonly leftOut?: Readonly<Record<string, string>>;
  readonly offset?: number;
  readonly entries?: readonly string[];
  /** The input a page's `next` repeats, beside its offset. */
  readonly again: Readonly<Record<string, unknown>>;
}

/** The entries `wanted` names, each by its IRI or its handle among `members`. @throws Refusal for one that names none. */
export async function entriesNamed(
  wanted: readonly string[],
  members: readonly Row[],
): Promise<Set<string>> {
  const pairs = members.flatMap(({ entry, record }) =>
    entry === undefined
      ? []
      : [{ entry, ...(record === undefined ? {} : { record }) }],
  );
  const found = new Set<string>();
  for (const each of wanted) {
    const entry = HANDLE.test(each) ? await entryOfHandle(each, pairs) : each;
    if (entry === undefined)
      throw new Refusal(`no entry of the pod has the handle ${each}`);
    found.add(entry);
  }
  return found;
}

/** The questions `ask` offers: the person's own records, what their reports and notes say, who they are, where an entry came from and what needs review. Never free SPARQL. */
export const QUESTIONS = [
  "pod/My active allergies",
  "pod/My active conditions",
  "pod/My condition history",
  "pod/My active medications",
  HISTORY_QUESTION,
  "pod/My lab results",
  "pod/My immunizations",
  "pod/My procedures",
  VARIANTS_QUESTION,
  "pod/My reports, notes and documents",
  "pod/The person this pod is about",
  "entry/Where it came from",
  "entry/What needs review",
];
/** The views the compact read leaves out, each beside the view that holds every one of its entries with its status. */
export const LEFT_OUT_OF_THE_COMPACT_READ: Readonly<Record<string, string>> = {
  "pod/My active conditions": "pod/My condition history",
  "pod/My active medications": HISTORY_QUESTION,
};
/** What the compact read holds, in order: the person's own records and who they are, then what needs review. */
export const COMPACT_QUESTIONS: readonly string[] = QUESTIONS.filter(
  (question) =>
    (question.startsWith("pod/") &&
      !Object.hasOwn(LEFT_OUT_OF_THE_COMPACT_READ, question)) ||
    question === "entry/What needs review",
);
/** How many rows `ask` gives unless asked for more: a pod's lab results run to thousands of tokens. */
export const DEFAULT_ROWS = 50;
export const MAXIMUM_ROWS = 500;

/** A finding as `find_changes` gives it: compact, with the entry of its medication kept so it can be cited. */
export type CitedFinding = CompactFinding & {
  medication: CompactFinding["medication"] & { entry: string };
};

/** `finding` as `find_changes` gives it. */
export function citedFinding(finding: Finding): CitedFinding {
  const small = compact(finding);
  return {
    ...small,
    medication: { ...small.medication, entry: finding.medication.entry },
  };
}

/** What the tools read: the pods there are, a question's rows, and a change tool's answer. */
export interface PodReads {
  pods(input?: object): Promise<{ pods: readonly { name: string }[] }>;
  /** A question's rows: all of them, or `limit` from `offset`, beside how many there are and, when not 0, the offset. */
  ask(input: {
    pod: string;
    question: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    question: string;
    total: number;
    offset?: number;
    rows: readonly Row[];
  }>;
  /** A page of the compact read of a pod; absent when the host does not make it (it is made where the pod is read). */
  compact?(input: CompactInput & { pod: string }): Promise<CompactAnswer>;
  tool(input: {
    pod: string;
    tool: string;
    input?: object;
  }): Promise<{ value: unknown; found?: readonly Finding[] }>;
  /** What the reference tables and the pod's verdicts against them answer for the pod; absent, or none, when the tables are off. */
  tables?(input: { pod: string }): Promise<TableLookups | undefined>;
}

/** What `reference_table_checks` asks of the reference tables, and of the pod against them. */
export interface TableLookups {
  /** The series the app holds, each with its kind and current version. */
  held(): Promise<
    readonly {
      readonly kind?: string;
      readonly current: { readonly iri: string };
    }[]
  >;
  about(codes: readonly string[]): Promise<ReadonlyMap<string, About>>;
  variantClassification(variant: VariantAsked): Promise<WhatClinVarSays>;
  /** `Pod.agreement()`'s rows. */
  agreement(): Promise<readonly Row[]>;
}

const CLINVAR_KIND =
  "https://ns.cascadeprotocol.org/cascade#VariantClassifications";
const INGREDIENTS_KIND =
  "https://ns.cascadeprotocol.org/cascade#ProductIngredients";

/**
 * One check's answer: `{ held: false }` when the app holds no series of the kind it reads, so nothing was checked and
 * nothing was read for it; else the current `versions` of the series of that kind it holds, the check's `rows`, and
 * `notChecked`, the entries it could not check and why. An entry neither in `rows` nor in `notChecked` was checked and
 * nothing found.
 */
export type Checked<T, N> =
  | { readonly held: false }
  | {
      readonly held: true;
      readonly versions: readonly string[];
      readonly rows: readonly T[];
      readonly notChecked: readonly N[];
    };

export const TABLES_OFF =
  "The reference tables are off, so nothing is checked against them: cascade-mcp reads them only when started with --check-tables.";

/** `reference_table_checks`' answer: with the tables, each check as `Checked`; without them, that they are off. */
async function tableChecks(
  reads: PodReads,
  { pod }: ToolInput,
): Promise<
  | { tables: "off"; said: string }
  | {
      tables: "on";
      reportsDifferingFromClinVar: Checked<
        ReportDifferingFromClinVar,
        VariantNotChecked
      >;
      medicationsSharingAnIngredient: Checked<
        MedicationsSharingAnIngredient,
        MedicationNotChecked
      >;
    }
> {
  const lookups = await reads.tables?.({ pod: pod as string });
  if (lookups === undefined) return { tables: "off", said: TABLES_OFF };
  const held = await lookups.held();
  const versionsOf = (kind: string) =>
    held
      .filter((series) => series.kind === kind)
      .map(({ current }) => current.iri);
  const rowsOf = async (question: string) =>
    (await reads.ask({ pod: pod as string, question })).rows;
  const clinvar = versionsOf(CLINVAR_KIND);
  const ingredientSeries = versionsOf(INGREDIENTS_KIND);
  const [variantCheck, ingredientCheck] = await Promise.all([
    clinvar.length === 0
      ? ({ held: false } as const)
      : (async () => {
          const [variants, reports] = await Promise.all(
            [VARIANTS_QUESTION, REPORTS_QUESTION].map(rowsOf),
          );
          const asked = variantsAsked(variants!);
          const [says, verdicts] = await Promise.all([
            Promise.all(
              [...asked].map(
                async ([variant, each]) =>
                  [variant, await lookups.variantClassification(each)] as const,
              ),
            ).then((pairs) => new Map(pairs)),
            asked.size === 0 || reports!.length === 0
              ? []
              : lookups.agreement(),
          ]);
          const rows = { variants: variants!, reports: reports! };
          return {
            held: true as const,
            versions: clinvar,
            rows: reportsDifferingFromClinVar(rows, { says, verdicts }),
            notChecked: variantsNotChecked(rows, says),
          };
        })(),
    ingredientSeries.length === 0
      ? ({ held: false } as const)
      : (async () => {
          const history = await rowsOf(HISTORY_QUESTION);
          const about = await lookups.about([
            ...new Set(history.flatMap(({ code }) => code ?? [])),
          ]);
          const ingredients = [
            ...new Set(
              [...about.values()].flatMap(
                (each) => each.ingredients?.codes ?? [],
              ),
            ),
          ].filter((code) => !about.has(code));
          const named = new Map([
            ...about,
            ...(await lookups.about(ingredients)),
          ]);
          return {
            held: true as const,
            versions: ingredientSeries,
            rows: medicationsSharingAnIngredient(history, named),
            notChecked: medicationsNotChecked(history, named),
          };
        })(),
  ]);
  return {
    tables: "on",
    reportsDifferingFromClinVar: variantCheck,
    medicationsSharingAnIngredient: ingredientCheck,
  };
}

/** What a door gives the tools: `address.trend(pod, { test, medication })`, the page that draws a finding's results, where it has one. */
export interface Door {
  readonly address?: {
    readonly trend?: (
      pod: string,
      trend: { test: string; medication?: string },
    ) => string;
  };
}

/** A tool's input, as its door checked it against the tool's schema: `pod` beside it for a tool with `ofPod`. */
export type ToolInput = Readonly<Record<string, unknown>>;

/**
 * A tool: `tier` the person's consent (every one here is `free`, a read); `ofPod` when it takes the pod's name in
 * `input.pod`, which `inputSchema` leaves out (`withPod` adds it); `findings`, on `find_changes`, its answer with the
 * findings and their rows beside it.
 */
export interface PodTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: InputSchema;
  readonly tier: "free";
  readonly ofPod?: true;
  /** @throws Refusal when the input is bad, or names a pod, a medication or a test there is not. */
  run(reads: PodReads, input: ToolInput, door?: Door): Promise<unknown>;
  findings?(
    reads: PodReads,
    input: ToolInput,
    door?: Door,
  ): Promise<{ value: unknown[]; found: readonly Finding[] }>;
}

/** `schema` with the pod's name beside its own properties: a tool of one pod as MCP and a chat take its input. */
export function withPod(schema: InputSchema): InputSchema {
  const { properties = {}, required = [] } = schema;
  return {
    ...schema,
    properties: {
      pod: {
        type: "string",
        description: "The pod's name, one of those list_pods gives.",
      },
      ...properties,
    },
    required: ["pod", ...required],
  };
}

/** The schema a tool's whole input is checked against. */
export const schemaOf = (tool: PodTool): InputSchema =>
  tool.ofPod ? withPod(tool.inputSchema) : tool.inputSchema;

/** The test and medication codes of the trend a finding is about, the medication's name where it has no code. */
export function trendOf({
  test,
  medication,
}: {
  readonly test: { readonly code: string; readonly notation?: string };
  readonly medication: { readonly name: string; readonly notation?: string };
}): { test: string; medication?: string } {
  const drug = medication.notation ?? medication.name;
  return {
    test: test.notation ?? test.code,
    ...(drug === "" ? {} : { medication: drug }),
  };
}

/** The change tools, as a model is told of them. */
export const CHANGE_TOOLS = changeTools({ ask: async () => [] }).map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
);

/** Why a host refuses a change tool it does not run, if it is none. */
export function unknownChangeTool(called: string): void {
  const names = CHANGE_TOOLS.map(({ name }) => name);
  if (!names.includes(called))
    throw new Refusal(`no tool ${called}; the tools are ${names.join(", ")}`);
}

/** A tool that checks its whole input against its schema before it runs. */
function checked(tool: PodTool): PodTool {
  const check = (input: ToolInput) => checkInput(schemaOf(tool), input);
  return {
    ...tool,
    run(reads, input, door) {
      check(input);
      return tool.run(reads, input, door);
    },
    ...(tool.findings && {
      findings(reads, input, door) {
        check(input);
        return tool.findings!(reads, input, door);
      },
    }),
  };
}

/** `find_changes` as `run` gives it, with `found` beside `value`; with `address.trend`, each finding carries `view`. */
async function findings(
  reads: PodReads,
  { pod, ...input }: ToolInput,
  door?: Door,
): Promise<{ value: unknown[]; found: readonly Finding[] }> {
  const { value, found = [] } = await reads.tool({
    pod: pod as string,
    tool: "find_changes",
    input,
  });
  const trend = door?.address?.trend;
  return {
    found,
    value:
      trend === undefined
        ? (value as CitedFinding[])
        : (value as CitedFinding[]).map((finding) => ({
            ...finding,
            view: trend(pod as string, trendOf(finding)),
          })),
  };
}

/**
 * Every tool, each `{ name, description, inputSchema, tier, ofPod, run(reads, input, door) }`. `run` calls only
 * `reads`; with `door.address.trend`, each finding of `find_changes` carries `view`, the address of the page that
 * draws its results.
 */
export const TOOLS: readonly PodTool[] = (
  [
    {
      name: "list_pods",
      description: "The names of the pods there are.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      tier: "free",
      run: async (reads) => (await reads.pods({})).pods.map(({ name }) => name),
    },
    ...CHANGE_TOOLS.map((tool): PodTool =>
      tool.name === "find_changes"
        ? {
            ...tool,
            tier: "free",
            ofPod: true,
            findings,
            run: async (reads, input, door) =>
              (await findings(reads, input, door)).value,
          }
        : {
            ...tool,
            tier: "free",
            ofPod: true,
            run: async (reads, { pod, ...input }) =>
              (
                await reads.tool({
                  pod: pod as string,
                  tool: tool.name,
                  input,
                })
              ).value,
          },
    ),
    {
      name: "ask",
      description: `A pod's records by the name of a question, as rows, each naming its entry and the records, documents and hospitals it came from: its allergies with their reactions and severity, conditions (active, or all with each ruled out or resolved one and when it ended), medications (active, or all with when each started and stopped) with each source's own status, lab results with their flags and reference ranges, immunizations, procedures, the text a source wrote for a lab result, procedure or medication, genetic variants, the person it is about with each source's date of birth, gender and death, where an entry came from, or which entries need review and why. With format compact and no question, the whole pod in one read, a page of at most ${PAGE_CHARACTERS} characters at a time: ${COMPACT_QUESTIONS.join(", ")}, each view's rows tab-separated with its count, each entry by a short handle that can be cited as its entry, each source by a short name its legend explains. It leaves out ${Object.keys(LEFT_OUT_OF_THE_COMPACT_READ).join(" and ")}, whose entries are all in the history beside them, and when each record arrived; ${PROVENANCE_QUESTION} with entries gives an entry's records and documents. A record the pod leaves out of every view (entered in error at its source, an allergy its source refutes, a record about no one known to be the person, or one a judgment sets aside) is in no question's answer.`,
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The question's name; with format compact, left out for every view at once.",
            enum: QUESTIONS,
          },
          format: {
            type: "string",
            description:
              "rows (the default): the question's rows as JSON; compact: its views' rows as tab-separated text, a page at a time.",
            enum: ["rows", "compact"],
          },
          limit: {
            type: "integer",
            description: `For rows, at most this many; ${DEFAULT_ROWS} if left out. The answer says how many there are.`,
            minimum: 1,
            maximum: MAXIMUM_ROWS,
          },
          offset: {
            type: "integer",
            description:
              "Where the answer starts: for rows, the row; for compact, the row over every view in order, as the last page's next gives it.",
            minimum: 0,
          },
          entries: {
            type: "array",
            description:
              "Only these entries' rows: each an entry's IRI or its handle.",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
      tier: "free",
      ofPod: true,
      run: async (reads, input) => {
        const { pod, question, limit, offset, entries } = input as {
          pod: string;
          question?: string;
          limit?: number;
          offset?: number;
          entries?: string[];
        };
        if (input.format === "compact") {
          if (limit !== undefined)
            throw new Refusal(
              "limit is for rows; the compact read comes a page at a time, from offset",
            );
          if (reads.compact === undefined)
            throw new Refusal(
              "this host does not offer the compact read; ask a question for its rows",
            );
          return reads.compact({
            pod,
            questions: question === undefined ? COMPACT_QUESTIONS : [question],
            ...(question === undefined
              ? { leftOut: LEFT_OUT_OF_THE_COMPACT_READ }
              : {}),
            ...(offset === undefined ? {} : { offset }),
            ...(entries === undefined ? {} : { entries }),
            again: {
              pod,
              format: "compact",
              ...(question === undefined ? {} : { question }),
              ...(entries === undefined ? {} : { entries }),
            },
          });
        }
        if (question === undefined)
          throw new Refusal(
            "rows answer one question; the compact read (format compact) reads every view",
          );
        const page = { limit: limit ?? DEFAULT_ROWS, offset: offset ?? 0 };
        if (entries === undefined)
          return reads.ask({
            pod,
            question,
            limit: page.limit,
            ...(offset === undefined ? {} : { offset }),
          });
        const [all, provenance] = await Promise.all(
          [question, PROVENANCE_QUESTION].map((asked) =>
            reads.ask({ pod, question: asked }),
          ),
        );
        const wanted = await entriesNamed(entries, provenance!.rows);
        const rows = all!.rows.filter(
          ({ entry }) => entry !== undefined && wanted.has(entry),
        );
        return {
          question,
          total: rows.length,
          ...(page.offset === 0 ? {} : { offset: page.offset }),
          rows: rows.slice(page.offset, page.offset + page.limit),
        };
      },
    },
    {
      name: "reference_table_checks",
      description:
        "What the pod's records and the reference tables say together, as rows naming their entries and the table row each cites: each variant report that differs from ClinVar's classification today, and each pair of active medications in two entries whose codes share an ingredient. Each check says whether a series it reads (ClinVar, product ingredients) is held and which versions; held false means nothing was checked. With held true, notChecked lists the entries it could not check and why (a variant ClinVar has no row for or whose gene it does not cover, a medication with no code or none an ingredients row maps); an entry in neither rows nor notChecked was checked and nothing found. Without the tables (cascade-mcp started without --check-tables) it says they are off and gives no rows.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      tier: "free",
      ofPod: true,
      run: tableChecks,
    },
  ] satisfies PodTool[]
).map(checked);
