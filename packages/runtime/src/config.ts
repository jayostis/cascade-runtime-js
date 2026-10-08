/** A repository read at the head of its default branch, whatever commit that is when the run starts. */
export interface Followed {
  readonly repository: string;
}

/** What `cascade-runtime.json` says the runtime loads: repositories, never a commit of one, and names. */
export interface RuntimeConfig {
  readonly vocabulary: Followed;
  readonly adapters: readonly Followed[];
  readonly importers: readonly string[];
  readonly lens: string;
  readonly tables: TablesConfig;
}

/** The reference tables an app reads: the feeds, and the repository whose feed's shape and fixtures they follow. */
export interface TablesConfig {
  readonly repository: Followed;
  /** Each feed's URL, read in this order. */
  readonly feeds: readonly string[];
  /** Whether an app checks its feeds when it opens; otherwise only when asked. */
  readonly checkOnOpen: boolean;
  /** For each table kind's IRI, the series a person reads it from, first first. */
  readonly preference: Readonly<Record<string, readonly string[]>>;
  /** In Node, each source a builder is run for: a name under the host's `builders/`, or a path. */
  readonly builders: readonly string[];
}

/** What an app sets of its tables, each field replacing the package's. */
export type TablesSettings = Partial<Omit<TablesConfig, "repository">>;

function isIris(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && URL.canParse(item))
  );
}

/** The settings `value` gives, each checked; `where` names it in what is refused. */
export function tablesSettings(value: unknown, where: string): TablesSettings {
  const { feeds, checkOnOpen, preference, builders, ...rest } = (value ??
    {}) as Record<string, unknown>;
  const other = Object.keys(rest);
  if (other.length > 0)
    throw new Error(`${where} names ${other.join(", ")}, which it cannot set`);
  if (feeds !== undefined && !isIris(feeds))
    throw new Error(`${where}.feeds is not a list of URLs`);
  if (checkOnOpen !== undefined && typeof checkOnOpen !== "boolean")
    throw new Error(`${where}.checkOnOpen is not true or false`);
  if (
    preference !== undefined &&
    (typeof preference !== "object" ||
      preference === null ||
      Array.isArray(preference) ||
      Object.entries(preference).some(
        ([kind, series]) => !URL.canParse(kind) || !isIris(series),
      ))
  )
    throw new Error(
      `${where}.preference does not give each table kind's IRI a list of series IRIs`,
    );
  if (
    builders !== undefined &&
    (!Array.isArray(builders) ||
      builders.some((builder) => typeof builder !== "string" || builder === ""))
  )
    throw new Error(`${where}.builders is not a list of sources`);
  const folders = ((builders ?? []) as string[]).map((builder) =>
    builder.split(/[\\/]/).filter(Boolean).pop(),
  );
  const shared = folders.find((folder, at) => folders.indexOf(folder) !== at);
  if (shared !== undefined)
    throw new Error(
      `${where}.builders names more than one builder built into ${shared}`,
    );
  return {
    ...(feeds === undefined ? {} : { feeds }),
    ...(checkOnOpen === undefined ? {} : { checkOnOpen }),
    ...(preference === undefined
      ? {}
      : { preference: preference as Record<string, string[]> }),
    ...(builders === undefined ? {} : { builders: builders as string[] }),
  };
}

/** An app's own `cascade-runtime.json`, which names its tables and nothing else. */
export function appTablesSettings(text: string): TablesSettings {
  const { tables, ...rest } = JSON.parse(text) as Record<string, unknown>;
  const other = Object.keys(rest);
  if (other.length > 0)
    throw new Error(
      `an app's cascade-runtime.json names ${other.join(", ")}, and names nothing but tables`,
    );
  return tablesSettings(tables, "tables");
}

/** The configuration with the settings' fields in place of its tables'. */
export function withTables(
  config: RuntimeConfig,
  ...settings: readonly TablesSettings[]
): RuntimeConfig {
  return { ...config, tables: Object.assign({}, config.tables, ...settings) };
}

function tables(value: unknown): TablesConfig {
  const { repository, ...rest } = (value ?? {}) as Record<string, unknown>;
  const settings = tablesSettings(rest, "tables");
  if (settings.feeds === undefined)
    throw new Error("tables.feeds is not a list of URLs");
  return {
    repository: followed({ repository }, "tables"),
    feeds: settings.feeds,
    checkOnOpen: settings.checkOnOpen ?? true,
    preference: settings.preference ?? {},
    builders: settings.builders ?? [],
  };
}

function followed(value: unknown, where: string): Followed {
  const { repository, ...rest } = (value ?? {}) as Record<string, unknown>;
  if (
    typeof repository !== "string" ||
    !/^https:\/\/\S+[^/]$/.test(repository)
  ) {
    throw new Error(`${where}.repository is not a repository's URL`);
  }
  const other = Object.keys(rest);
  if (other.length > 0)
    throw new Error(
      `${where} names ${other.join(", ")}, and names nothing but its repository`,
    );
  return { repository };
}

export function parseConfig(text: string): RuntimeConfig {
  const config = JSON.parse(text) as Record<string, unknown>;
  const { adapters, importers, lens } = config;
  if (!Array.isArray(adapters)) throw new Error("adapters is not a list");
  if (
    !Array.isArray(importers) ||
    importers.some((importer) => typeof importer !== "string")
  ) {
    throw new Error("importers is not a list of names");
  }
  if (typeof lens !== "string" || lens === "")
    throw new Error("lens is not a name");
  return {
    vocabulary: followed(config.vocabulary, "vocabulary"),
    adapters: adapters.map((adapter, index) =>
      followed(adapter, `adapters[${index}]`),
    ),
    importers: importers as string[],
    lens,
    tables: tables(config.tables),
  };
}

/** The repository's name, which is also the folder a sibling checkout of it is in. */
export function repositoryName(followed: Followed): string {
  return followed.repository.slice(followed.repository.lastIndexOf("/") + 1);
}

/** The IRI a checkout of the repository at a commit is named by (runtime/rules.md, N8). */
export function treeIri(followed: Followed, commit: string): string {
  return `${followed.repository}/tree/${commit}/`;
}
