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

/** The questions `ask` offers: the person's own records, who they are, where an entry came from and what needs review. Never free SPARQL. */
export const QUESTIONS = [
  "pod/My active allergies",
  "pod/My active conditions",
  "pod/My active medications",
  "pod/My medication history",
  "pod/My lab results",
  "pod/My immunizations",
  "pod/My procedures",
  "pod/My genetic variants",
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
  ] satisfies PodTool[]
).map(checked);
