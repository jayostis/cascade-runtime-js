/** One row of an answer, by column name. */
export type DatabaseRow = Readonly<Record<string, unknown>>;

/** A statement prepared once and run with its parameters as often as needed. */
export interface Statement {
  /** Every row the statement answers. */
  all(...parameters: readonly unknown[]): DatabaseRow[];
  /** The first row the statement answers, or `undefined` for none. */
  get(...parameters: readonly unknown[]): DatabaseRow | undefined;
  /** Runs a statement that writes, and says how many rows it changed. */
  run(...parameters: readonly unknown[]): { readonly changes: number };
}

/**
 * A database of prepared statements: the fifth interface the core knows. What a pod keeps beside its files to answer from
 * is held here, and nothing of the engine behind it shows.
 */
export interface Database {
  prepare(sql: string): Statement;
  /** Runs statements that answer nothing, such as a schema. */
  exec(sql: string): void;
  /** Runs `work` in one transaction: all it writes is kept, or, when it throws, none. Returns what `work` returns. */
  transaction<T>(work: () => T): T;
  close(): void;
}
