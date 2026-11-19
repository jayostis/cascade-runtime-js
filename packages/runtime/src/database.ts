/** One row of an answer, by column name. */
export type DatabaseRow = Readonly<Record<string, unknown>>;

/** A statement prepared once and run with its parameters as often as needed. */
export interface Statement {
  /** Every row the statement answers. */
  all(...parameters: readonly unknown[]): DatabaseRow[];
  /** The rows the statement answers, one at a time, so a reader can stop after as many as it wants. */
  iterate(...parameters: readonly unknown[]): IterableIterator<DatabaseRow>;
  /** The first row the statement answers, or `undefined` for none. */
  get(...parameters: readonly unknown[]): DatabaseRow | undefined;
  /** The names of the columns the statement answers, in their order. */
  columns(): string[];
  /** Runs a statement that writes, and says how many rows it changed. */
  run(...parameters: readonly unknown[]): { readonly changes: number };
}

/** A function SQL calls by `name`, registered on each connection the opener makes. */
export interface DatabaseFunction {
  readonly name: string;
  /** Gives the same answer for the same arguments, so SQLite may use it in an index or call it once for both. */
  readonly deterministic?: boolean;
  readonly apply: (...values: unknown[]) => unknown;
}

/**
 * A database of prepared statements: the fifth interface the core knows. What a pod keeps beside its files to answer from
 * is held here, and nothing of the engine behind it shows.
 */
export interface Database {
  /** Compiles `sql`, one statement, to run as often as needed; SQL that does not compile throws here. */
  prepare(sql: string): Statement;
  /** Runs statements that answer nothing, such as a schema. */
  exec(sql: string): void;
  /** Runs `work` in one transaction: all it writes is kept, or, when it throws, none. Returns what `work` returns. */
  transaction<T>(work: () => T): T;
  /** Ends the connection, writing back what the write-ahead log holds; nothing may be run on it after. */
  close(): void;
}

/**
 * A database that did not open under the key it was given: a sealed file given another key or none, or a plain file given
 * one. SQLite cannot tell these from a file that is not a database at all; what it said is the `cause`. It is no
 * `Refusal`: no input of a step is bad, the database beside the pod is.
 */
export class DatabaseKeyRefused extends Error {
  override readonly name = "DatabaseKeyRefused";

  constructor(path: string, cause: unknown) {
    super(`the database ${path} does not open under the key it was given`, {
      cause,
    });
  }
}
