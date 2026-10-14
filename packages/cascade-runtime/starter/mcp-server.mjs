// The MCP server over the app's pods: what `mcp.mjs` serves on stdio. A client such as Claude Desktop or VS Code lists
// the pods, asks the curated questions and runs the analytics of `cascade-runtime` (`changeTools`). The tools are
// those of `pod-tools.mjs`, which the app's chat uses too.
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { podTools, withPod } from "./pod-tools.mjs";

export { DEFAULT_ROWS, MAXIMUM_ROWS, QUESTIONS } from "./pod-tools.mjs";

export const WARNING =
  "A hosted client (Claude Desktop, VS Code with a hosted model, any chat service) sends what these tools return to its provider. The example and story pods are made up; a person's own pod is theirs to decide about before it is asked here.";

const INSTRUCTIONS = `${WARNING}

Every tool but list_pods takes the pod's name: list_pods gives the names. find_changes states what changed in a person's lab results after a medication started or stopped, with the numbers; never why. Use its numbers as they are, and say when it finds nothing. Each finding's view is the address of a page that draws its results as a chart; it opens while the app is running (npm start).`;

const { version } = JSON.parse(
  await readFile(new URL("package.json", import.meta.url), "utf8"),
);

/** A tool's answer as MCP sends it. */
const content = ({ text, isError }) => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError } : {}),
});

/**
 * The server over `pods`: `names()` gives the names of the pods there are, `open(name)` opens one. A pod is opened
 * when first asked about and kept until `close()`. `build()` gives a server for one connection, all sharing the pods.
 * `options.viewOf(pod, { test, medication })` gives the address of the page that draws a finding's results.
 */
export function podServer(pods, { viewOf } = {}) {
  const shared = podTools(pods, { viewOf });

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
        description: shared.list.description,
        inputSchema: fromJsonSchema(shared.list.inputSchema),
      },
      async () => content(await shared.answer(shared.list.run)),
    );
    for (const tool of shared.tools) {
      const schema = withPod(tool);
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: fromJsonSchema(schema) },
        async (input) =>
          content(
            await shared.answer(async () => {
              const { pod, ...rest } = input;
              return tool.run(await shared.podNamed(pod), rest, pod);
            }),
          ),
      );
    }
    return server;
  }

  return { build, close: shared.close };
}
