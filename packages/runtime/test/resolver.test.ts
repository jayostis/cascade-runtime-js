import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { checkout, git } from "../src/node/git.js";
import { type ResolverOptions, resolve } from "../src/node/resolver.js";

let root: string;
let commit: string;
let repository: string;

async function repositoryAt(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  await git(folder, "init", "--quiet");
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
  commit = await repositoryAt(join(root, "published", "cascade-vocabulary"));
  repository = pathToFileURL(
    join(root, "published", "cascade-vocabulary"),
  ).href;
});

async function resolved(options: Omit<ResolverOptions, "log">) {
  const lines: string[] = [];
  const found = await resolve(
    { repository, commit },
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
    siblingsIn: siblings,
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
    siblingsIn: join(root, "no-siblings"),
    folders: new Map([[repository, handedIn]]),
    cache: join(root, "cache"),
  });
  assert.equal(found.source, "folder");
  assert.equal(found.folder, handedIn);
  assert.match(
    said,
    /^cascade-vocabulary: the folder handed in, .* \(the pin\) with no uncommitted changes$/,
  );
});

test("otherwise the pin is fetched at its commit into the cache, and the run says so", async () => {
  const { found, said } = await resolved({
    siblingsIn: join(root, "no-siblings"),
    cache: join(root, "cache"),
  });
  assert.equal(found.source, "pin");
  assert.equal(found.folder, join(root, "cache", "cascade-vocabulary", commit));
  assert.equal(found.iri, `${repository}/tree/${commit}/`);
  assert.equal((await checkout(found.folder))?.commit, commit);
  assert.ok(existsSync(join(found.folder, "rules.md")));
  assert.match(
    said,
    /^cascade-vocabulary: the pin, [0-9a-f]{12}, fetched into /,
  );
});
