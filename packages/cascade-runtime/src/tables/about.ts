import { notation, OWL, type Row, rowsAbout, SKOS, values } from "../rows.js";
import { DCT, REC } from "./constants.js";
import { preferred } from "./references-index.js";
import type { About, TablesContext } from "./types.js";

/** A code's name, as the rows of a names version about it give it. */
export function nameOf(
  rows: readonly Row[],
): { label: string; altLabels: string[] } | undefined {
  const [label] = values(rows, `${SKOS}prefLabel`);
  return label === undefined
    ? undefined
    : { label, altLabels: values(rows, `${SKOS}altLabel`) };
}

/** A code's status, as the rows of a status version about it give it. */
export function statusOf(
  rows: readonly Row[],
): { deprecated: boolean; replacedBy: string[] } | undefined {
  const [deprecated] = values(rows, `${OWL}deprecated`);
  return deprecated === undefined
    ? undefined
    : {
        deprecated: deprecated === "true",
        replacedBy: values(rows, `${DCT}isReplacedBy`),
      };
}

export async function about(
  context: TablesContext,
  codes: readonly string[],
): Promise<Map<string, About>> {
  const [references, { uriSpaces }] = await Promise.all([
    context.references(),
    context.terms(),
  ]);
  const found = new Map<string, { -readonly [K in keyof About]: About[K] }>(
    codes.map((code) => [code, { notation: notation(uriSpaces, code) }]),
  );
  const fill = async <K extends Exclude<keyof About, "notation">>(
    kind: string,
    key: K,
    reading: (origin: string) => Promise<(code: string) => About[K]>,
  ): Promise<void> => {
    for (const series of preferred(
      references,
      context.options.preference,
      kind,
    )) {
      const left = codes.filter((code) => found.get(code)?.[key] === undefined);
      if (left.length === 0) return;
      const read = await reading(references.fallback(series));
      for (const code of left) {
        const value = read(code);
        if (value === undefined) continue;
        found.get(code)![key] = value;
      }
    }
  };
  const fromRows =
    <K extends Exclude<keyof About, "notation">>(
      read: (rows: Row[], origin: string) => About[K],
    ) =>
    async (origin: string) => {
      const text = await context.indexes.text(origin);
      return (code: string) => read(rowsAbout(text, code), origin);
    };
  await fill(
    `${REC}CodeNames`,
    "name",
    fromRows<"name">((rows, origin) => {
      const name = nameOf(rows);
      return name === undefined ? undefined : { ...name, origin };
    }),
  );
  await fill(
    `${REC}CodeStatus`,
    "status",
    fromRows<"status">((rows, origin) => {
      const status = statusOf(rows);
      return status === undefined ? undefined : { ...status, origin };
    }),
  );
  // A mapping row is named by a urn:uuid, so the rows about a code are found in the version's listing.
  await fill(`${REC}ProductIngredients`, "ingredients", async (origin) => {
    const { mapsTo } = await context.indexes.listed(origin);
    return (code) =>
      Object.hasOwn(mapsTo, code) && mapsTo[code]!.length > 0
        ? { codes: mapsTo[code]!, origin }
        : undefined;
  });
  return found;
}
