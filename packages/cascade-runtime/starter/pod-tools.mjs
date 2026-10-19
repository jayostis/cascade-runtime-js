// The tools over the pods that the MCP server (`mcp-server.mjs`) and the app's chat (`chat.mjs`) share: the analytics
// of `cascade-runtime` (`changeTools`), `ask`, `worth_a_look` and `list_pods`, with the pod each is about named in its
// input. What a tool does is `podApi`'s; this file holds what a tool client sees.
import console from "node:console";
import { changeTools, Refusal } from "cascade-runtime";
import { trendOf } from "./pod-api.mjs";

/** The questions `ask` offers: the person's own records, who they are and where an entry came from. Never free SPARQL. */
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
];
/** How many rows `ask` gives unless asked for more: a pod's lab results run to thousands of tokens. */
export const DEFAULT_ROWS = 50;
export const MAXIMUM_ROWS = 500;

const WORTH_A_LOOK = {
  name: "worth_a_look",
  description:
    "What a pod's page lists under Worth a look, in its order: each line's sentence, the ID of the entry it is about and its tag. It states what is flagged (an entry that needs review, a report that differs from ClinVar today, medications that share an ingredient), never why; there are none when nothing is.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const ASK = {
  name: "ask",
  description:
    "A pod's records by the name of a question, as rows: its allergies, conditions, medications (active, or all with when each started and stopped), lab results, immunizations, procedures, genetic variants, the person it is about, or where an entry came from.",
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
};

/** The tool as a client sees it: every tool of a pod takes the pod's name beside its own properties. */
export function withPod(tool) {
  const { properties = {}, required = [] } = tool.inputSchema;
  return {
    ...tool.inputSchema,
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

/**
 * The tools over the pods `api` (`podApi`'s) reaches. Each tool's `run(input)` takes the pod's name in `input.pod`.
 * `find_changes` also has `findings(input)`, which gives `found` (the findings with their rows) beside `value`; with
 * `viewOf(pod, { test, medication })`, each finding of its `value` carries `view`, the address of the page that draws
 * its results.
 */
export function podTools(api, { viewOf } = {}) {
  const names = async () => (await api.pods({})).pods.map(({ name }) => name);

  async function findings({ pod, ...input }) {
    const { value, found } = await api.tool({
      pod,
      tool: "find_changes",
      input,
    });
    return {
      found,
      value:
        viewOf === undefined
          ? value
          : value.map((finding) => ({
              ...finding,
              view: viewOf(pod, trendOf(finding)),
            })),
    };
  }

  const tools = [...changeTools({ ask: async () => [] }), WORTH_A_LOOK].map(
    ({ name, description, inputSchema }) =>
      name === "find_changes"
        ? {
            name,
            description,
            inputSchema,
            findings,
            run: async (input) => (await findings(input)).value,
          }
        : {
            name,
            description,
            inputSchema,
            run: async ({ pod, ...input }) =>
              (await api.tool({ pod, tool: name, input })).value,
          },
  );

  /**
   * What a tool gives, as text: its result as JSON, with `value` its result; or, for input the rules refuse, `isError`
   * and the reason.
   */
  async function answer(run) {
    try {
      const value = await run();
      return { text: JSON.stringify(value), value };
    } catch (error) {
      if (error instanceof Refusal)
        return { text: error.message, isError: true };
      console.error(error);
      return { text: "the server failed; its log says why", isError: true };
    }
  }

  return {
    list: {
      name: "list_pods",
      description: "The names of the pods there are.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: names,
    },
    tools: [
      ...tools,
      {
        ...ASK,
        run: ({ pod, question, limit }) =>
          api.ask({ pod, question, limit: limit ?? DEFAULT_ROWS }),
      },
    ],
    names,
    answer,
  };
}
