// Where the harness's own files are: the package folder, from `dist/src/` once built.
import { fileURLToPath } from "node:url";

const at = (path: string) =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url)).replace(
    /[\\/]$/,
    "",
  );

export const PACKAGE = at("");
export const CASES = at("cases");
export const SCHEMAS = at("schemas");
export const CONFIGS = at("configs");
/** Every run's folder: answers, transcripts and results, gitignored. */
export const RUNS = at("runs");
/** The recorded runs, committed: each one's results and the models' final answers. */
export const HISTORY = at("history");
/** Prepared cases (downloads and pods), rebuilt when their inputs change; gitignored. */
export const WORK = at("work");
export const PRICES = at("prices.json");
export const PRIORS = at("priors.json");
