// The MCP server over a folder of pods: the tools of `cascade-runtime/tools`, each a read.
import { readFileSync } from "node:fs";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { Refusal } from "cascade-runtime";
import {
  type PodReads,
  schemaOf,
  TOOLS,
  type ToolInput,
} from "cascade-runtime/tools";

export const WARNING =
  "A hosted client (Claude Desktop, VS Code with a hosted model, any chat service) sends what these tools return to its provider. The example and story pods are made up; a person's own pod is theirs to decide about before it is asked here.";

const INSTRUCTIONS = `${WARNING}

Every tool but list_pods takes the pod's name: list_pods gives the names. Every row a tool gives names the entry it is about, so an answer can cite it; entry/Where it came from gives an entry's sources. find_changes states what changed in a person's lab results after a medication started or stopped, with the numbers; never why. Use its numbers as they are, and say when it finds nothing. ask's entry/What needs review lists the entries the pod itself says need review, and why each does.`;

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * A tool's answer as MCP sends it: its result as JSON; or, for input the rules refuse, `isError` and the reason, and
 * for any other error a fixed message, logged to stderr.
 */
async function content(run: () => Promise<unknown>) {
  try {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(await run()) }],
    };
  } catch (error) {
    const refused = error instanceof Refusal;
    if (!refused) console.error(error);
    return {
      content: [
        {
          type: "text" as const,
          text: refused ? error.message : "the server failed; its log says why",
        },
      ],
      isError: true,
    };
  }
}

/** A server for one connection over the pods `reads` reaches. */
export function podServer(reads: PodReads): McpServer {
  const server = new McpServer(
    {
      name: "cascade-mcp",
      version,
      description: `Questions and changes over a folder of Cascade pods, read only. ${WARNING}`,
    },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of TOOLS)
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(schemaOf(tool)),
      },
      (input) => content(() => tool.run(reads, input as ToolInput)),
    );
  return server;
}
