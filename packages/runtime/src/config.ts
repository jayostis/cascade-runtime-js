export interface Pin {
  readonly repository: string;
  readonly commit: string;
}

/** A repository read at the head of a branch, whatever commit that is when the run starts. */
export interface Followed {
  readonly repository: string;
  readonly branch: string;
}

export type Component = Pin | Followed;

/** What `cascade-runtime.json` says the runtime loads: repositories by the branch each is followed on, and names. */
export interface RuntimeConfig {
  readonly vocabulary: Followed;
  readonly adapters: readonly Followed[];
  readonly importers: readonly string[];
  readonly lens: string;
}

function followed(value: unknown, where: string): Followed {
  const { repository, branch, ...rest } = (value ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof repository !== "string" ||
    !/^https:\/\/\S+[^/]$/.test(repository)
  ) {
    throw new Error(`${where}.repository is not a repository's URL`);
  }
  if (typeof branch !== "string" || !/^\S+$/.test(branch)) {
    throw new Error(`${where}.branch is not a branch's name`);
  }
  const other = Object.keys(rest);
  if (other.length > 0)
    throw new Error(
      `${where} names ${other.join(", ")}, and only a repository and a branch`,
    );
  return { repository, branch };
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
export function repositoryName(component: {
  readonly repository: string;
}): string {
  return component.repository.slice(component.repository.lastIndexOf("/") + 1);
}

/** The IRI a checkout of the repository at a commit is named by (runtime/rules.md, N8). */
export function treeIri(
  component: { readonly repository: string },
  commit: string,
): string {
  return `${component.repository}/tree/${commit}/`;
}
