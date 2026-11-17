/** A row of an answer: each column's text, or, for a column its question's crate entry declares a list, its values. */
export type Row = Readonly<Record<string, string | readonly string[]>>;

/** A rows' column that is no list, as its text; none when the row has none. A list column read as text throws. */
export function text(cell: string | readonly string[] | undefined) {
  if (typeof cell === "string" || cell === undefined) return cell;
  throw new Error("a list column was read as text");
}

/** A row that holds no list column. */
export type TextRow = Readonly<Record<string, string>>;

/** The row's columns that are text, which is all of them for a question that declares no list column. */
export function textRow(row: Row): TextRow {
  return Object.fromEntries(
    Object.entries(row).filter(
      (column): column is [string, string] => typeof column[1] === "string",
    ),
  );
}
