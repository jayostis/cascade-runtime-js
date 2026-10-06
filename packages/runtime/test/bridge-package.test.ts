import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { latestBuild } from "../src/node/bridge-build.js";
import { git } from "../src/node/git.js";
import { BRIDGE_REPOSITORY, findBridgePackage } from "../src/node/wasm.js";

async function checkout(folder: string, sources: string): Promise<string> {
  const dist = join(folder, "package", "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(folder, "package", "sources.mjs"),
    `process.stdout.write(${JSON.stringify(sources)});\n`,
  );
  await writeFile(join(dist, "cascade_bridge_bg.wasm"), new Uint8Array());
  await writeFile(
    join(dist, "package.json"),
    JSON.stringify({
      cascadeBridge: {
        commit: "c".repeat(40),
        dirty: true,
        sources: "sha256-built",
      },
    }),
  );
  return dist;
}

test("a checkout's build is used only when made from the checkout as it is, a sibling's before one handed in, and the run says why one was passed over", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-package-"));
  const found = async (siblings: string, handedIn?: string) => {
    const lines: string[] = [];
    const used = await findBridgePackage({
      siblingsIn: [siblings],
      ...(handedIn === undefined
        ? {}
        : { folders: new Map([[BRIDGE_REPOSITORY, handedIn]]) }),
      cache: join(root, "cache"),
      log: (line) => lines.push(line),
    });
    return { ...used, said: lines.join("\n") };
  };

  const fresh = await checkout(
    join(root, "fresh", "cascade-bridge-rs"),
    "sha256-built",
  );
  const used = await found(join(root, "fresh"));
  assert.deepEqual(
    [used.source, used.folder, used.commit],
    ["sibling", fresh, "c".repeat(40)],
  );
  assert.match(
    used.said,
    /the sibling checkout's build .* with uncommitted changes$/,
  );

  await checkout(join(root, "stale", "cascade-bridge-rs"), "sha256-edited");
  const handed = await found(
    join(root, "stale"),
    join(root, "fresh", "cascade-bridge-rs"),
  );
  assert.deepEqual([handed.source, handed.folder], ["folder", fresh]);
  assert.match(handed.said, /is stale/);
});

test("the newest build of the default branch is its head's release, or while that one builds the nearest commit before it with one, read once per run", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-build-"));
  const origin = join(root, "cascade-bridge-rs");
  await mkdir(origin);
  await git(origin, "init", "--quiet", "--initial-branch=main");
  const commits: string[] = [];
  for (const message of ["one", "two", "three"]) {
    await git(
      origin,
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.org",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      message,
    );
    commits.push((await git(origin, "rev-parse", "HEAD")).trim());
  }
  const [, two = "", three = ""] = commits;
  await git(origin, "tag", `build-${two}`, two);
  const repository = pathToFileURL(origin).href;

  assert.equal(await latestBuild(repository, join(root, "at")), two);
  await git(origin, "tag", `build-${three}`, three);
  assert.equal(await latestBuild(repository, join(root, "at")), two);
  const later = join(root, "later", "cascade-bridge-rs");
  await cp(origin, later, { recursive: true });
  assert.equal(
    await latestBuild(pathToFileURL(later).href, join(root, "at")),
    three,
  );
});
