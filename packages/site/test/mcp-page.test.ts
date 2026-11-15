import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import { agentFiles, SEARCH_FILE, type SearchRow } from "../src/agents.js";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { PagesContext } from "../src/hub/context.js";
import { MCP_PAGE, toolAnchor } from "../src/mcp-page.js";
import { mcpSection } from "../src/node/hub/mcp.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const decode = (bytes: Uint8Array | undefined) =>
  new TextDecoder().decode(bytes);

interface Listed {
  readonly name: string;
  readonly description: string;
  readonly tier: "free" | "ask";
}

/** The tools a client that can ask the person lists on `podServer`, through an in-memory client, not from the page's own source. */
async function registered(): Promise<readonly Listed[]> {
  const { Client } = await import("@modelcontextprotocol/client");
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  const { podServer } = await import("cascade-mcp");
  const client = new Client(
    { name: "page-test", version: "1.0.0" },
    { capabilities: { elicitation: {} } },
  );
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    podServer({} as Parameters<typeof podServer>[0]).connect(toServer),
    client.connect(toClient),
  ]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map(({ name, description, annotations }) => ({
    name,
    description: description ?? "",
    tier: annotations?.readOnlyHint === true ? "free" : "ask",
  }));
}

/**
 * The MCP server has a page of its own: how to install and start it, what a hosted client sends to its provider, and one
 * row for each tool it registers, read from the tool definitions in code, not copied.
 */
describe("The MCP page · mcpPage(), mcpSection", () => {
  let tree: ReadonlyMap<string, Uint8Array>;
  let page: string;
  let tools: readonly Listed[];

  before(async () => {
    tools = await registered();
    ({ tree } = await buildTree({
      sections: [mcpSection],
      ctx: { root: ROOT, chrome: PLAIN } as PagesContext,
      front: (rows) => hubFiles([], rows, PLAIN),
      finishers: [agentFiles],
    }));
    page = decode(tree.get(MCP_PAGE));
  });

  describe("given the tools the server registers", () => {
    it("has a row with an anchor for each one", () => {
      const { ids } = readPage(page);
      assert.ok(tools.length >= 9, "the server registers its tools");
      for (const { name } of tools)
        assert.ok(ids.has(toolAnchor(name)), `no row for the tool ${name}`);
    });

    it("marks each tool that proposes a write as needing the person's yes, and no other", () => {
      for (const { name, tier } of tools) {
        const row = rowOf(page, name);
        assert.equal(
          /needs the person&#39;s yes|needs the person's yes/.test(row),
          tier === "ask",
          `${name} is at ${tier}`,
        );
      }
    });

    it("shows each tool's inputs, with the pod's name where it takes one, and which are required", () => {
      const ask = readPage(rowOf(page, "ask")).said;
      assert.match(ask, /pod/);
      assert.match(ask, /required/);
      assert.ok(
        !/pod/.test(
          readPage(rowOf(page, "list_pods")).said.replace(/pods/g, ""),
        ),
      );
    });

    it("has a row for no tool the server does not list", () => {
      const rows = [...readPage(page).ids].filter((id) =>
        id.startsWith("tool-"),
      );
      assert.deepEqual(
        rows.sort(),
        tools.map(({ name }) => toolAnchor(name)).sort(),
      );
    });

    it("shows each tool's description as the server sends it, the tools that propose a write too", () => {
      const said = readPage(page).said.replace(/\s+/g, " ");
      for (const { description } of tools)
        assert.ok(
          said.includes(description.replace(/\s+/g, " ")),
          `the description of a tool is shown whole: ${description.slice(0, 40)}`,
        );
    });
  });

  describe("given the package's README", () => {
    it("renders its install and start, and what a hosted client sends to its provider", () => {
      const { said, code } = readPage(page);
      assert.ok(
        code.some((block) =>
          block.includes("npx --no-install cascade-mcp --pods"),
        ),
      );
      assert.match(
        said,
        /A hosted client sends what the tools return to its provider/,
      );
      assert.ok(
        page.includes(
          "A hosted client sends what the tools return to its provider</h2>",
        ),
        "the warning is a heading",
      );
      assert.match(
        said,
        /A proposal the pod's rules refuse is an answer, not an error/,
      );
      assert.ok(code.some((block) => block.includes("mcpServers")));
    });

    it("shows its list of tools once, as the rows and not as a list", async () => {
      const readme = await readFile(
        join(ROOT, "packages", "mcp", "README.md"),
        "utf8",
      );
      assert.ok(readme.includes("- `list_pods`"), "the README lists its tools");
      assert.ok(!readPage(page).said.includes("- list_pods"));
    });
  });

  describe("`mcpSection`", () => {
    it("writes the page at `mcp/index.html` and links it from the front page", () => {
      assert.equal(MCP_PAGE, "mcp/index.html");
      assert.ok(readPage(decode(tree.get(FRONT_PAGE))).hrefs.includes("mcp/"));
    });

    it("lists each tool in `search.json` as an `mcp-tool` at its anchor, and the page itself", () => {
      const rows = JSON.parse(decode(tree.get(SEARCH_FILE))) as SearchRow[];
      for (const { name } of tools)
        assert.ok(
          rows.some(
            (row) =>
              row.kind === "mcp-tool" &&
              row.title === name &&
              row.path === `${MCP_PAGE}#${toolAnchor(name)}`,
          ),
          `search.json lists ${name}`,
        );
      assert.ok(
        rows.some((row) => row.path === MCP_PAGE && row.kind === "page"),
      );
    });

    it("lists the page in `llms.txt` and `index.json`", () => {
      assert.match(decode(tree.get("llms.txt")), /mcp\/index\.html|mcp\//);
      assert.ok(
        (
          JSON.parse(decode(tree.get("index.json"))) as {
            files: { path: string }[];
          }
        ).files.some(({ path }) => path === MCP_PAGE),
      );
    });
  });
});

/** The markup of the row of a tool. */
function rowOf(page: string, name: string): string {
  const found = page
    .split('<section class="term"')
    .slice(1)
    .map((part) => part.split("</section>")[0] ?? "")
    .find((part) => part.includes(` id="${toolAnchor(name)}"`));
  assert.ok(found !== undefined, `no row for the tool ${name}`);
  return found;
}
