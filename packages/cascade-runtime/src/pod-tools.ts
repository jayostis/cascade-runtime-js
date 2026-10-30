// `cascade-runtime/tools`: the tools a model reads a folder of pods by, their input schemas and their answers, which
// an MCP server, a chat or a page's WebMCP offers. Every tool reads; none writes, moves an app or opens an encrypted pod.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Refusal, Unopened } from "@cascade-runtime/runtime";
import {
  changeTools,
  compact,
  type CompactFinding,
  findChanges,
  type Finding,
} from "./changes.js";
import { checkInput, type InputSchema } from "./check.js";
import { openPod } from "./index.js";
import type { Pod, Row } from "./pod.js";

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

/** A tool: `ofPod` when it takes the pod's name in `input.pod`, which `inputSchema` leaves out (`withPod` adds it). */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: InputSchema;
  readonly ofPod?: true;
  /** @throws Refusal when the input is bad, or names a pod, a medication or a test there is not. */
  run(reads: PodReads, input: ToolInput, door?: Door): Promise<unknown>;
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
export const schemaOf = (tool: Tool): InputSchema =>
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
const CHANGE_TOOLS = changeTools({ ask: async () => [] }).map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
);
const CHANGES = CHANGE_TOOLS.map(({ name }) => name);

/** A tool that checks its whole input against its schema before it runs. */
function checked(tool: Tool): Tool {
  return {
    ...tool,
    run(reads, input, door) {
      checkInput(schemaOf(tool), input);
      return tool.run(reads, input, door);
    },
  };
}

/**
 * Every tool, each `{ name, description, inputSchema, ofPod, run(reads, input, door) }`. `run` calls only `reads`; with
 * `door.address.trend`, each finding of `find_changes` carries `view`, the address of the page that draws its results.
 */
export const TOOLS: readonly Tool[] = (
  [
    {
      name: "list_pods",
      description: "The names of the pods there are.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async (reads) => (await reads.pods({})).pods.map(({ name }) => name),
    },
    ...CHANGE_TOOLS.map((tool): Tool => ({
      ...tool,
      ofPod: true,
      async run(reads, { pod, ...input }, door) {
        const { value } = await reads.tool({
          pod: pod as string,
          tool: tool.name,
          input,
        });
        const trend = door?.address?.trend;
        return tool.name !== "find_changes" || trend === undefined
          ? value
          : (value as CitedFinding[]).map((finding) => ({
              ...finding,
              view: trend(pod as string, trendOf(finding)),
            }));
      },
    })),
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
      ofPod: true,
      run: (reads, { pod, question, limit }) =>
        reads.ask({
          pod: pod as string,
          question: question as string,
          limit: (limit as number | undefined) ?? DEFAULT_ROWS,
        }),
    },
  ] satisfies Tool[]
).map(checked);

/** Where the pods are: their names, and each opened by name. */
export interface PodsHost {
  names(): Promise<string[]>;
  open(name: string): Promise<Pod>;
}

/** The pods of a folder: each folder in it that holds something and is not hidden, as `.answers/` and `.tables/` are. */
export function podsIn(folder: string): PodsHost {
  return {
    async names() {
      let entries;
      try {
        entries = await readdir(folder, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const names: string[] = [];
      for (const entry of entries)
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          (await readdir(join(folder, entry.name))).length > 0
        )
          names.push(entry.name);
      return names.sort();
    },
    open: (name) => openPod(join(folder, name)),
  };
}

/** The reads over the pods `host` gives, each pod opened once; `close()` closes them. An encrypted pod is refused. */
export function podReads(
  host: PodsHost,
): PodReads & { close(): Promise<void> } {
  const opened = new Map<string, Promise<Pod>>();

  async function podNamed(name: string | undefined): Promise<Pod> {
    let opening = name === undefined ? undefined : opened.get(name);
    if (opening === undefined) {
      const names = await host.names();
      if (name === undefined || !names.includes(name))
        throw new Refusal(
          names.length === 0
            ? `there is no pod ${name}, and no pod at all`
            : `there is no pod ${name}; the pods are ${names.join(", ")}`,
        );
      opening = host.open(name);
      opening.catch(() => opened.delete(name));
      opened.set(name, opening);
    }
    try {
      return await opening;
    } catch (error) {
      if (error instanceof Unopened)
        throw new Refusal(
          `${name} is encrypted: these tools never open an encrypted pod, as its six words are the person's alone`,
        );
      throw error;
    }
  }

  return {
    async pods() {
      return { pods: (await host.names()).map((name) => ({ name })) };
    },
    async ask({ pod, question, limit }) {
      const rows = await (await podNamed(pod)).ask(question);
      return {
        question,
        total: rows.length,
        rows: limit === undefined ? rows : rows.slice(0, limit),
      };
    },
    async tool({ pod: name, tool: called, input = {} }) {
      if (!CHANGES.includes(called))
        throw new Refusal(
          `no tool ${called}; the tools are ${CHANGES.join(", ")}`,
        );
      const pod = await podNamed(name);
      if (called !== "find_changes")
        return {
          value: await changeTools(pod)
            .find((each) => each.name === called)!
            .execute(input),
        };
      checkInput(
        CHANGE_TOOLS.find((each) => each.name === called)!.inputSchema,
        input,
      );
      const found = await findChanges(pod, input);
      return {
        value: found.map((finding): CitedFinding => ({
          ...compact(finding),
          medication: {
            ...compact(finding).medication,
            entry: finding.medication.entry,
          },
        })),
        found,
      };
    },
    async close() {
      const pods = await Promise.allSettled(opened.values());
      opened.clear();
      await Promise.allSettled(
        pods.flatMap((each) =>
          each.status === "fulfilled" ? [each.value.close()] : [],
        ),
      );
    },
  };
}
