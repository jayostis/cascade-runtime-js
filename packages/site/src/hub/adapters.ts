import { readText } from "@cascade-runtime/runtime";
import {
  ADAPTERS_FOLDER,
  type AdapterView,
  adapterPage,
  adaptersIndex,
  CRATE_FILE,
  crateOf,
  FORMAT_FILE,
  type Listed,
  README_FILE,
  readAccounting,
} from "../adapters.js";
import type { Section } from "../sections.js";
import { declaredTerms } from "../term-reference.js";
import type { AdapterRead, PagesContext } from "./context.js";

export const ADAPTERS_PAGE = `${ADAPTERS_FOLDER}index.html`;

/** What the section reads of the context. */
export type AdaptersContext = Pick<
  PagesContext,
  "adapters" | "vocabulary" | "log"
>;

async function viewOf(
  adapter: AdapterRead,
  declared: ReadonlySet<string>,
): Promise<AdapterView> {
  const { files, commit } = adapter;
  if (files === undefined || commit === undefined)
    throw new Error(adapter.unavailable ?? "it was not read");
  const crate = crateOf(await readText(files, CRATE_FILE));
  const accounting = await readAccounting(files, crate.accounting, crate.gaps);
  let format: AdapterView["format"];
  for (const path of [FORMAT_FILE, README_FILE]) {
    const bytes = await files.read(path);
    if (bytes !== undefined) {
      format = { path, text: new TextDecoder().decode(bytes) };
      break;
    }
  }
  return {
    slug: crate.identifier,
    title: crate.name,
    repository: adapter.repository,
    commit,
    tree: `${adapter.repository}/tree/${commit}/`,
    blob: `${adapter.repository}/blob/${commit}/`,
    accountingPath: crate.accounting,
    ...(crate.gaps === undefined ? {} : { gapsPath: crate.gaps }),
    ...(format === undefined ? {} : { format }),
    accounting,
    declared,
  };
}

/**
 * What each adapter's accounting says a source path becomes in Cascade, or why it is dropped, under `adapters/`: a page that
 * lists the adapters and one for each, read from the adapter at the head of its default branch. An adapter that could not be
 * got, or whose accounting cannot be read, is listed as not available with no page, and the build goes on.
 */
export const adaptersSection: Section<AdaptersContext> = {
  path: ADAPTERS_PAGE,
  title: "Adapters",
  want: "adapters",
  about:
    "what each source format's paths become in a Cascade pod, and what is not carried and why.",
  source:
    "the source accounting of each adapter at the head of its default branch",
  async build(ctx) {
    const written = new Map<string, Uint8Array>();
    const listed: Listed[] = [];
    const slugs = new Set<string>();
    let declared: ReadonlySet<string> | undefined;
    for (const adapter of await ctx.adapters()) {
      const started = performance.now();
      try {
        if (adapter.files !== undefined)
          declared ??= await declaredTerms((await ctx.vocabulary()).files);
        const view = await viewOf(adapter, declared ?? new Set());
        if (slugs.has(view.slug))
          throw new Error(`another adapter is already ${view.slug}`);
        slugs.add(view.slug);
        written.set(
          `${ADAPTERS_FOLDER}${view.slug}/index.html`,
          adapterPage(view),
        );
        listed.push({ view });
        ctx.log(
          `adapters: ${view.slug} at ${view.commit.slice(0, 7)}, ${view.accounting.paths.length} paths, built in ${Math.round(performance.now() - started)} ms`,
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
    written.set(ADAPTERS_PAGE, adaptersIndex(listed));
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
