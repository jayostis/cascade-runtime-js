import { LENSES, QUERIES } from "./derive.js";
import { type Files, readText } from "./files.js";

export const QUESTIONS = `${QUERIES}questions/`;

/** A column of a question that holds a list, and how the vocabulary's crate says one value of it ends. */
export interface ListColumn {
  readonly column: string;
  /** What ends a value: the text between two values. */
  readonly separator: string;
  /** When given, the start every value has: the separator ends a value only where this comes next. */
  readonly followedBy?: string;
}

/** A query of the vocabulary, by its path in the vocabulary. */
export interface VocabularyQuery {
  readonly path: string;
  readonly text: string;
  /** The columns the crate declares for it as lists; none for a query that declares none. */
  readonly lists: readonly ListColumn[];
}

const CRATE = "ro-crate-metadata.json";

/** The list columns the vocabulary's crate declares, by the path of each question. */
async function declaredLists(
  vocabulary: Files,
): Promise<ReadonlyMap<string, readonly ListColumn[]>> {
  const bytes = await vocabulary.read(CRATE);
  if (bytes === undefined) return new Map();
  const { "@graph": graph } = JSON.parse(new TextDecoder().decode(bytes)) as {
    "@graph": readonly {
      "@id"?: string;
      listColumns?: readonly Partial<ListColumn>[];
    }[];
  };
  return new Map(
    graph.flatMap(({ "@id": path, listColumns }) =>
      path === undefined || listColumns === undefined
        ? []
        : [
            [
              path,
              listColumns.map(({ column, separator, followedBy }) => {
                if (
                  typeof column !== "string" ||
                  typeof separator !== "string" ||
                  separator === "" ||
                  (followedBy !== undefined && typeof followedBy !== "string")
                )
                  throw new Error(
                    `${CRATE} declares a list column of ${path} with no column or no separator`,
                  );
                return {
                  column,
                  separator,
                  ...(followedBy === undefined ? {} : { followedBy }),
                };
              }),
            ] as const,
          ],
    ),
  );
}

/** The values of a list column's text, each as the vocabulary says one ends; no text, no values. */
export function valuesOf(text: string, list: ListColumn): string[] {
  if (text === "") return [];
  const values: string[] = [];
  let start = 0;
  for (
    let at = text.indexOf(list.separator, start);
    at !== -1;
    at = text.indexOf(list.separator, at + 1)
  ) {
    const next = at + list.separator.length;
    if (
      at >= start &&
      (list.followedBy === undefined || text.startsWith(list.followedBy, next))
    ) {
      values.push(text.slice(start, at));
      start = next;
    }
  }
  values.push(text.slice(start));
  return values;
}

/** A question's row with each list column the vocabulary declares for it given as its values. */
export function withLists(
  row: Readonly<Record<string, string>>,
  lists: readonly ListColumn[],
): Readonly<Record<string, string | readonly string[]>> {
  const given: Record<string, string | readonly string[]> = { ...row };
  for (const list of lists) {
    const text = row[list.column];
    if (text !== undefined) given[list.column] = valuesOf(text, list);
  }
  return given;
}

/** A query's leading comment, as one paragraph. */
export function prose(text: string): string {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("#")) break;
    lines.push(line.replace(/^#+/, "").trim());
  }
  return lines.join(" ");
}

/** Each question of the vocabulary, by its path under `questions/` less `.rq`, in the order of those paths. */
export async function questions(
  vocabulary: Files,
): Promise<ReadonlyMap<string, VocabularyQuery>> {
  const paths = (await vocabulary.list(QUESTIONS))
    .filter((path) => path.endsWith(".rq"))
    .map((path) => ({ path, name: path.slice(QUESTIONS.length, -3) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const declared = await declaredLists(vocabulary);
  return new Map(
    await Promise.all(
      paths.map(
        async ({ path, name }) =>
          [
            name,
            {
              path,
              text: await readText(vocabulary, path),
              lists: declared.get(path) ?? [],
            },
          ] as const,
      ),
    ),
  );
}

/** The name of each lens the vocabulary offers, in order. */
export async function lenses(vocabulary: Files): Promise<string[]> {
  return (await vocabulary.list(LENSES))
    .filter((path) => path.endsWith(".rq"))
    .map((path) => path.slice(LENSES.length, -3))
    .sort();
}
