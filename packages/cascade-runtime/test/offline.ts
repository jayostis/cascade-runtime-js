import {
  existsSync,
  openSync,
  readFileSync,
  statSync,
  closeSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./offline-git.js";
import { configureTables } from "cascade-runtime";
import { BRIDGE_REPOSITORY } from "@cascade-runtime/runtime/node";

configureTables({ checkOnOpen: false });

/**
 * With `CASCADE_TEST_OFFLINE=1`, which `npm test` and the random-order runs set, no test reaches the network: a git call
 * that names a URL, and a request to any host but this machine, fail at once saying so (a test that stubs `fetch` itself
 * still can). The Bridge is the build `npm run bridge` recorded, pinned for the run, so none looks at the remote for the
 * newest one; when it is not in the cache the run stops and says to run `npm run bridge`. A job that installs the package
 * fetches the components it has no checkout of, so it leaves the variable unset and nothing here applies.
 */
const offline = process.env.CASCADE_TEST_OFFLINE === "1";

if (offline) process.env.GIT_TERMINAL_PROMPT = "0";

const real = globalThis.fetch;
if (offline)
  globalThis.fetch = (input, init) => {
    const address = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
      throw new Error(
        `a test asked ${address.href}: tests run offline (packages/cascade-runtime/test/offline.ts). Stub fetch, or use a local file`,
      );
    return real(input, init);
  };

function checkoutRoot(): string | undefined {
  let root = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(root, "scripts", "transpile.mjs"))) {
    const up = dirname(root);
    if (up === root) return undefined;
    root = up;
  }
  return root;
}

/** Said once for the whole run: the runner starts a process for each test file, all with one parent. */
function sayOnce(line: string): void {
  const marker = join(tmpdir(), `cascade-bridge-pin-said-${process.ppid}`);
  try {
    if (existsSync(marker) && Date.now() - statSync(marker).mtimeMs > 3_600_000)
      utimesSync(marker, new Date(), new Date());
    else closeSync(openSync(marker, "wx"));
    process.stderr.write(`${line}\n`);
  } catch {
    // Said already by another file of this run.
  }
}

/** The build `npm run bridge` recorded as the one this checkout reads, which must be in the cache. */
function pinnedBuild(root: string): string {
  const cache = join(root, "build", "cache", "cascade-bridge-rs");
  let commit: string | undefined;
  try {
    commit = (
      JSON.parse(readFileSync(join(cache, "expected.json"), "utf8")) as {
        commit?: string;
      }
    ).commit;
  } catch {
    // None recorded.
  }
  if (commit === undefined)
    throw new Error(
      `tests run offline and read the Bridge build \`npm run bridge\` recorded in ${join(cache, "expected.json")}, and none is recorded: run \`npm run bridge\``,
    );
  const built = join(cache, `build-${commit}`, "package.json");
  if (!existsSync(built))
    throw new Error(
      `tests run offline and expect the Bridge build ${commit}, which is not in ${cache}: run \`npm run bridge\``,
    );
  sayOnce(
    `pinned Bridge ${commit} (built ${statSync(built).mtime.toISOString().slice(0, 10)})`,
  );
  return commit;
}

const root = offline ? checkoutRoot() : undefined;
if (root !== undefined && process.env.CASCADE_BRIDGE_PIN === undefined)
  process.env.CASCADE_BRIDGE_PIN = `${BRIDGE_REPOSITORY}@${pinnedBuild(root)}`;
