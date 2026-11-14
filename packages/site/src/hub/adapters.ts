import { readText } from "@cascade-runtime/runtime";
import {
  ADAPTERS_FOLDER,
  type AdapterView,
  adaptersIndex,
  CRATE_FILE,
  crateOf,
  type Listed,
} from "../adapters.js";
import { oneFactView, readOneFact } from "../one-fact.js";
import type { Section } from "../sections.js";
import type { AdapterRead, PagesContext } from "./context.js";

export const ADAPTERS_PAGE = `${ADAPTERS_FOLDER}index.html`;

/** What the section reads of the context. */
export type AdaptersContext = Pick<
  PagesContext,
  "adapters" | "explorer" | "vocabulary" | "log" | "chrome"
>;

async function viewOf(adapter: AdapterRead): Promise<AdapterView> {
  const { files, commit } = adapter;
  if (files === undefined || commit === undefined)
    throw new Error(adapter.unavailable ?? "it was not read");
  const crate = crateOf(await readText(files, CRATE_FILE));
  return {
    slug: crate.identifier,
    title: crate.name,
    repository: adapter.repository,
    commit,
    tree: `${adapter.repository}/tree/${commit}/`,
  };
}

/**
 * The adapters under `adapters/`: a page that lists them, and for each the explorer the cascade-bridge-spec generator writes
 * over the adapter at the head of its default branch, published as it is. An adapter that could not be got, or whose
 * explorer could not be made, is listed as not available with no page, and the build goes on.
 */
export const adaptersSection: Section<AdaptersContext> = {
  path: ADAPTERS_PAGE,
  title: "Adapters",
  want: "adapters",
  about:
    "what each source format's paths become in a Cascade pod, and what is not carried and why.",
  source:
    "the adapter explorers, generated over each adapter at the head of its default branch",
  async build(ctx) {
    const written = new Map<string, Uint8Array>();
    const listed: Listed[] = [];
    const slugs = new Set<string>();
    for (const adapter of await ctx.adapters()) {
      const started = performance.now();
      try {
        const view = await viewOf(adapter);
        if (slugs.has(view.slug))
          throw new Error(`another adapter is already ${view.slug}`);
        const explorer = await ctx.explorer(adapter.repository);
        if (!explorer.has("index.html"))
          throw new Error("its explorer has no index.html");
        slugs.add(view.slug);
        for (const [path, bytes] of explorer)
          written.set(`${ADAPTERS_FOLDER}${view.slug}/${path}`, bytes);
        listed.push({ view });
        ctx.log(
          `adapters: ${view.slug} at ${view.commit.slice(0, 7)}, ${explorer.size} explorer files, built in ${Math.round(performance.now() - started)} ms`,
        );
      } catch (error) {
        const unavailable =
          error instanceof Error ? error.message : String(error);
        ctx.log(
          `adapters: ${adapter.repository} is not available: ${unavailable}`,
        );
        listed.push({ repository: adapter.repository, unavailable });
      }
    }
    const { files } = await ctx.vocabulary();
    const fact = oneFactView(files, await readOneFact(files));
    written.set(ADAPTERS_PAGE, adaptersIndex(listed, ctx.chrome, fact));
    return written;
  },
  async rows() {
    return [
      {
        href: ADAPTERS_FOLDER,
        label: "See where each FHIR R4 or C-CDA path goes",
        about:
          "each adapter's crosswalk from a FHIR R4 or C-CDA path to the Cascade term and record it is written as, and what it drops and why",
      },
    ];
  },
};
