import { parseCrate } from "./crate.js";
import { LENSES, QUERIES } from "./derive.js";
import { type Files, readText } from "./files.js";

export const QUESTIONS = `${QUERIES}questions/`;

/** A column of a question that holds a list, and how the vocabulary's crate says one value of it ends. */
export interface ListColumn {
  readonly column: string;
  /** What ends a value: the text between two values. */
  readonly separator: string;
}

/** A query of the vocabulary, by its path in the vocabulary. */
export interface VocabularyQuery {
  readonly path: string;
  readonly text: string;
  /** The columns the crate declares for it as lists; none for a query that declares none. */
  readonly lists: readonly ListColumn[];
  /** The text of the `.sql` beside it, which gives its rows from a pod's database; none where there is none. */
  readonly sql?: string;
}

const CRATE = "ro-crate-metadata.json";

/** The list columns the vocabulary's crate declares, by the path of each question. */
async function declaredLists(
  vocabulary: Files,
): Promise<ReadonlyMap<string, readonly ListColumn[]>> {
  const bytes = await vocabulary.read(CRATE);
  if (bytes === undefined) return new Map();
  interface Entity {
    "@id"?: string;
    "csvw:tableSchema"?: { "@id"?: string };
    "csvw:column"?: readonly { "@id"?: string }[];
    "csvw:name"?: string;
    "csvw:separator"?: string;
  }
  const { "@graph": graph } = parseCrate<{ "@graph": readonly Entity[] }>(
    new TextDecoder().decode(bytes),
  );
  const byId = new Map(
    graph.flatMap((entity) =>
      entity["@id"] === undefined ? [] : [[entity["@id"], entity] as const],
    ),
  );
  return new Map(
    graph.flatMap(({ "@id": path, "csvw:tableSchema": table }) => {
      if (path === undefined || table?.["@id"] === undefined) return [];
      const columns = byId.get(table["@id"])?.["csvw:column"];
      if (columns === undefined)
        throw new Error(
          `${CRATE} declares no columns for the table of ${path}`,
        );
      return [
        [
          path,
          columns.flatMap(({ "@id": id }) => {
            const column = id === undefined ? undefined : byId.get(id);
            const name = column?.["csvw:name"];
            const separator = column?.["csvw:separator"];
            if (typeof name !== "string")
              throw new Error(
                `${CRATE} declares a column of ${path} with no name`,
              );
            if (separator === undefined) return [];
            if (typeof separator !== "string" || separator === "")
              throw new Error(
                `${CRATE} declares the column ${name} of ${path} with no separator`,
              );
            return [{ column: name, separator }];
          }),
        ] as const,
      ];
    }),
  );
}

/** The values of a list column's text, split at every separator; no text, no values. */
export function valuesOf(text: string, list: ListColumn): string[] {
  return text === "" ? [] : text.split(list.separator);
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
  const listed = await vocabulary.list(QUESTIONS);
  const sql = new Set(listed.filter((path) => path.endsWith(".sql")));
  const paths = listed
    .filter((path) => path.endsWith(".rq"))
    .map((path) => ({ path, name: path.slice(QUESTIONS.length, -3) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const declared = await declaredLists(vocabulary);
  return new Map(
    await Promise.all(
      paths.map(async ({ path, name }) => {
        const beside = `${path.slice(0, -3)}.sql`;
        return [
          name,
          {
            path,
            text: await readText(vocabulary, path),
            lists: declared.get(path) ?? [],
            ...(sql.has(beside)
              ? { sql: await readText(vocabulary, beside) }
              : {}),
          },
        ] as const;
      }),
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
