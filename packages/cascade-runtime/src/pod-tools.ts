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

/** The questions `ask` offers: the person's own records, what their reports and notes say, who they are, where an entry came from and what needs review. Never free SPARQL. */
export const QUESTIONS = [
  "pod/My active allergies",
  "pod/My active conditions",
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
  ask(input: {
    pod: string;
    question: string;
    limit?: number;
  }): Promise<{ question: string; total: number; rows: readonly Row[] }>;
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
      description:
        "A pod's records by the name of a question, as rows, each naming its entry: its allergies, conditions, medications (active, or all with when each started and stopped), lab results, immunizations, procedures, genetic variants, the person it is about, where an entry came from, or which entries need review and why.",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question's name.",
            enum: QUESTIONS,
          },
          limit: {
            type: "integer",
            description: `At most this many rows; ${DEFAULT_ROWS} if left out. The answer says how many there are.`,
            minimum: 1,
            maximum: MAXIMUM_ROWS,
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
      tier: "free",
      ofPod: true,
      run: (reads, { pod, question, limit }) =>
        reads.ask({
          pod: pod as string,
          question: question as string,
          limit: (limit as number | undefined) ?? DEFAULT_ROWS,
        }),
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
