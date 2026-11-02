// Where the harness's own files are: the package folder, from `dist/src/` once built.
import { dirname, join } from "node:path";
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
/** Prepared cases (downloads and pods), rebuilt when their inputs change; gitignored. `CASCADE_EVALS_WORK` names another. */
export const WORK = process.env.CASCADE_EVALS_WORK ?? at("work");
/**
 * The folder whose `.tables/` is the reference tables every case's pod is given, held once; gitignored. In `WORK`, so
 * one `CASCADE_EVALS_WORK` moves everything. `CASCADE_EVALS_TABLES` names tables already held, which are used as they
 * stand and never fetched.
 */
export const TABLES_GIVEN = process.env.CASCADE_EVALS_TABLES !== undefined;
export const REFERENCE_TABLES =
  process.env.CASCADE_EVALS_TABLES ?? join(WORK, "reference-tables");
export const PRICES = at("prices.json");
export const PRIORS = at("priors.json");

/**
 * The checkout a build of the runtime is in, from its cascade-runtime entry: the folder its processes run in, so it
 * reads its own cascade-runtime.json, never the one of the folder the harness runs from (which an older runtime takes
 * for an app's, and refuses).
 */
export const runtimeRoot = (entry: string) =>
  join(dirname(entry), "..", "..", "..", "..");
