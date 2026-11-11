import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestRun } from "../hub/context.js";

/**
 * One suite's newest run on main, kept in a folder as `report` (JUnit or CTRF, as its runner wrote it) with `run.json` beside it (`commit`, `at`, `url`), and
 * the `spec.json` its artifact held, when it held one. A folder without both, or a `run.json` that does not name the run,
 * is no run: `log` says so, and the page says so for that suite.
 */
export async function readTestRun(
  folder: string,
  suite: string,
  log: (line: string) => void,
): Promise<TestRun | undefined> {
  const reportFile = join(folder, "report");
  const runFile = join(folder, "run.json");
  if (!existsSync(reportFile) || !existsSync(runFile)) {
    log(`no ${suite} test report in ${folder}, so its page says not available`);
    return undefined;
  }
  let run: Partial<Record<"commit" | "at" | "url", unknown>>;
  try {
    run = JSON.parse(await readFile(runFile, "utf8")) as typeof run;
  } catch (error) {
    log(
      `${runFile} cannot be read (${error instanceof Error ? error.message : String(error)}), so the ${suite} test report is not available`,
    );
    return undefined;
  }
  const { commit, at, url } = run;
  if (
    typeof commit !== "string" ||
    typeof at !== "string" ||
    typeof url !== "string"
  ) {
    log(
      `${runFile} names no commit, time and url, so the ${suite} test report is not available`,
    );
    return undefined;
  }
  const specFile = join(folder, "spec.json");
  let spec: unknown;
  if (existsSync(specFile))
    try {
      spec = JSON.parse(await readFile(specFile, "utf8"));
    } catch (error) {
      log(
        `${specFile} cannot be read (${error instanceof Error ? error.message : String(error)}), so the ${suite} page has no spec`,
      );
    }
  return {
    report: await readFile(reportFile, "utf8"),
    commit,
    at,
    url,
    ...(spec === undefined ? {} : { spec }),
  };
}
