// The tools over a pod that the MCP server (`mcp-server.mjs`) and the app's chat (`chat.mjs`) share: the analytics of
// `cascade-runtime` (`changeTools`), `ask`, and `list_pods`, with the pod each is about named in its input.
import console from "node:console";
import { changeTools, Refusal } from "cascade-runtime";

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

/** The trend a finding is about, as `viewOf` takes it: the bare test and medication codes, the medication's name where it has no code. */
function trendOf({ test, medication }) {
  const drug = medication.notation ?? medication.name;
  return {
    test: test.notation ?? test.code,
    ...(drug === "" ? {} : { medication: drug }),
  };
}

/**
 * A tool over the pods: its schema as a client sees it, and what it does with a pod, the input beside `pod` and the
 * pod's name. With `viewOf(pod, trend)`, each finding of `find_changes` carries `view`, the address it gives.
 */
export function toolsOver(viewOf) {
  const sample = changeTools({ ask: async () => [] });
  const analytics = sample.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
    run: async (pod, input, podName) => {
      const result = await changeTools(pod)
        .find((each) => each.name === name)
        .execute(input);
      return name === "find_changes" && viewOf !== undefined
        ? result.map((finding) => ({
            ...finding,
            view: viewOf(podName, trendOf(finding)),
          }))
        : result;
    },
  }));
  return [
    ...analytics,
    {
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
      async run(pod, { question, limit }) {
        const rows = await pod.ask(question);
        return {
          question,
          total: rows.length,
          rows: rows.slice(0, limit ?? DEFAULT_ROWS),
        };
      },
    },
  ];
}

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
 * The tools over `pods`: `names()` gives the names of the pods there are, `open(name)` opens one. A pod is opened when
 * first asked about and kept until `close()`, unless `options.keep` is false, which leaves keeping to `open`.
 * `options.viewOf(pod, { test, medication })` gives the address of the page that draws a finding's results.
 */
export function podTools(pods, { viewOf, keep = true } = {}) {
  const opened = new Map();

  /** The pod named, opened; a Refusal naming the pods there are when there is none. */
  async function podNamed(name) {
    const names = await pods.names();
    if (!names.includes(name))
      throw new Refusal(
        names.length === 0
          ? `there is no pod ${name}, and no pod at all`
          : `there is no pod ${name}; the pods are ${names.join(", ")}`,
      );
    if (!keep) return pods.open(name);
    if (!opened.has(name)) {
      const opening = pods.open(name);
      opened.set(name, opening);
      opening.catch(() => opened.delete(name));
    }
    return opened.get(name);
  }

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

  async function close() {
    const closing = [...opened.values()];
    opened.clear();
    await Promise.allSettled(closing.map(async (each) => (await each).close()));
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
      run: () => pods.names(),
    },
    tools: toolsOver(viewOf),
    names: () => pods.names(),
    podNamed,
    answer,
    close,
  };
}
