export interface Pin {
  readonly repository: string;
  readonly commit: string;
}

/** What `cascade-runtime.json` says the runtime loads: names and pins only. */
export interface RuntimeConfig {
  readonly vocabulary: Pin;
  readonly adapters: readonly Pin[];
  readonly importers: readonly string[];
  readonly lens: string;
}

function pin(value: unknown, where: string): Pin {
  const { repository, commit } = (value ?? {}) as Record<string, unknown>;
  if (
    typeof repository !== "string" ||
    !/^https:\/\/\S+[^/]$/.test(repository)
  ) {
    throw new Error(`${where}.repository is not a repository's URL`);
  }
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${where}.commit is not a full commit SHA`);
  }
  return { repository, commit };
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
    vocabulary: pin(config.vocabulary, "vocabulary"),
    adapters: adapters.map((adapter, index) =>
      pin(adapter, `adapters[${index}]`),
    ),
    importers: importers as string[],
    lens,
  };
}

/** The repository's name, which is also the folder a sibling checkout of it is in. */
export function repositoryName(pin: Pin): string {
  return pin.repository.slice(pin.repository.lastIndexOf("/") + 1);
}

/** The IRI a checkout of the repository at a commit is named by (runtime/rules.md, N8). */
export function treeIri(pin: Pin, commit: string): string {
  return `${pin.repository}/tree/${commit}/`;
}
