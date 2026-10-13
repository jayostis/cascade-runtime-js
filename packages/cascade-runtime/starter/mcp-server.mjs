// The MCP server over the app's pods: what `mcp.mjs` serves on stdio. A client such as Claude Desktop or VS Code lists
// the pods, asks the curated questions and runs the analytics of `cascade-runtime` (`changeTools`).
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
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

export const WARNING =
  "A hosted client (Claude Desktop, VS Code with a hosted model, any chat service) sends what these tools return to its provider. The example and story pods are made up; a person's own pod is theirs to decide about before it is asked here.";

const INSTRUCTIONS = `${WARNING}

Every tool but list_pods takes the pod's name: list_pods gives the names. find_changes states what changed in a person's lab results after a medication started or stopped, with the numbers; never why. Use its numbers as they are, and say when it finds nothing.`;

const { version } = JSON.parse(
  await readFile(new URL("package.json", import.meta.url), "utf8"),
);

/** A tool over the pods: its schema as a client sees it, and what it does with a pod and the input beside `pod`. */
function toolsOver() {
  const sample = changeTools({ ask: async () => [] });
  const analytics = sample.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
    run: (pod, input) =>
      changeTools(pod)
        .find((each) => each.name === name)
        .execute(input),
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
function withPod(tool) {
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

const text = (value, isError = false) => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError } : {}),
});

/**
 * The server over `pods`: `names()` gives the names of the pods there are, `open(name)` opens one. A pod is opened
 * when first asked about and kept until `close()`. `build()` gives a server for one connection, all sharing the pods.
 */
export function podServer(pods) {
  const tools = toolsOver();
  const opened = new Map();

  async function podNamed(name) {
    const names = await pods.names();
    if (!names.includes(name))
      throw new Refusal(
        names.length === 0
          ? `there is no pod ${name}, and no pod at all`
          : `there is no pod ${name}; the pods are ${names.join(", ")}`,
      );
    if (!opened.has(name)) {
      const opening = pods.open(name);
      opened.set(name, opening);
      opening.catch(() => opened.delete(name));
    }
    return opened.get(name);
  }

  /** What a tool gives: its result as JSON, or, for input the rules refuse, a tool error saying why. */
  async function answer(run) {
    try {
      return text(JSON.stringify(await run()));
    } catch (error) {
      if (error instanceof Refusal) return text(error.message, true);
      throw error;
    }
  }

  function build() {
    const server = new McpServer(
      {
        name: "cascade-pod",
        version,
        description: `Questions and changes over the pods of a Cascade app. ${WARNING}`,
      },
      { instructions: INSTRUCTIONS },
    );
    server.registerTool(
      "list_pods",
      {
        description: "The names of the pods there are.",
        inputSchema: fromJsonSchema({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
      },
      () => answer(() => pods.names()),
    );
    for (const tool of tools) {
      const schema = withPod(tool);
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: fromJsonSchema(schema) },
        (input) =>
          answer(async () => {
            const { pod, ...rest } = input;
            return tool.run(await podNamed(pod), rest);
          }),
      );
    }
    return server;
  }

  async function close() {
    const closing = [...opened.values()];
    opened.clear();
    await Promise.all(closing.map(async (each) => (await each).close()));
  }

  return { build, close };
}
