import { type Chrome, markup, shell } from "./html.js";
import { renderMarkdown } from "./markdown.js";
import { STYLESHEET_FILE } from "./site.js";

export const MCP_FOLDER = "mcp/";
export const MCP_PAGE = `${MCP_FOLDER}index.html`;
const SOURCE =
  "https://github.com/jayostis/cascade-runtime-js/tree/main/packages/mcp";

/** The keywords of a tool's input schema that the page shows. */
export interface ToolInput {
  readonly type: string;
  readonly description?: string;
  readonly items?: ToolInput;
  readonly properties?: Readonly<Record<string, ToolInput>>;
  readonly required?: readonly string[];
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
}

/** A tool as the server registers it: what a client lists, and the tier that says whether the person is asked. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly tier: "free" | "ask";
  /** The schema the whole input is checked against, the pod's name included. */
  readonly input: ToolInput;
}

/** The id of a tool's row, which `search.json` and a link land on. */
export const toolAnchor = (name: string): string => `tool-${name}`;

const typeOf = ({
  type,
  items,
  enum: values,
  minimum,
  maximum,
}: ToolInput): string =>
  [
    type === "array" && items !== undefined
      ? `array of ${typeOf(items)}`
      : type,
    values === undefined ? "" : `one of ${values.join(", ")}`,
    minimum === undefined ? "" : `at least ${minimum}`,
    maximum === undefined ? "" : `at most ${maximum}`,
  ]
    .filter((part) => part !== "")
    .join(", ");

function inputs({ properties = {}, required = [] }: ToolInput) {
  const names = Object.keys(properties);
  if (names.length === 0) return markup`<span class="about">None.</span>`;
  return markup`<ul>
${names.map((name) => {
  const property = properties[name] as ToolInput;
  return markup`<li><code>${name}</code> <span class="about">${typeOf(property)}, ${required.includes(name) ? "required" : "optional"}</span>${property.description === undefined ? "" : markup`: ${property.description}`}</li>
`;
})}</ul>`;
}

const row = ({ name, description, tier, input }: McpTool) =>
  markup`<section class="term" id="${toolAnchor(name)}">
<h3><code>${name}</code></h3>
<p class="prose">${description}</p>
<dl class="layout">
<dt>Offered to</dt><dd>${tier === "ask" ? markup`only a client that declares it can show the person a question; it needs the person's yes to each call, and a no, a dismissed question or no answer writes nothing` : "every client; it only reads"}</dd>
<dt>Inputs</dt><dd>${inputs(input)}</dd>
</dl>
</section>
`;

/** The README's list of the tools, one bullet each, which the rows replace. */
function withoutToolList(readme: string): [string, string] {
  const lines = readme.split(/\r?\n/);
  const first = lines.findIndex((line) => /^- `[a-z_]+`/.test(line));
  if (first < 0) return [readme, ""];
  let end = first;
  while (end < lines.length && /^(?:- | {2})/.test(lines[end] ?? "")) end++;
  return [lines.slice(0, first).join("\n"), lines.slice(end).join("\n")];
}

/**
 * The page of the MCP server: the package's README, rendered, with its list of tools replaced by a row for each tool the
 * server registers, from the tool's own definition: its description, whether it needs the person's yes, and its inputs.
 */
export function mcpPage(
  tools: readonly McpTool[],
  readme: string,
  chrome: Chrome,
): string {
  const body = readme.replace(/^# .*\r?\n+/, "");
  const [before, after] = withoutToolList(body);
  return shell({
    chrome,
    title: "cascade-mcp, the MCP server",
    stylesheet: `../${STYLESHEET_FILE}`,
    hubRoot: "../",
    nav: markup`<a href="../index.html">Cascade Protocol reference</a>\n`,
    main: markup`<h1>cascade-mcp, the MCP server</h1>
<p class="about">This page is the package's README with each tool's row read from the server's own tool definitions. The package is
<a href="${SOURCE}">packages/mcp</a>.</p>
<article class="document">
${renderMarkdown(before)}</article>
<h2 class="part" id="tools">The tools</h2>
<p class="prose">Each tool answers in one block of JSON text. Input the rules refuse comes back as an error that says why, and any
other failure as a fixed message with the reason in the server's log.</p>
${tools.map(row)}<article class="document">
${renderMarkdown(after)}</article>
`,
  }).text;
}
