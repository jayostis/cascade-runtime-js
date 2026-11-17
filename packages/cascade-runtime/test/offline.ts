import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configureTables } from "cascade-runtime";
import { BRIDGE_REPOSITORY } from "@cascade-runtime/runtime/node";

configureTables({ checkOnOpen: false });

/**
 * No test reaches the network. Git speaks only to a path (`file`), so a `git ls-remote` or a fetch of a URL fails at once,
 * saying so; a request to any host but this machine fails the same way, unless the test stubs `fetch` itself. The Bridge
 * is the build `npm run bridge` left in the cache, pinned for the run (outside CI, where the first pick is kept for the
 * run's attempt instead), so none looks at the remote for the newest one.
 */
process.env.GIT_ALLOW_PROTOCOL = "file";
process.env.GIT_TERMINAL_PROMPT = "0";

const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error(
      `a test asked ${url.href}: tests run offline (packages/cascade-runtime/test/offline.ts). Stub fetch, or use a local file`,
    );
  return real(input, init);
};

/** The newest build in the cache `npm run bridge` fills, if any. */
function cachedBuild(): string | undefined {
  let root = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(root, "scripts", "transpile.mjs"))) {
    const up = dirname(root);
    if (up === root) return undefined;
    root = up;
  }
  const cache = join(root, "build", "cache", "cascade-bridge-rs");
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache)
    .filter((name) => /^build-[0-9a-f]{40}$/.test(name))
    .filter((name) => {
      try {
        const manifest = JSON.parse(
          readFileSync(join(cache, name, "package.json"), "utf8"),
        ) as { cascadeBridge?: { commit?: string } };
        return manifest.cascadeBridge?.commit === name.slice("build-".length);
      } catch {
        return false;
      }
    })
    .sort(
      (one, other) =>
        statSync(join(cache, other)).mtimeMs -
        statSync(join(cache, one)).mtimeMs,
    );
  return builds[0]?.slice("build-".length);
}

const commit = process.env.CI === "true" ? undefined : cachedBuild();
if (commit !== undefined && process.env.CASCADE_BRIDGE_PIN === undefined)
  process.env.CASCADE_BRIDGE_PIN = `${BRIDGE_REPOSITORY}@${commit}`;
