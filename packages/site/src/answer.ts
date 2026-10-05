import type { Row, Term, VocabularyQuery } from "@cascade-runtime/runtime";
import { prose, QUESTIONS, written } from "@cascade-runtime/runtime";

/**
 * A query of the vocabulary with its prose and, for a question, its name, the lens it was asked under and its answer:
 * all its rows, or those whose column `about` is `thing`.
 */
export class Answer {
  readonly prose: string;
  readonly title: string;

  constructor(
    readonly query: VocabularyQuery,
    readonly lens: string,
    readonly columns: readonly string[] = [],
    readonly rows: readonly Row[] = [],
    readonly about?: string,
    readonly thing?: Term,
  ) {
    this.prose = prose(query.text);
    this.title =
      query.path.split("/").at(-1)?.replace(/\.rq$/, "") ?? query.path;
  }

  /** The question's name, its path under `questions/` less `.rq`, or undefined for a query that is no question. */
  get question(): string | undefined {
    return this.query.path.startsWith(QUESTIONS)
      ? this.query.path.slice(QUESTIONS.length, -3)
      : undefined;
  }

  /** The columns a reader sees: each label folded into the column it labels, and the one the rows are about left out. */
  get shown(): string[] {
    return this.columns.filter(
      (column) =>
        column !== this.about &&
        !(
          column.endsWith("Label") &&
          this.columns.includes(column.slice(0, -"Label".length))
        ),
    );
  }

  of(column: string, thing: Term): Answer {
    return new Answer(
      this.query,
      this.lens,
      this.columns,
      this.rows.filter((row) => {
        const value = row.get(column);
        return value !== undefined && written(value) === written(thing);
      }),
      column,
      thing,
    );
  }
}
