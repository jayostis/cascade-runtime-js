// A run pinned to commits: each repository the pod arm depends on, cloned at its pinned commit side by side, and the
// runtime among them built, so its pods are made and its cascade-mcp is run by that build, with those components.
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Component } from "./cases.js";
import { sha256 } from "./cases.js";
import { WORK } from "./paths.js";

/** The repositories a run can pin, and where each is fetched from. */
export const PINNABLE: Readonly<Record<string, string>> = {
  "cascade-vocabulary": "https://github.com/jayostis/cascade-vocabulary",
  "cascade-bridge-adapter-fhir-r4":
    "https://github.com/jayostis/cascade-bridge-adapter-fhir-r4",
  "cascade-bridge-adapter-ccda":
    "https://github.com/jayostis/cascade-bridge-adapter-ccda",
  "cascade-bridge-rs": "https://github.com/jayostis/cascade-bridge-rs",
  "cascade-bridge-spec": "https://github.com/jayostis/cascade-bridge-spec",
  "cascade-runtime-js": "https://github.com/jayostis/cascade-runtime-js",
};

/** A pinned environment: the commits, the folder of the clones, and the built runtime's package entry. */
export interface Environment {
  readonly key: string;
  readonly folder: string;
  readonly commits: Readonly<Record<string, string>>;
  /** cascade-runtime's built entry, which builds and reads pods. */
  readonly runtime: string;
  /** cascade-mcp's built command, which the pod arm's MCP client starts. */
  readonly mcp: string;
  readonly components: readonly Component[];
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "core.longpaths=true", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** Each pin as a full commit: "main" is the default branch's head as the repository has it now. */
export function resolvePins(
  pins: Readonly<Record<string, string>>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, pin] of Object.entries(pins)) {
    const repository = PINNABLE[name];
    if (repository === undefined)
      throw new Error(
        `${name} is no repository a run pins: ${Object.keys(PINNABLE).join(", ")}`,
      );
    if (pin === "main") {
      const head = git(".", "ls-remote", repository, "HEAD").split(/\s/)[0];
      if (head === undefined || head === "")
        throw new Error(`${repository} has no head`);
      resolved[name] = head;
    } else resolved[name] = pin;
  }
  if (resolved["cascade-runtime-js"] === undefined)
    throw new Error(
      "a pinned run pins cascade-runtime-js, which builds its pods and serves cascade-mcp",
    );
  return resolved;
}

/**
 * The environment of the pins: each repository cloned at its commit into `work/pinned/<key>/<name>`, side by side, so
 * the runtime finds the others as its siblings (and downloads the Bridge release of the pinned cascade-bridge-rs
 * commit); the runtime installed and built. Made once per set of commits.
 */
export async function environment(
  pins: Readonly<Record<string, string>>,
  log: (line: string) => void,
): Promise<Environment> {
  const resolved = resolvePins(pins);
  const commits: Record<string, string> = {};
  const key = sha256(
    JSON.stringify(
      Object.entries(resolved).sort(([a], [b]) => a.localeCompare(b)),
    ),
  ).slice(0, 12);
  const folder = join(WORK, "pinned", key);
  const done = join(folder, "environment.json");
  if (existsSync(done))
    return JSON.parse(await readFile(done, "utf8")) as Environment;
  await mkdir(folder, { recursive: true });
  for (const [name, pin] of Object.entries(resolved)) {
    const at = join(folder, name);
    if (!existsSync(join(at, ".git"))) {
      log(`pinned: cloning ${name} at ${pin.slice(0, 12)}`);
      git(
        folder,
        "clone",
        "--quiet",
        "--filter=blob:none",
        "--no-checkout",
        PINNABLE[name]!,
        name,
      );
    }
    git(
      at,
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--quiet",
      "--detach",
      pin,
    );
    commits[name] = git(at, "rev-parse", "HEAD");
  }
  const runtime = join(folder, "cascade-runtime-js");
  log("pinned: installing and building cascade-runtime-js (several minutes)");
  execSync("npm ci --silent", { cwd: runtime, stdio: "inherit" });
  execSync("npx tsc -b", { cwd: runtime, stdio: "inherit" });
  const environment: Environment = {
    key,
    folder,
    commits,
    runtime: join(
      runtime,
      "packages",
      "cascade-runtime",
      "dist",
      "src",
      "index.js",
    ),
    mcp: join(runtime, "packages", "mcp", "dist", "src", "cli.js"),
    components: Object.entries(commits)
      .filter(([name]) => name !== "cascade-runtime-js")
      .map(([name, commit]) => ({
        name,
        repository: PINNABLE[name]!,
        commit,
        source: "pinned",
      })),
  };
  await writeFile(done, JSON.stringify(environment, null, 2) + "\n");
  return environment;
}

const SCRIPT = fileURLToPath(
  new URL("../../scripts/pinned.mjs", import.meta.url),
);

/** The pinned runtime's work, run in its own process: a pod built from downloads, or questions asked of it. */
export function pinnedPod(
  env: Environment,
  command: "build" | "ask",
  pod: string,
  args: readonly string[],
): unknown {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [SCRIPT, env.runtime, command, pod, ...args],
      {
        encoding: "utf8",
        maxBuffer: 1 << 30,
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
}
