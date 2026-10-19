import { iri } from "@cascade-runtime/runtime";
import { type Listed, notation } from "../rows.js";
import { PAGE_SIZE, REC, SHIPS_WITH } from "./constants.js";
import { ofAKind } from "./references-index.js";
import type { Searched, TablesContext } from "./types.js";

export async function search(
  context: TablesContext,
  series: string | readonly string[],
  text: string,
  page = 1,
): Promise<Searched> {
  const versions = await versionsOf(context, series);
  if (versions.length === 0)
    return { total: 0, offset: 0, size: PAGE_SIZE, found: [] };
  const [listings, codes, { uriSpaces }] = await Promise.all([
    Promise.all(versions.map((version) => context.indexes.listed(version))),
    context.indexes.mergedCodes(versions),
    context.terms(),
  ]);
  const wanted = text.trim().toLowerCase();
  const names = wanted === "" ? undefined : await namesListed(context);
  const matched =
    names === undefined
      ? codes
      : codes.filter(
          (code) =>
            names
              .find((each) => Object.hasOwn(each, code))
              ?.[code]?.includes(wanted) === true ||
            (code.slice(-wanted.length).toLowerCase() === wanted &&
              (code.toLowerCase() === wanted ||
                notation(uriSpaces, code).toLowerCase() === wanted)),
        );
  const offset =
    Number.isInteger(page) && page > 1 ? (page - 1) * PAGE_SIZE : 0;
  const shown = matched.slice(offset, offset + PAGE_SIZE);
  const mapsTo = (code: string): readonly string[] => [
    ...new Set(
      listings.flatMap(({ mapsTo }) =>
        Object.hasOwn(mapsTo, code) ? mapsTo[code]! : [],
      ),
    ),
  ];
  const about = await context.about([...shown, ...shown.flatMap(mapsTo)]);
  return {
    ...(versions.length === 1 ? { version: versions[0] } : {}),
    total: matched.length,
    offset,
    size: PAGE_SIZE,
    found: shown.map((code) => ({
      code,
      notation: notation(uriSpaces, code),
      about: about.get(code),
      mapsTo: mapsTo(code).map((target) => ({
        code: target,
        notation: notation(uriSpaces, target),
        about: about.get(target),
      })),
    })),
  };
}

export async function codeNamed(
  context: TablesContext,
  series: string | readonly string[],
  written: string,
): Promise<string | undefined> {
  for (const version of await versionsOf(context, series)) {
    const code = (await context.indexes.notationsIn(version)).get(written);
    if (code !== undefined) return code;
  }
  return undefined;
}

/** The current version of each series given that the app holds. */
async function versionsOf(
  context: TablesContext,
  series: string | readonly string[],
): Promise<string[]> {
  const { index } = await context.references();
  return (typeof series === "string" ? [series] : series).flatMap((each) =>
    ofAKind(index, iri(each))
      ? (index.objects(iri(each), SHIPS_WITH)[0]?.value ?? [])
      : [],
  );
}

/** Each names series' listing of its codes' names, in the order of preference. */
async function namesListed(context: TablesContext): Promise<Listed["names"][]> {
  const references = await context.references();
  return Promise.all(
    context
      .currentOf(references, `${REC}CodeNames`)
      .map(
        async ({ version }) => (await context.indexes.listed(version)).names,
      ),
  );
}
