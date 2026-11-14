import { repositoryName } from "@cascade-runtime/runtime";
import { type Chrome, type Html, markup, shell as pageShell } from "./html.js";
import { STYLESHEET_FILE } from "./site.js";

export const CRATE_FILE = "ro-crate-metadata.json";

/** The hub's folder of the adapters' explorers: the adapters page, and a folder for each adapter. */
export const ADAPTERS_FOLDER = "adapters/";

/** Everything the adapters page needs of one adapter. */
export interface AdapterView {
  /** The adapter's folder under `adapters/`: its crate's identifier. */
  readonly slug: string;
  readonly title: string;
  readonly repository: string;
  readonly commit: string;
  /** The adapter's folders on GitHub at the commit, ending in a slash. */
  readonly tree: string;
}

const repositoryOf = (repository: string): string =>
  repositoryName({ repository });

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

interface Crate {
  readonly identifier: string;
  readonly name: string;
}

/** The adapter's crate: the identifier its explorer takes its folder from, and its name. */
export function crateOf(text: string): Crate {
  const root = (
    (JSON.parse(text) as { "@graph"?: Record<string, unknown>[] })["@graph"] ??
    []
  ).find((node) => node["@id"] === "./");
  const identifier = root?.["identifier"];
  const name = root?.["name"];
  if (typeof identifier !== "string" || !SLUG.test(identifier))
    throw new Error(
      `${CRATE_FILE} names no identifier a folder can take its name from`,
    );
  return {
    identifier,
    name: typeof name === "string" ? name : identifier,
  };
}

const encoder = new TextEncoder();

const short = (commit: string): string => commit.slice(0, 7);

/** One adapter, or why there is none, as the adapters page lists it. */
export type Listed =
  | { readonly view: AdapterView }
  | { readonly repository: string; readonly unavailable: string };

const BRIDGE_SPECIFICATION = "https://github.com/jayostis/cascade-bridge-spec";

/**
 * The page that opens the adapters: the builder's problem, why adapters are built this way, one fact followed through
 * three forms (when `fact` is given), a card for each adapter, linked to its explorer, with the commit it was built from,
 * and the Bridge specification's pages on adapters.
 */
export function adaptersIndex(
  listed: readonly Listed[],
  chrome: Chrome,
  fact?: Html,
): Uint8Array {
  const up = "../";
  return encoder.encode(
    pageShell({
      chrome,
      title: markup`Adapters · Cascade adapters`,
      stylesheet: `${up}${STYLESHEET_FILE}`,
      hubRoot: up,
      nav: markup`<a href="../index.html">Cascade Protocol reference</a>`,
      main: markup`<h1>One more source format, without one more engine</h1>
<p class="lede">A hospital's export, a vendor's file: each source format is one adapter to write, not another engine.
An adapter describes a source format. It is data, not code. cascade-bridge-rs is the one Bridge today.</p>
<h2 class="part" id="reasons">Why adapters are built this way</h2>
<ol class="reasons">
<li><strong>No new engine for a new format.</strong> The Bridge reads an adapter, so one more format means one more adapter and no change to the Bridge.</li>
<li><strong>Adapters are tested the same way.</strong> The same checks run over every adapter, so a new one is held to what the others are.</li>
<li><strong>Every source path is meant to be accounted for.</strong> For each path of its format an adapter says what the path becomes; what it does not carry is reported with its reason.</li>
<li><strong>There will be many.</strong> Hospitals and vendors each write their own format, so the cost of one more has to stay small.</li>
</ol>
${
  fact === undefined
    ? ""
    : markup`<h2 class="part" id="one-fact-three-forms">One fact, three forms</h2>
<p class="prose">Priya Natarajan's aspirin allergy arrives from three sources, each in its own shape. The adapters read the
same two facts out of all three, the substance and the reaction, and they become one record.</p>
${fact}`
}<h2 class="part" id="adapters">The adapters</h2>
<p class="about">Each card links the adapter's explorer: open a source path like a folder to see what it becomes, what is not carried and why, and the adapter's own test case beside each mapping. Each explorer is read from the adapter's default branch as it stood when these pages were built.</p>
<ul class="cards">
${listed.map((one) => {
  if ("unavailable" in one)
    return markup`<li><h3><code>${repositoryOf(one.repository)}</code></h3><p>Not available: ${one.unavailable}</p><p class="about"><a href="${one.repository}">${one.repository}</a></p></li>\n`;
  const { view } = one;
  return markup`<li><h3><a href="${view.slug}/index.html">${view.title}</a></h3><p>An explorer of where each source path of ${view.title} goes in a Cascade pod, and what is not carried.</p><p class="about">Built from <a href="${view.repository}">${repositoryOf(view.repository)}</a> at <a href="${view.tree}"><code>${short(view.commit)}</code></a></p></li>\n`;
})}</ul>
<h2 class="part" id="write-one">Inside an adapter, and writing one</h2>
<ul>
<li><a href="${BRIDGE_SPECIFICATION}/tree/main/adapter">What is in an adapter</a>: the folder of the Bridge specification that says what an adapter holds.</li>
<li><a href="${BRIDGE_SPECIFICATION}/blob/main/adapter/README.md">Write one</a>: the adapter folder's README, for whoever brings in a new source format.</li>
</ul>
`,
    }).text,
  );
}
