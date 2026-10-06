import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { packed } from "../src/node/components.js";
import { checkout, git } from "../src/node/git.js";
import { type ResolverOptions, resolve } from "../src/node/resolver.js";
import { siblingsOf } from "../src/node/runtime.js";

let root: string;
let repository: string;

async function repositoryAt(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  await git(folder, "init", "--quiet", "--initial-branch=main");
  await writeFile(join(folder, "rules.md"), "the rules\n");
  await git(folder, "add", ".");
  await git(
    folder,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.org",
    "commit",
    "--quiet",
    "-m",
    "start",
  );
  return (await git(folder, "rev-parse", "HEAD")).trim();
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "resolver-"));
  await repositoryAt(join(root, "published", "cascade-vocabulary"));
  repository = pathToFileURL(
    join(root, "published", "cascade-vocabulary"),
  ).href;
});

async function resolved(options: Omit<ResolverOptions, "log">) {
  const lines: string[] = [];
  const found = await resolve(
    { repository },
    { ...options, log: (line) => lines.push(line) },
  );
  assert.equal(lines.length, 1);
  return { found, said: lines[0] ?? "" };
}

test("a sibling checkout is used as it is on disk, and the run says its commit and its uncommitted files", async () => {
  const siblings = join(root, "siblings");
  const sibling = join(siblings, "cascade-vocabulary");
  const at = await repositoryAt(sibling);
  await writeFile(join(sibling, "draft.rq"), "ASK {}\n");
  const { found, said } = await resolved({
    siblingsIn: [siblings],
    folders: new Map([
      [repository, join(root, "published", "cascade-vocabulary")],
    ]),
    cache: join(root, "cache"),
  });
  assert.equal(found.source, "sibling");
  assert.equal(found.folder, sibling);
  assert.equal(found.iri, `${repository}/tree/${at}/`);
  assert.match(said, /^cascade-vocabulary: the sibling checkout /);
  assert.ok(said.includes(at.slice(0, 12)), said);
  assert.match(said, /with 1 uncommitted files$/);
});

test("without a sibling, a folder handed in is used, and the run says so", async () => {
  const handedIn = join(root, "published", "cascade-vocabulary");
  const { found, said } = await resolved({
    siblingsIn: [join(root, "no-siblings")],
    folders: new Map([[repository, handedIn]]),
    cache: join(root, "cache"),
  });
  assert.equal(found.source, "folder");
  assert.equal(found.folder, handedIn);
  assert.match(
    said,
    /^cascade-vocabulary: the folder handed in, .*, at [0-9a-f]{12} with no uncommitted changes$/,
  );
});

test("otherwise the head of the default branch is fetched as it is now into the cache, by any number of runs at once, and the run says which commit", async () => {
  const published = join(root, "published", "cascade-vocabulary");
  await git(
    published,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.org",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "later",
  );
  const head = (await git(published, "rev-parse", "HEAD")).trim();
  const options = {
    siblingsIn: [join(root, "no-siblings")],
    cache: join(root, "cache"),
  };
  const [{ found, said }, second, third] = await Promise.all([
    resolved(options),
    resolved(options),
    resolved(options),
  ]);
  assert.equal(second.found.folder, found.folder);
  assert.equal(third.found.folder, found.folder);
  assert.equal(found.source, "fetched");
  assert.equal(found.folder, join(root, "cache", "cascade-vocabulary", head));
  assert.equal(found.iri, `${repository}/tree/${head}/`);
  assert.equal((await checkout(found.folder))?.commit, head);
  assert.ok(existsSync(join(found.folder, "rules.md")));
  assert.equal(
    said,
    `cascade-vocabulary: main at ${head.slice(0, 12)}, fetched into ${found.folder}`,
  );
});

test("a worktree finds each sibling beside itself, and otherwise beside the checkout it was made from", async () => {
  const checkouts = join(root, "checkouts");
  const main = join(checkouts, "cascade-runtime-js");
  await repositoryAt(main);
  await repositoryAt(join(checkouts, "cascade-vocabulary"));
  await repositoryAt(join(checkouts, "cascade-adapter"));
  const worktrees = join(root, "worktrees", "change");
  const worktree = join(worktrees, "cascade-runtime-js");
  await git(main, "worktree", "add", "--quiet", "--detach", worktree);
  await repositoryAt(join(worktrees, "cascade-vocabulary"));
  const siblingsIn = await siblingsOf(worktree);
  const folderOf = async (name: string): Promise<string> => {
    const { folder } = await resolve(
      { repository: `${pathToFileURL(root).href}/${name}` },
      {
        siblingsIn,
        cache: join(root, "cache"),
      },
    );
    return realpath(folder);
  };
  assert.equal(
    await folderOf("cascade-vocabulary"),
    await realpath(join(worktrees, "cascade-vocabulary")),
  );
  assert.equal(
    await folderOf("cascade-adapter"),
    await realpath(join(checkouts, "cascade-adapter")),
  );
  assert.deepEqual(await siblingsOf(main), [dirname(main)]);
});

test("a package's components resolve to the trees it carries at the commits it recorded, and a repository it does not carry, or a bundled Bridge built from another commit, is refused, named", async () => {
  const carried = join(root, "package", "components");
  const commit = "9990bdf0000000000000000000000000000000aa";
  const vocabulary = "https://example.org/cascade-vocabulary";
  await mkdir(join(carried, "cascade-vocabulary", commit), { recursive: true });
  const bridge = join(root, "package", "node_modules", "cascade-bridge-rs");
  await mkdir(bridge, { recursive: true });
  await writeFile(join(bridge, "cascade_bridge_bg.wasm"), "");
  await writeFile(
    join(bridge, "package.json"),
    JSON.stringify({
      cascadeBridge: { commit: "1", dirty: false, sources: "" },
    }),
  );
  await writeFile(
    join(carried, "cascade-runtime.json"),
    JSON.stringify({
      vocabulary: { repository: vocabulary },
      adapters: [{ repository: "https://example.org/cascade-adapter" }],
      importers: [],
      lens: "everyday",
    }),
  );
  await writeFile(
    join(carried, "packed.json"),
    JSON.stringify({
      components: [{ repository: vocabulary, commit }],
      bridge: { release: "build-0", commit: "0" },
    }),
  );
  const components = await packed(carried);
  const found = await components.resolve(components.config.vocabulary);
  assert.equal(found.source, "packed");
  assert.equal(found.folder, join(carried, "cascade-vocabulary", commit));
  assert.equal(found.commit, commit);
  assert.equal(found.iri, `${vocabulary}/tree/${commit}/`);
  await assert.rejects(
    components.resolve({ repository: "https://example.org/cascade-adapter" }),
    /cascade-adapter/,
  );
  await assert.rejects(components.bridge(), /build-0 at 0\b.*from 1$/);
});
