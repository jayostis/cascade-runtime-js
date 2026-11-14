/**
 * The arguments cascade-bridge-spec's `adapter_explorer.py` is run with over one adapter. An explorer is published at
 * `adapters/<name>/`, so `../index.html` is the adapters page it was reached from.
 */
export function explorerArguments(of: {
  script: string;
  adapterFolder: string;
  vocabularyFolder: string;
  repository: string;
  report: string;
  out: string;
}): string[] {
  return [
    of.script,
    of.adapterFolder,
    "--vocabulary",
    of.vocabularyFolder,
    "--repository",
    of.repository,
    "--report",
    of.report,
    "--way-back",
    "Adapters",
    "../index.html",
    "--out",
    of.out,
  ];
}
