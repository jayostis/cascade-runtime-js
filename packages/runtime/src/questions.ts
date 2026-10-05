import { LENSES, QUERIES } from "./derive.js";
import { type Files, readText } from "./files.js";

export const QUESTIONS = `${QUERIES}questions/`;

/** A query of the vocabulary, by its path in the vocabulary. */
export interface VocabularyQuery {
  readonly path: string;
  readonly text: string;
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
  return new Map(
    await Promise.all(
      paths.map(
        async ({ path, name }) =>
          [name, { path, text: await readText(vocabulary, path) }] as const,
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
