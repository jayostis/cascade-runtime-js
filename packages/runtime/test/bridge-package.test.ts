import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  keptPick,
  latestBuild,
  pickBuild,
  type Pull,
  readerOf,
  type Run,
  runOf,
} from "../src/node/bridge-build.js";
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

async function commit(folder: string, message: string): Promise<string> {
  await git(
    folder,
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
  return (await git(folder, "rev-parse", "HEAD")).trim();
}

/** A cascade-bridge-rs whose `main` has its second commit built, with `alpha/naming` built, `unbuilt`, and two pull request heads, one built. */
async function bridgeOrigin(root: string) {
  const origin = join(root, "jayostis", "cascade-bridge-rs");
  await mkdir(origin, { recursive: true });
  await git(origin, "init", "--quiet", "--initial-branch=main");
  const one = await commit(origin, "one");
  const two = await commit(origin, "two");
  await commit(origin, "three");
  const branch = async (name: string, built: boolean): Promise<string> => {
    await git(origin, "checkout", "--quiet", "-b", name, one);
    const head = await commit(origin, name);
    if (built) await git(origin, "tag", `build-${head}`, head);
    return head;
  };
  const naming = await branch("alpha/naming", true);
  await branch("unbuilt", false);
  const built = await branch("pull-built", true);
  const unbuilt = await branch("pull-unbuilt", false);
  await git(origin, "checkout", "--quiet", "main");
  await git(origin, "tag", `build-${two}`, two);
  return { url: pathToFileURL(origin).href, two, naming, built, unbuilt };
}

const RUNTIME = "jayostis/cascade-runtime-js";
const BRIDGE = "jayostis/cascade-bridge-rs";
const OTHER = "jayostis/cascade-vocabulary";

function pull(
  path: string,
  fields: {
    base?: string;
    body?: string;
    head?: string;
    state?: string;
    merged?: boolean;
    from?: string;
  } = {},
): Pull {
  return {
    body: fields.body ?? "",
    state: fields.state ?? "open",
    merged: fields.merged ?? false,
    base: { ref: fields.base ?? "main", repo: { full_name: path } },
    head: { sha: fields.head ?? "", repo: { full_name: fields.from ?? path } },
  };
}

function reader(pulls: Readonly<Record<string, Pull>>) {
  return (path: string, number: number): Promise<Pull> => {
    const found = pulls[`${path}/pull/${number}`];
    return found === undefined
      ? Promise.reject(new Error(`no ${path}/pull/${number}`))
      : Promise.resolve(found);
  };
}

const named = (...labels: string[]): string =>
  labels.map((label) => `Depends-On: https://github.com/${label}`).join("\n");

test("the Bridge's build is picked as a counterpart is: a pull request reached by Depends-On: lines at its head, else the branch named like the run's at its head, else the newest build of the default branch, which is also the pick outside CI", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-pick-"));
  const bridge = await bridgeOrigin(root);
  const onPull: Run = { repository: RUNTIME, number: 1, branch: "" };
  const cases: [string, Run | undefined, Record<string, Pull>, string][] = [
    ["outside CI", undefined, {}, bridge.two],
    [
      "named by a named pull request",
      onPull,
      {
        [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
          body: `Why.\n${named(`${OTHER}/pull/2`)}\n`,
        }),
        [`${OTHER}/pull/2`]: pull(OTHER, { body: named(`${BRIDGE}/pull/7`) }),
        [`${BRIDGE}/pull/7`]: pull(BRIDGE, { head: bridge.built }),
      },
      bridge.built,
    ],
    [
      "an unreadable one elsewhere passed over, and paths matched whatever their case",
      onPull,
      {
        [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
          body: named(`${OTHER}/pull/3`, "Jayostis/Cascade-Bridge-RS/pull/7"),
        }),
        "Jayostis/Cascade-Bridge-RS/pull/7": pull(BRIDGE, {
          head: bridge.built,
          from: "JAYOSTIS/cascade-bridge-rs",
        }),
      },
      bridge.built,
    ],
    [
      "named but merged, so the branch named like the target",
      onPull,
      {
        [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
          base: "alpha/naming",
          body: named(`${BRIDGE}/pull/8`),
        }),
        [`${BRIDGE}/pull/8`]: pull(BRIDGE, {
          state: "closed",
          merged: true,
          head: bridge.unbuilt,
        }),
      },
      bridge.naming,
    ],
    [
      "a push to a branch both have",
      { repository: RUNTIME, branch: "alpha/naming" },
      {},
      bridge.naming,
    ],
    [
      "the default branch the target",
      onPull,
      { [`${RUNTIME}/pull/1`]: pull(RUNTIME) },
      bridge.two,
    ],
    [
      "a target the Bridge has no branch of",
      onPull,
      { [`${RUNTIME}/pull/1`]: pull(RUNTIME, { base: "elsewhere" }) },
      bridge.two,
    ],
  ];
  for (const [said, run, pulls, expected] of cases)
    assert.equal(
      (await pickBuild(bridge.url, join(root, "at"), run, reader(pulls)))
        .commit,
      expected,
      said,
    );
});

test("a picked Bridge with no build, two named, one closed unmerged, one from a fork, one unreadable, or a line naming no pull request stops the run, saying why", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-refused-"));
  const bridge = await bridgeOrigin(root);
  const refused: [Run, Record<string, Pull>, RegExp, string?][] = [
    [
      { repository: RUNTIME, branch: "unbuilt" },
      {},
      /no build-\w+ release for the head of its branch unbuilt/,
    ],
    [
      { repository: RUNTIME, number: 1, branch: "" },
      { [`${BRIDGE}/pull/9`]: pull(BRIDGE, { head: bridge.unbuilt }) },
      /no build-\w+ release for the head of jayostis\/cascade-bridge-rs\/pull\/9/,
    ],
    [
      { repository: RUNTIME, number: 1, branch: "" },
      { [`${BRIDGE}/pull/9`]: pull(BRIDGE, { state: "closed" }) },
      /pull\/9 is closed without merging/,
    ],
    [
      { repository: RUNTIME, number: 1, branch: "" },
      {
        [`${BRIDGE}/pull/9`]: pull(BRIDGE, {
          head: bridge.built,
          from: "someone/cascade-bridge-rs",
        }),
      },
      /pull\/9 is from someone\/cascade-bridge-rs/,
    ],
    [
      { repository: RUNTIME, number: 1, branch: "" },
      {
        [`${BRIDGE}/pull/9`]: pull(BRIDGE, { head: bridge.built }),
        [`${BRIDGE}/pull/10`]: pull(BRIDGE, { head: bridge.built }),
      },
      /pull\/9 and .*pull\/10 are named/,
    ],
    [
      { repository: RUNTIME, number: 1, branch: "" },
      {},
      /pull\/9 could not be read, so nothing says which build/,
      named(`${BRIDGE}/pull/9`),
    ],
    [
      { repository: RUNTIME, number: 1, branch: "" },
      {},
      /Depends-On: #9 names no pull request/,
      "Depends-On: #9",
    ],
  ];
  for (const [run, pulls, reason, body] of refused)
    await assert.rejects(
      pickBuild(
        bridge.url,
        join(root, "at"),
        run,
        reader({
          [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
            body: body ?? named(...Object.keys(pulls)),
          }),
          ...pulls,
        }),
      ),
      reason,
    );
});

test("a pick kept for this run's attempt and repository is read without asking anything; one kept for another attempt or repository is not", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-kept-"));
  const bridge = await bridgeOrigin(root);
  const at = join(root, "at");
  await mkdir(at, { recursive: true });
  const run: Run = { repository: RUNTIME, number: 1, branch: "" };
  const env = { GITHUB_RUN_ID: "5", GITHUB_RUN_ATTEMPT: "2" };
  const asked = (): Promise<Pull> => Promise.reject(new Error("asked"));
  const keep = (attempt: string, repository: string) =>
    writeFile(
      join(at, "picked.json"),
      JSON.stringify({ attempt, repository, commit: "k", how: "kept" }),
    );
  await keep("5.2", bridge.url);
  assert.deepEqual(await keptPick(bridge.url, at, run, env, asked), {
    commit: "k",
    how: "kept, as the first pick of this run kept it",
  });
  for (const [attempt, repository] of [
    ["5.1", bridge.url],
    ["5.2", BRIDGE_REPOSITORY],
  ] as const) {
    await keep(attempt, repository);
    await assert.rejects(keptPick(bridge.url, at, run, env, asked), /asked/);
  }
});

test("a run in CI is the repository, the event's pull request and the branch GitHub Actions names; a push has no pull request, and outside CI there is no run", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-run-"));
  const event = join(root, "event.json");
  const ci = {
    CI: "true",
    GITHUB_REPOSITORY: RUNTIME,
    GITHUB_REF_NAME: "12/merge",
    GITHUB_EVENT_PATH: event,
  };
  await writeFile(event, JSON.stringify({ pull_request: { number: 12 } }));
  assert.deepEqual(runOf(ci), {
    repository: RUNTIME,
    number: 12,
    branch: "12/merge",
  });
  await writeFile(event, JSON.stringify({ ref: "refs/heads/main" }));
  assert.deepEqual(runOf({ ...ci, GITHUB_REF_NAME: "main" }), {
    repository: RUNTIME,
    branch: "main",
  });
  assert.equal(runOf({ ...ci, CI: undefined }), undefined);
});

test("with no token, the pull request under test is the event's and the others the ones the compatibility tooling handed in, so the pick asks GitHub's API nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-tokenless-"));
  const bridge = await bridgeOrigin(root);
  const event = join(root, "event.json");
  const handed = join(root, "pull-requests.json");
  const env = {
    CI: "true",
    GITHUB_REPOSITORY: RUNTIME,
    GITHUB_EVENT_PATH: event,
    GITHUB_API_URL: "http://127.0.0.1:9",
  };
  const pick = (more: Record<string, string> = {}) =>
    pickBuild(
      bridge.url,
      join(root, "at"),
      runOf({ ...env, ...more }),
      readerOf({ ...env, ...more }),
    );
  await writeFile(
    event,
    JSON.stringify({ pull_request: { number: 1, ...pull(RUNTIME) } }),
  );
  assert.equal((await pick()).commit, bridge.two);

  await writeFile(
    event,
    JSON.stringify({
      pull_request: {
        number: 1,
        ...pull(RUNTIME, { body: named(`${OTHER}/pull/2`) }),
      },
    }),
  );
  await writeFile(
    handed,
    JSON.stringify({
      [`${OTHER}/pull/2`]: pull(OTHER, { body: named(`${BRIDGE}/pull/7`) }),
      [`${BRIDGE}/pull/7`.toUpperCase()]: pull(BRIDGE, { head: bridge.built }),
    }),
  );
  assert.equal(
    (await pick({ CASCADE_PULL_REQUESTS: handed })).commit,
    bridge.built,
  );
  await writeFile(
    event,
    JSON.stringify({
      pull_request: {
        number: 1,
        ...pull(RUNTIME, { body: named(`${BRIDGE}/pull/2`) }),
      },
    }),
  );
  await writeFile(handed, JSON.stringify({ [`${BRIDGE}/pull/2`]: null }));
  await assert.rejects(
    pick({ CASCADE_PULL_REQUESTS: handed }),
    /the compatibility tooling could not read/,
  );
});

test("a checkout with no build of itself is read at the release of its commit, and stops the run while it holds uncommitted files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-checkout-"));
  const bridge = await bridgeOrigin(root);
  const sibling = join(root, "siblings", "cascade-bridge-rs");
  await git(root, "clone", "--quiet", bridge.url, sibling);
  await git(sibling, "checkout", "--quiet", "--detach", bridge.two);
  const cache = join(root, "cache");
  const release = join(cache, "cascade-bridge-rs", `build-${bridge.two}`);
  await mkdir(release, { recursive: true });
  await writeFile(
    join(release, "package.json"),
    JSON.stringify({
      cascadeBridge: { commit: bridge.two, dirty: false, sources: "x" },
    }),
  );
  const lines: string[] = [];
  const options = {
    siblingsIn: [join(root, "siblings")],
    cache,
    log: (said: string) => lines.push(said),
  };
  const used = await findBridgePackage(options, bridge.url);
  assert.deepEqual(
    [used.source, used.commit, used.release],
    ["release", bridge.two, `build-${bridge.two}`],
  );
  assert.match(lines.join("\n"), /, the commit .* is at; .* holds no build$/);

  await writeFile(join(sibling, "edited.rs"), "");
  await assert.rejects(
    findBridgePackage(options, bridge.url),
    /holds no build, and its 1 uncommitted files are in no release/,
  );
});
