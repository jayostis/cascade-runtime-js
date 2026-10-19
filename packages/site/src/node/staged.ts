import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Refuses a staged package built from another commit than the workspace is at, which would run with that commit's code. */
export function assertStagedCurrent(stage: string, root: string): void {
  const built = (
    JSON.parse(readFileSync(join(stage, "package.json"), "utf8")) as {
      cascadeRuntime?: { commit?: string };
    }
  ).cascadeRuntime?.commit;
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (built !== head)
    throw new Error(
      `${stage} was built from ${built ?? "an unknown commit"}, not from ${head}; run npm run build:package first`,
    );
}
