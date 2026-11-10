import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
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

type Bridge = Awaited<ReturnType<typeof bridgeOrigin>>;

let shared: Promise<Bridge> | undefined;

/** One cascade-bridge-rs for the file, made when a leaf first needs it and only read after: a clone and a pick read it, none writes to it. */
function sharedBridge(): Promise<Bridge> {
  shared ??= mkdtemp(join(tmpdir(), "bridge-origin-")).then(bridgeOrigin);
  return shared;
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

/**
 * A run from a checkout of this repository loads the Bridge from a package compiled in a checkout of cascade-bridge-rs
 * beside it, or in one handed in, when that package was compiled from the checkout's files as they are; otherwise it
 * downloads the package published for the checkout's commit. It logs which one it took and why it passed another over,
 * so a result can be traced to the Bridge it ran on.
 *
 * An installed app loads the Bridge its package carries (`packed()`), and runs none of this.
 */
describe("The Bridge package a run from a checkout uses · findBridgePackage()", () => {
  /** What `findBridgePackage` returns for the sibling folder and the checkout handed in, with the lines it logs. */
  const found = async (root: string, siblings: string, handedIn?: string) => {
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

  describe("given a sibling checkout whose package was compiled from its files as they are", () => {
    let fresh: string;
    let used: Awaited<ReturnType<typeof found>>;
    before(async () => {
      const root = await mkdtemp(join(tmpdir(), "bridge-package-"));
      fresh = await checkout(
        join(root, "fresh", "cascade-bridge-rs"),
        "sha256-built",
      );
      used = await found(root, join(root, "fresh"));
    });

    it("returns the sibling's package folder and the commit it records, with `source` `sibling`", () => {
      assert.deepEqual(
        [used.source, used.folder, used.commit],
        ["sibling", fresh, "c".repeat(40)],
      );
    });

    it("logs that the package has uncommitted changes when it records them", () => {
      assert.match(
        used.said,
        /the sibling checkout's build .* with uncommitted changes$/,
      );
    });
  });

  describe("given a sibling checkout whose package was compiled from other files than it holds now, and a checkout handed in whose package was compiled from its files as they are", () => {
    let fresh: string;
    let handed: Awaited<ReturnType<typeof found>>;
    before(async () => {
      const root = await mkdtemp(join(tmpdir(), "bridge-package-"));
      fresh = await checkout(
        join(root, "fresh", "cascade-bridge-rs"),
        "sha256-built",
      );
      await checkout(join(root, "stale", "cascade-bridge-rs"), "sha256-edited");
      handed = await found(
        root,
        join(root, "stale"),
        join(root, "fresh", "cascade-bridge-rs"),
      );
    });

    it("returns the handed-in checkout's package folder, with `source` `folder`", () => {
      assert.deepEqual([handed.source, handed.folder], ["folder", fresh]);
    });

    it("logs that the sibling's package is stale", () => {
      assert.match(handed.said, /is stale/);
    });
  });

  /** A clone of the Bridge's origin detached at its second commit, as a sibling, and a cache holding that commit's published package. */
  async function siblingWithoutPackage(bridge: Bridge) {
    const root = await mkdtemp(join(tmpdir(), "bridge-checkout-"));
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
    return {
      sibling,
      lines,
      options: {
        siblingsIn: [join(root, "siblings")],
        cache,
        log: (said: string) => lines.push(said),
      },
    };
  }

  describe("given a sibling checkout with no package and nothing uncommitted", () => {
    let bridge: Bridge;
    let used: Awaited<ReturnType<typeof findBridgePackage>>;
    let lines: string[];
    before(async () => {
      bridge = await sharedBridge();
      const clone = await siblingWithoutPackage(bridge);
      lines = clone.lines;
      used = await findBridgePackage(clone.options, bridge.url);
    });

    it("returns the package published for the commit the checkout is at, with `source` `release`", () => {
      assert.deepEqual(
        [used.source, used.commit, used.release],
        ["release", bridge.two, `build-${bridge.two}`],
      );
    });

    it("logs the commit and that the checkout holds no package", () => {
      assert.match(
        lines.join("\n"),
        /, the commit .* is at; .* holds no build$/,
      );
    });
  });

  describe("given a sibling checkout with no package and an uncommitted file", () => {
    it("rejects, saying how many uncommitted files are in no published package", async () => {
      const bridge = await sharedBridge();
      const { sibling, options } = await siblingWithoutPackage(bridge);
      await writeFile(join(sibling, "edited.rs"), "");
      await assert.rejects(
        findBridgePackage(options, bridge.url),
        /holds no build, and its 1 uncommitted files are in no release/,
      );
    });
  });
});

/**
 * cascade-bridge-rs publishes a package, tagged `build-<commit>`, for every commit of its default branch and for the
 * latest commit of each PR from itself. A CI run of the runtime picks one: the Bridge PR its own PR names on a
 * `Depends-On:` line, else the Bridge's branch named like the run's, else the newest on the default branch.
 */
describe("Picking the Bridge package for a CI run · pickBuild(), latestBuild(), keptPick(), runOf(), readerOf()", () => {
  describe("latestBuild(repository, at)", () => {
    let two: string;
    let three: string;
    let atTwo: string;
    let afterThreeIsPublished: string;
    let atThree: string;
    before(async () => {
      const root = await mkdtemp(join(tmpdir(), "bridge-build-"));
      const origin = join(root, "cascade-bridge-rs");
      await mkdir(origin);
      await git(origin, "init", "--quiet", "--initial-branch=main");
      await commit(origin, "one");
      two = await commit(origin, "two");
      three = await commit(origin, "three");
      await git(origin, "tag", `build-${two}`, two);
      const repository = pathToFileURL(origin).href;

      atTwo = await latestBuild(repository, join(root, "at"));
      await git(origin, "tag", `build-${three}`, three);
      afterThreeIsPublished = await latestBuild(repository, join(root, "at"));
      const later = join(root, "later", "cascade-bridge-rs");
      await cp(origin, later, { recursive: true });
      atThree = await latestBuild(pathToFileURL(later).href, join(root, "at"));
    });

    it("returns the nearest commit before the default branch's latest that has a published package, while the latest has none", () => {
      assert.equal(atTwo, two);
    });

    it("returns the same commit for the rest of the process, though the latest commit's package is published since", () => {
      assert.equal(afterThreeIsPublished, two);
    });

    it("returns the default branch's latest commit when it has a published package", () => {
      assert.equal(atThree, three);
    });
  });

  describe("pickBuild(repository, at, run, read)", () => {
    const onPull: Run = { repository: RUNTIME, number: 1, branch: "" };
    interface Case {
      readonly leaf: string;
      readonly run: Run | undefined;
      readonly pulls: (bridge: Bridge) => Record<string, Pull>;
      readonly expected: (bridge: Bridge) => string;
    }
    const cases: Case[] = [
      {
        leaf: "picks the default branch's newest published package outside CI",
        run: undefined,
        pulls: () => ({}),
        expected: (bridge) => bridge.two,
      },
      {
        leaf: "picks the latest commit of the open Bridge PR that `Depends-On:` lines reach from the run's PR through a PR of another repository",
        run: onPull,
        pulls: (bridge) => ({
          [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
            body: `Why.\n${named(`${OTHER}/pull/2`)}\n`,
          }),
          [`${OTHER}/pull/2`]: pull(OTHER, {
            body: named(`${BRIDGE}/pull/7`),
          }),
          [`${BRIDGE}/pull/7`]: pull(BRIDGE, { head: bridge.built }),
        }),
        expected: (bridge) => bridge.built,
      },
      {
        leaf: "matches the repository on a `Depends-On:` line whatever its case",
        run: onPull,
        pulls: (bridge) => ({
          [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
            body: named("Jayostis/Cascade-Bridge-RS/pull/7"),
          }),
          "Jayostis/Cascade-Bridge-RS/pull/7": pull(BRIDGE, {
            head: bridge.built,
            from: "JAYOSTIS/cascade-bridge-rs",
          }),
        }),
        expected: (bridge) => bridge.built,
      },
      {
        leaf: "passes over a named PR of another repository that cannot be read, and follows a later one that can",
        run: onPull,
        pulls: (bridge) => ({
          [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
            body: named(`${OTHER}/pull/3`, `${OTHER}/pull/2`),
          }),
          [`${OTHER}/pull/2`]: pull(OTHER, {
            body: named(`${BRIDGE}/pull/7`),
          }),
          [`${BRIDGE}/pull/7`]: pull(BRIDGE, { head: bridge.built }),
        }),
        expected: (bridge) => bridge.built,
      },
      {
        leaf: "picks the Bridge's branch named like the run's target branch when the named Bridge PR is merged",
        run: onPull,
        pulls: (bridge) => ({
          [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
            base: "alpha/naming",
            body: named(`${BRIDGE}/pull/8`),
          }),
          [`${BRIDGE}/pull/8`]: pull(BRIDGE, {
            state: "closed",
            merged: true,
            head: bridge.unbuilt,
          }),
        }),
        expected: (bridge) => bridge.naming,
      },
      {
        leaf: "picks the Bridge's branch named like the branch a push is on",
        run: { repository: RUNTIME, branch: "alpha/naming" },
        pulls: () => ({}),
        expected: (bridge) => bridge.naming,
      },
      {
        leaf: "picks the default branch's newest published package when the run's PR targets the default branch",
        run: onPull,
        pulls: () => ({ [`${RUNTIME}/pull/1`]: pull(RUNTIME) }),
        expected: (bridge) => bridge.two,
      },
      {
        leaf: "picks the default branch's newest published package when the Bridge has no branch named like the target",
        run: onPull,
        pulls: () => ({
          [`${RUNTIME}/pull/1`]: pull(RUNTIME, { base: "elsewhere" }),
        }),
        expected: (bridge) => bridge.two,
      },
    ];
    let bridge: Bridge;
    let at: string;
    before(async () => {
      bridge = await sharedBridge();
      at = join(await mkdtemp(join(tmpdir(), "bridge-pick-")), "at");
    });

    for (const { leaf, run, pulls, expected } of cases)
      it(leaf, async () => {
        assert.equal(
          (await pickBuild(bridge.url, at, run, reader(pulls(bridge)))).commit,
          expected(bridge),
        );
      });
  });

  describe("when the pick cannot be used", () => {
    const onPull: Run = { repository: RUNTIME, number: 1, branch: "" };
    interface Refusal {
      readonly leaf: string;
      readonly run: Run;
      readonly pulls: (bridge: Bridge) => Record<string, Pull>;
      readonly reason: RegExp;
      /** The run's PR's description, when it is not the `Depends-On:` lines of `pulls`. */
      readonly body?: string;
    }
    const refusals: Refusal[] = [
      {
        leaf: "rejects a branch whose latest commit has no published package, naming the branch",
        run: { repository: RUNTIME, branch: "unbuilt" },
        pulls: () => ({}),
        reason: /no build-\w+ release for the head of its branch unbuilt/,
      },
      {
        leaf: "rejects a named Bridge PR whose latest commit has no published package, naming the PR",
        run: onPull,
        pulls: (bridge) => ({
          [`${BRIDGE}/pull/9`]: pull(BRIDGE, { head: bridge.unbuilt }),
        }),
        reason:
          /no build-\w+ release for the head of jayostis\/cascade-bridge-rs\/pull\/9/,
      },
      {
        leaf: "rejects a named Bridge PR closed without merging",
        run: onPull,
        pulls: () => ({
          [`${BRIDGE}/pull/9`]: pull(BRIDGE, { state: "closed" }),
        }),
        reason: /pull\/9 is closed without merging/,
      },
      {
        leaf: "rejects a named Bridge PR from a fork, naming the fork",
        run: onPull,
        pulls: (bridge) => ({
          [`${BRIDGE}/pull/9`]: pull(BRIDGE, {
            head: bridge.built,
            from: "someone/cascade-bridge-rs",
          }),
        }),
        reason: /pull\/9 is from someone\/cascade-bridge-rs/,
      },
      {
        leaf: "rejects two Bridge PRs named at once, naming both",
        run: onPull,
        pulls: (bridge) => ({
          [`${BRIDGE}/pull/9`]: pull(BRIDGE, { head: bridge.built }),
          [`${BRIDGE}/pull/10`]: pull(BRIDGE, { head: bridge.built }),
        }),
        reason: /pull\/9 and .*pull\/10 are named/,
      },
      {
        leaf: "rejects a named Bridge PR that cannot be read",
        run: onPull,
        pulls: () => ({}),
        reason: /pull\/9 could not be read, so nothing says which build/,
        body: named(`${BRIDGE}/pull/9`),
      },
      {
        leaf: "rejects a `Depends-On:` line that names no PR",
        run: onPull,
        pulls: () => ({}),
        reason: /Depends-On: #9 names no pull request/,
        body: "Depends-On: #9",
      },
    ];
    let bridge: Bridge;
    let at: string;
    before(async () => {
      bridge = await sharedBridge();
      at = join(await mkdtemp(join(tmpdir(), "bridge-refused-")), "at");
    });

    for (const { leaf, run, pulls, reason, body } of refusals)
      it(leaf, async () => {
        const picked = pulls(bridge);
        await assert.rejects(
          pickBuild(
            bridge.url,
            at,
            run,
            reader({
              [`${RUNTIME}/pull/1`]: pull(RUNTIME, {
                body: body ?? named(...Object.keys(picked)),
              }),
              ...picked,
            }),
          ),
          reason,
        );
      });
  });

  describe("keptPick(repository, at, run, env, read)", () => {
    const run: Run = { repository: RUNTIME, number: 1, branch: "" };
    const env = { GITHUB_RUN_ID: "5", GITHUB_RUN_ATTEMPT: "2" };
    const asked = (): Promise<Pull> => Promise.reject(new Error("asked"));
    let bridge: Bridge;
    let at: string;
    before(async () => {
      bridge = await sharedBridge();
      at = join(await mkdtemp(join(tmpdir(), "bridge-kept-")), "at");
      await mkdir(at, { recursive: true });
    });
    const keep = (attempt: string, repository: string) =>
      writeFile(
        join(at, "picked.json"),
        JSON.stringify({ attempt, repository, commit: "k", how: "kept" }),
      );

    it("returns the pick kept for this run's attempt and repository without reading a PR", async () => {
      await keep("5.2", bridge.url);
      assert.deepEqual(await keptPick(bridge.url, at, run, env, asked), {
        commit: "k",
        how: "kept, as the first pick of this run kept it",
      });
    });

    it("picks again when the kept pick is another attempt's", async () => {
      await keep("5.1", bridge.url);
      await assert.rejects(keptPick(bridge.url, at, run, env, asked), /asked/);
    });

    it("picks again when the kept pick is another repository's", async () => {
      await keep("5.2", BRIDGE_REPOSITORY);
      await assert.rejects(keptPick(bridge.url, at, run, env, asked), /asked/);
    });
  });

  describe("runOf(env)", () => {
    let event: string;
    let ci: Record<string, string>;
    before(async () => {
      event = join(await mkdtemp(join(tmpdir(), "bridge-run-")), "event.json");
      ci = {
        CI: "true",
        GITHUB_REPOSITORY: RUNTIME,
        GITHUB_REF_NAME: "12/merge",
        GITHUB_EVENT_PATH: event,
      };
    });

    it("returns the repository, the event's PR number and the branch GitHub Actions names, in CI", async () => {
      await writeFile(event, JSON.stringify({ pull_request: { number: 12 } }));
      assert.deepEqual(runOf(ci), {
        repository: RUNTIME,
        number: 12,
        branch: "12/merge",
      });
    });

    it("returns no PR number for a push", async () => {
      await writeFile(event, JSON.stringify({ ref: "refs/heads/main" }));
      assert.deepEqual(runOf({ ...ci, GITHUB_REF_NAME: "main" }), {
        repository: RUNTIME,
        branch: "main",
      });
    });

    it("returns undefined outside CI", () => {
      assert.equal(runOf({ ...ci, CI: undefined }), undefined);
    });
  });

  describe("given readerOf(env) with neither `GITHUB_TOKEN` nor `GH_TOKEN` set", () => {
    let bridge: Bridge;
    let event: string;
    let handed: string;
    let at: string;
    let env: Record<string, string>;
    before(async () => {
      bridge = await sharedBridge();
      const root = await mkdtemp(join(tmpdir(), "bridge-tokenless-"));
      event = join(root, "event.json");
      handed = join(root, "pull-requests.json");
      at = join(root, "at");
      env = {
        CI: "true",
        GITHUB_REPOSITORY: RUNTIME,
        GITHUB_EVENT_PATH: event,
        GITHUB_API_URL: "http://127.0.0.1:9",
      };
    });
    const pick = (more: Record<string, string> = {}) =>
      pickBuild(
        bridge.url,
        at,
        runOf({ ...env, ...more }),
        readerOf({ ...env, ...more }),
      );
    const eventOf = (body: string) =>
      writeFile(
        event,
        JSON.stringify({
          pull_request: { number: 1, ...pull(RUNTIME, { body }) },
        }),
      );

    it("reads the PR under test from the run's event, so a PR that names nothing asks GitHub's API nothing", async () => {
      await eventOf("");
      assert.equal((await pick()).commit, bridge.two);
    });

    it("reads every other PR from the file `CASCADE_PULL_REQUESTS` names, matching repositories whatever their case", async () => {
      await eventOf(named(`${OTHER}/pull/2`));
      await writeFile(
        handed,
        JSON.stringify({
          [`${OTHER}/pull/2`]: pull(OTHER, { body: named(`${BRIDGE}/pull/7`) }),
          [`${BRIDGE}/pull/7`.toUpperCase()]: pull(BRIDGE, {
            head: bridge.built,
          }),
        }),
      );
      assert.equal(
        (await pick({ CASCADE_PULL_REQUESTS: handed })).commit,
        bridge.built,
      );
    });

    it("rejects a named Bridge PR that the file `CASCADE_PULL_REQUESTS` marks as not read", async () => {
      await eventOf(named(`${BRIDGE}/pull/2`));
      await writeFile(handed, JSON.stringify({ [`${BRIDGE}/pull/2`]: null }));
      await assert.rejects(
        pick({ CASCADE_PULL_REQUESTS: handed }),
        /the compatibility tooling could not read/,
      );
    });
  });
});
