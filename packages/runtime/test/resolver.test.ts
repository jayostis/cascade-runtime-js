import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { type Components, packed } from "../src/node/components.js";
import { checkout, git } from "../src/node/git.js";
import {
  optionsKey,
  type Resolved,
  type ResolverOptions,
  resolve,
} from "../src/node/resolver.js";
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

async function resolved(options: Omit<ResolverOptions, "log">) {
  const lines: string[] = [];
  const found = await resolve(
    { repository },
    { ...options, log: (line) => lines.push(line) },
  );
  assert.equal(lines.length, 1);
  return { found, said: lines[0] ?? "" };
}

/**
 * The runtime reads the vocabulary, the adapters and the reference tables from repositories of their own, its components.
 * `resolve` picks the folder each is read from and logs in one line which commit a run used, so a result can be traced to
 * the rules it was run against.
 */
describe("Finding the vocabulary and adapters a run uses · resolve(), siblingsOf(), packed()", () => {
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "resolver-"));
    await repositoryAt(join(root, "published", "cascade-vocabulary"));
    repository = pathToFileURL(
      join(root, "published", "cascade-vocabulary"),
    ).href;
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("given a sibling checkout of the component", () => {
    let found: Resolved;
    let said: string;
    let sibling: string;
    let at: string;

    before(async () => {
      const siblings = join(root, "siblings");
      sibling = join(siblings, "cascade-vocabulary");
      at = await repositoryAt(sibling);
      await writeFile(join(sibling, "draft.rq"), "ASK {}\n");
      ({ found, said } = await resolved({
        siblingsIn: [siblings],
        folders: new Map([
          [repository, join(root, "published", "cascade-vocabulary")],
        ]),
        cache: join(root, "cache"),
      }));
    });

    it("returns the sibling's folder as it is on disk, with `source` `sibling`", () => {
      assert.equal(found.source, "sibling");
      assert.equal(found.folder, sibling);
    });

    it("names the component by its tree at the checkout's commit", () => {
      assert.equal(found.iri, `${repository}/tree/${at}/`);
    });

    it("logs one line with the commit and the number of uncommitted files", () => {
      assert.match(said, /^cascade-vocabulary: the sibling checkout /);
      assert.ok(said.includes(at.slice(0, 12)), said);
      assert.match(said, /with 1 uncommitted files$/);
    });
  });

  describe("given a process that lives on while a sibling checkout moves", () => {
    it("resolves it again at the commit it is at now", async () => {
      const siblings = join(root, "siblings-moving");
      const folder = join(siblings, "cascade-vocabulary");
      const first = await repositoryAt(folder);
      const options = { siblingsIn: [siblings], cache: join(root, "cache") };
      assert.equal((await resolved(options)).found.commit, first);
      await writeFile(join(folder, "more.md"), "more\n");
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
        "next",
      );
      const next = (await git(folder, "rev-parse", "HEAD")).trim();
      assert.equal((await resolved(options)).found.commit, next);
    });

    /** A commit made with plumbing and moved to by `update-ref`: the index git keeps is not written, only the ref is. */
    async function moved(folder: string): Promise<string> {
      await new Promise((done) => setTimeout(done, 30));
      const commit = (
        await git(
          folder,
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@example.org",
          "commit-tree",
          "HEAD^{tree}",
          "-p",
          "HEAD",
          "-m",
          "moved",
        )
      ).trim();
      await git(folder, "update-ref", "HEAD", commit);
      return commit;
    }

    it("sees a branch's ref move with no change of the index", async () => {
      const siblings = join(root, "siblings-empty");
      const folder = join(siblings, "cascade-vocabulary");
      const first = await repositoryAt(folder);
      const options = { siblingsIn: [siblings], cache: join(root, "cache") };
      // Each resolution's `git status` may rewrite the index: it is at rest once the one kept has been read twice.
      for (let again = 0; again < 3; again += 1)
        assert.equal((await resolved(options)).found.commit, first);
      const next = await moved(folder);
      assert.notEqual(next, first);
      assert.equal((await resolved(options)).found.commit, next);
    });

    it("sees a commit in a linked worktree, where the ref lives in the main repository", async () => {
      const main = join(root, "main-of-worktree");
      const first = await repositoryAt(main);
      const siblings = join(root, "siblings-worktree");
      const folder = join(siblings, "cascade-vocabulary");
      await mkdir(siblings, { recursive: true });
      await git(main, "worktree", "add", "--quiet", "-b", "linked", folder);
      const options = { siblingsIn: [siblings], cache: join(root, "cache") };
      // Each resolution's `git status` may rewrite the index: it is at rest once the one kept has been read twice.
      for (let again = 0; again < 3; again += 1)
        assert.equal((await resolved(options)).found.commit, first);
      const next = await moved(folder);
      assert.equal((await resolved(options)).found.commit, next);
    });

    it("sees a commit on a detached HEAD", async () => {
      const siblings = join(root, "siblings-detached");
      const folder = join(siblings, "cascade-vocabulary");
      const first = await repositoryAt(folder);
      await git(folder, "checkout", "--quiet", "--detach");
      const options = { siblingsIn: [siblings], cache: join(root, "cache") };
      // Each resolution's `git status` may rewrite the index: it is at rest once the one kept has been read twice.
      for (let again = 0; again < 3; again += 1)
        assert.equal((await resolved(options)).found.commit, first);
      const next = await moved(folder);
      assert.equal((await resolved(options)).found.commit, next);
    });

    it("keys the folders handed in without regard to their order", () => {
      const cache = join(root, "cache");
      assert.equal(
        optionsKey({
          siblingsIn: [],
          cache,
          folders: new Map([
            ["b", "1"],
            ["a", "2"],
          ]),
        }),
        optionsKey({
          siblingsIn: [],
          cache,
          folders: new Map([
            ["a", "2"],
            ["b", "1"],
          ]),
        }),
      );
    });
  });

  describe("given no sibling, and a folder handed in", () => {
    let found: Resolved;
    let said: string;
    let handedIn: string;

    before(async () => {
      handedIn = join(root, "published", "cascade-vocabulary");
      ({ found, said } = await resolved({
        siblingsIn: [join(root, "no-siblings")],
        folders: new Map([[repository, handedIn]]),
        cache: join(root, "cache"),
      }));
    });

    it("returns that folder, with `source` `folder`", () => {
      assert.equal(found.source, "folder");
      assert.equal(found.folder, handedIn);
    });

    it("logs that the folder was handed in, its commit, and that nothing is uncommitted", () => {
      assert.match(
        said,
        /^cascade-vocabulary: the folder handed in, .*, at [0-9a-f]{12} with no uncommitted changes$/,
      );
    });
  });

  describe("given neither", () => {
    let head: string;
    let calls: { found: Resolved; said: string }[];
    let commit: string | undefined;

    before(async () => {
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
      head = (await git(published, "rev-parse", "HEAD")).trim();
      const options = {
        siblingsIn: [join(root, "no-siblings")],
        cache: join(root, "cache"),
      };
      calls = await Promise.all([
        resolved(options),
        resolved(options),
        resolved(options),
      ]);
      commit = (await checkout(calls[0]?.found.folder ?? ""))?.commit;
    });

    it("fetches the head of the default branch into `cache/<name>/<commit>`", () => {
      const found = calls[0]?.found;
      assert.equal(found?.source, "fetched");
      assert.equal(
        found?.folder,
        join(root, "cache", "cascade-vocabulary", head),
      );
      assert.equal(found?.iri, `${repository}/tree/${head}/`);
      assert.equal(commit, head);
      assert.ok(existsSync(join(found?.folder ?? "", "rules.md")));
    });

    it("returns one folder to three calls made at once", () => {
      const [found, second, third] = calls;
      assert.equal(second?.found.folder, found?.found.folder);
      assert.equal(third?.found.folder, found?.found.folder);
    });

    it("logs the branch, the commit and the folder", () => {
      assert.equal(
        calls[0]?.said,
        `cascade-vocabulary: main at ${head.slice(0, 12)}, fetched into ${calls[0]?.found.folder}`,
      );
    });
  });

  describe("given a sibling the compatibility tooling merged a pull request's head into", () => {
    let sibling: string;
    let start: string;
    let pullHead: string;
    let merge: string;

    before(async () => {
      const siblings = join(root, "merged-siblings");
      sibling = join(siblings, "cascade-vocabulary");
      start = await repositoryAt(sibling);
      const as = (email: string) => [
        "-c",
        "user.name=test",
        "-c",
        `user.email=${email}`,
      ];
      await git(sibling, "checkout", "--quiet", "-b", "pull");
      await writeFile(join(sibling, "pull.md"), "the pull request\n");
      await git(sibling, "add", ".");
      await git(
        sibling,
        ...as("test@example.org"),
        "commit",
        "--quiet",
        "-m",
        "pull",
      );
      pullHead = (await git(sibling, "rev-parse", "HEAD")).trim();
      await git(sibling, "checkout", "--quiet", "main");
      await writeFile(join(sibling, "main.md"), "main moved\n");
      await git(sibling, "add", ".");
      await git(
        sibling,
        ...as("test@example.org"),
        "commit",
        "--quiet",
        "-m",
        "main",
      );
      await git(
        sibling,
        ...as("compatibility@invalid"),
        "merge",
        "--quiet",
        "--no-ff",
        "--no-edit",
        pullHead,
      );
      merge = (await git(sibling, "rev-parse", "HEAD")).trim();
    });

    it("names the pull request's head, not the merge commit no server holds", async () => {
      assert.notEqual(merge, pullHead);
      assert.equal((await checkout(sibling))?.commit, pullHead);
    });

    it("keeps HEAD for a merge anyone else made", async () => {
      await git(sibling, "reset", "--quiet", "--hard", "HEAD^");
      await git(
        sibling,
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.org",
        "merge",
        "--quiet",
        "--no-ff",
        "--no-edit",
        pullHead,
      );
      assert.equal(
        (await checkout(sibling))?.commit,
        (await git(sibling, "rev-parse", "HEAD")).trim(),
      );
      assert.notEqual(start, pullHead);
    });
  });

  describe("siblingsOf(root)", () => {
    let checkouts: string;
    let main: string;
    let worktrees: string;
    let folderOf: (name: string) => Promise<string>;

    before(async () => {
      checkouts = join(root, "checkouts");
      main = join(checkouts, "cascade-runtime-js");
      await repositoryAt(main);
      await repositoryAt(join(checkouts, "cascade-vocabulary"));
      await repositoryAt(join(checkouts, "cascade-adapter"));
      worktrees = join(root, "worktrees", "change");
      const worktree = join(worktrees, "cascade-runtime-js");
      await git(main, "worktree", "add", "--quiet", "--detach", worktree);
      await repositoryAt(join(worktrees, "cascade-vocabulary"));
      const siblingsIn = await siblingsOf(worktree);
      folderOf = async (name) => {
        const { folder } = await resolve(
          { repository: `${pathToFileURL(root).href}/${name}` },
          {
            siblingsIn,
            cache: join(root, "cache"),
          },
        );
        return realpath(folder);
      };
    });

    it("returns the one folder that holds a main checkout", async () => {
      assert.deepEqual(await siblingsOf(main), [dirname(main)]);
    });

    it("finds beside a linked worktree the sibling that is there", async () => {
      assert.equal(
        await folderOf("cascade-vocabulary"),
        await realpath(join(worktrees, "cascade-vocabulary")),
      );
    });

    it("finds beside the worktree's main checkout a sibling the worktree's folder lacks", async () => {
      assert.equal(
        await folderOf("cascade-adapter"),
        await realpath(join(checkouts, "cascade-adapter")),
      );
    });
  });

  describe("packed(folder)", () => {
    const commit = "9990bdf0000000000000000000000000000000aa";
    const vocabulary = "https://example.org/cascade-vocabulary";
    let carried: string;
    let components: Components;

    before(async () => {
      carried = join(root, "package", "components");
      await mkdir(join(carried, "cascade-vocabulary", commit), {
        recursive: true,
      });
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
          tables: {
            repository: "https://example.org/cascade-reference-tables",
            feeds: [],
          },
        }),
      );
      await writeFile(
        join(carried, "packed.json"),
        JSON.stringify({
          components: [{ repository: vocabulary, commit }],
          bridge: { release: "build-0", commit: "0" },
        }),
      );
      components = await packed(carried);
    });

    it("returns a component the package carries, at the commit it recorded, with `source` `packed`", async () => {
      const found = await components.resolve(components.config.vocabulary);
      assert.equal(found.source, "packed");
      assert.equal(found.folder, join(carried, "cascade-vocabulary", commit));
      assert.equal(found.commit, commit);
      assert.equal(found.iri, `${vocabulary}/tree/${commit}/`);
    });

    it("rejects, naming it, a repository the package does not carry", async () => {
      await assert.rejects(
        components.resolve({
          repository: "https://example.org/cascade-adapter",
        }),
        /cascade-adapter/,
      );
    });

    it("rejects a bundled Bridge built from another commit than the one recorded", async () => {
      await assert.rejects(components.bridge(), /build-0 at 0\b.*from 1$/);
    });
  });
});
