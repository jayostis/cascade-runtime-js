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
 * over the adapter at the head of its default branch, published as it is. An adapter that could not be got is listed as
 * not available with no page, and the build goes on; one that was read but whose explorer could not be made fails the
 * build, unless the build was told to leave the explorers out, and the card then says so.
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
    const adapters = await ctx.adapters();
    const viewed = await Promise.all(
      adapters.map(async (adapter): Promise<AdapterView | string> => {
        try {
          return await viewOf(adapter);
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }),
    );
    const named = viewed.map((view) => {
      if (typeof view === "string") return view;
      if (slugs.has(view.slug))
        return `another adapter is already ${view.slug}`;
      slugs.add(view.slug);
      return view;
    });
    const started = performance.now();
    const explorers = await Promise.all(
      named.map((view) =>
        typeof view === "string" ? undefined : ctx.explorer(view.repository),
      ),
    );
    named.forEach((view, at) => {
      const explorer = explorers[at];
      if (typeof view === "string") {
        const repository = (adapters[at] as AdapterRead).repository;
        ctx.log(`adapters: ${repository} is not available: ${view}`);
        listed.push({ repository, unavailable: view });
      } else if (explorer === undefined) {
        const unavailable = "its explorer was left out of this build";
        ctx.log(`adapters: ${view.slug}: ${unavailable}`);
        listed.push({ repository: view.repository, unavailable });
      } else {
        if (!explorer.has("index.html"))
          throw new Error(
            `the explorer of ${view.repository} has no index.html`,
          );
        for (const [path, bytes] of explorer)
          written.set(`${ADAPTERS_FOLDER}${view.slug}/${path}`, bytes);
        listed.push({ view });
        ctx.log(
          `adapters: ${view.slug} at ${view.commit.slice(0, 7)}, ${explorer.size} explorer files`,
        );
      }
    });
    ctx.log(
      `adapters: the explorers took ${Math.round(performance.now() - started)} ms`,
    );
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
          "each adapter's explorer: from a FHIR R4 or C-CDA path to the Cascade term and record it is written as, and what it drops and why",
      },
    ];
  },
};
