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
