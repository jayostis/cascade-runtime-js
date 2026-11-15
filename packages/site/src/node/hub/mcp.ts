import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PagesContext } from "../../hub/context.js";
import { MCP_FOLDER, MCP_PAGE, type McpTool, mcpPage } from "../../mcp-page.js";
import type { Section } from "../../sections.js";

const RUNTIME = ["packages", "cascade-runtime", "dist", "src"];

/**
 * The tools the MCP server registers, read from the package and never listed by hand: `toolsFor` as `podServer` calls it for
 * a client that can ask the person, each with the schema `schemaOf` gives the server. The package must be built, as `tsc -b`
 * leaves it.
 */
export async function registeredTools(root: string): Promise<McpTool[]> {
  const load = async <T>(file: string) =>
    (await import(pathToFileURL(join(root, ...RUNTIME, file)).href)) as T;
  const { toolsFor } =
    await load<typeof import("cascade-runtime/tools/propose")>(
      "propose-tools.js",
    );
  const { schemaOf } =
    await load<typeof import("cascade-runtime/tools")>("pod-tools.js");
  return toolsFor({ canAsk: true }).map((tool) => ({
    name: tool.name,
    description: tool.description,
    tier: tool.tier,
    input: schemaOf(tool),
  }));
}

/** The MCP server's page: its README and a row for each tool it registers. */
export const mcpSection: Section<PagesContext> = {
  path: MCP_PAGE,
  title: "The MCP server",
  want: "agent",
  about:
    "install and start cascade-mcp, what a hosted client sends to its provider, and each tool it offers with its inputs and whether it needs the person's yes.",
  source:
    "packages/mcp/README.md and the tool definitions of cascade-runtime/tools in cascade-runtime-js",
  async build({ root, chrome }) {
    const readme = await readFile(
      join(root, "packages", "mcp", "README.md"),
      "utf8",
    );
    const tools = await registeredTools(root);
    return new Map([
      [MCP_PAGE, new TextEncoder().encode(mcpPage(tools, readme, chrome))],
    ]);
  },
  async rows() {
    return [
      {
        href: MCP_FOLDER,
        label: "Connect Claude Desktop or another MCP client to a pod",
        about:
          "cascade-mcp: install, start, the tools it offers and which need the person's yes",
      },
    ];
  },
};
