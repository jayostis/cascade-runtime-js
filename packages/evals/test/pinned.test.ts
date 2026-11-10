import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { REPLY_QUESTIONS } from "cascade-runtime";
import type { Prepared } from "../src/cases.js";
import {
  askerOf,
  checkKept,
  cloneAt,
  type Environment,
  PINNABLE,
  pinnedPod,
  resolvePins,
  runtimeRoot,
} from "../src/pinned.js";
import { mcpServer } from "../src/pod-client.js";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/**
 * A config's `pins` names a commit for each repository the pod arm depends on, so an eval can be run again on the code of
 * an earlier day. The pinned runtime is cloned and built apart, and everything it does runs in its own checkout.
 */
describe("Running the pod arm at pinned commits · resolvePins(), cloneAt(), checkKept(), pinnedPod(), askerOf()", () => {
  let root: string;
  let source: string;
  let commit: string;

  /** A repository of one commit, which `cloneAt` and `checkKept` clone into folders of their own beside it. */
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "cascade-evals-clone-"));
    source = join(root, "source");
    await mkdir(source);
    git(source, "init", "--quiet");
    await writeFile(join(source, "a.txt"), "a\n");
    git(source, "add", "a.txt");
    git(
      source,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--quiet",
      "-m",
      "a",
    );
    commit = git(source, "rev-parse", "HEAD");
  });

  after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

  describe("resolvePins(pins)", () => {
    it("returns each repository's pin", () => {
      const pins = Object.fromEntries(
        Object.keys(PINNABLE).map((name, at) => [name, `abc123${at}`]),
      );
      assert.deepEqual(resolvePins(pins), pins);
    });

    it("refuses pins that leave out cascade-runtime-js", () => {
      assert.throws(
        () => resolvePins({ "cascade-vocabulary": "f1ab8ed" }),
        /pins cascade-runtime-js/,
      );
    });

    it("refuses a repository that no run pins, naming it", () => {
      assert.throws(
        () =>
          resolvePins({
            "cascade-runtime-js": "bdd39e5",
            "cascade-site": "abc1234",
          }),
        /cascade-site is no repository a run pins/,
      );
    });
  });

  describe("cloneAt(folder, name, source, pin)", () => {
    it("turns `core.longpaths` on in the clone", () => {
      cloneAt(root, "cloned", source, commit);
      assert.equal(
        git(
          join(root, "cloned"),
          "config",
          "--local",
          "--get",
          "core.longpaths",
        ),
        "true",
      );
    });
  });

  describe("checkKept(folder, commits)", () => {
    let longpaths: string;
    let thrown: Error | undefined;
    let head: string;

    before(async () => {
      const kept = join(root, "kept");
      cloneAt(root, "kept", source, commit);
      git(kept, "config", "--local", "--unset", "core.longpaths");
      checkKept(root, { kept: commit });
      longpaths = git(kept, "config", "--local", "--get", "core.longpaths");
      await writeFile(join(kept, "a.txt"), "changed\n");
      try {
        checkKept(root, { kept: commit });
      } catch (error) {
        thrown = error as Error;
      }
      head = git(kept, "rev-parse", "HEAD");
    });

    it("turns `core.longpaths` back on in a kept clone that lost it", () => {
      assert.equal(longpaths, "true");
    });

    it("refuses a kept clone whose files were changed, naming it", () => {
      assert.match(thrown?.message ?? "", /pinned clone .*kept is no longer/);
    });

    it("leaves the changed clone at its commit", () => {
      assert.equal(head, commit);
    });
  });

  describe("pinnedPod(environment, command, pod, questions)", () => {
    it("runs the pinned runtime in its own checkout, whatever folder the harness runs in", async () => {
      const root = await mkdtemp(join(tmpdir(), "cascade-evals-pinned-"));
      try {
        const index = join(
          root,
          "packages",
          "cascade-runtime",
          "dist",
          "src",
          "index.js",
        );
        await mkdir(dirname(index), { recursive: true });
        // A stand-in for an older runtime build: its pod answers each question with the folder it runs in.
        await writeFile(
          index,
          "export const configureTables = () => undefined;\n" +
            "export const openPod = async () => ({ ask: async () => process.cwd(), close: async () => undefined });\n",
        );
        const rows = pinnedPod(
          { runtime: index } as Environment,
          "ask",
          join(root, "pod"),
          ["pod/My lab results"],
        );
        assert.deepEqual(rows, { "pod/My lab results": root });
      } finally {
        await rm(root, { recursive: true, force: true, maxRetries: 5 });
      }
    });
  });

  describe("mcpServer({ mcp, pods })", () => {
    const mcp = join(
      "C:",
      "pinned",
      "cascade-runtime-js",
      "packages",
      "mcp",
      "dist",
      "src",
      "cli.js",
    );

    it("returns a server that runs in the pinned runtime's own checkout", () => {
      assert.equal(
        mcpServer({ mcp, pods: "pods" }).cwd,
        join("C:", "pinned", "cascade-runtime-js"),
      );
      assert.equal(
        runtimeRoot(mcp),
        join("C:", "pinned", "cascade-runtime-js"),
      );
    });

    it("returns a server with no folder of its own for the harness's own `cascade-mcp`, so it runs where the harness does", () => {
      assert.equal("cwd" in mcpServer({ pods: "pods" }), false);
    });
  });

  describe("given a pinned run (`askerOf()`)", () => {
    let starts: number;
    let asked: readonly string[];
    let reader: Awaited<ReturnType<typeof askerOf>>;

    before(async () => {
      starts = 0;
      asked = [];
      const answers = { "entry/What it shows": [{ entry: "x" }] };
      reader = await askerOf(
        { runtime: "built/runtime", pods: "pods", pod: "p" } as Prepared,
        ((_env, _command, _pod, questions) => {
          starts += 1;
          asked = questions;
          return answers;
        }) as typeof pinnedPod,
      );
    });

    it("asks the pinned runtime every question the checks read, in one start of it", () => {
      assert.equal(starts, 1);
      assert.deepEqual(
        [...asked].sort(),
        [...REPLY_QUESTIONS].sort(),
        "the list handed to the pinned call",
      );
      for (const question of [
        "entry/What it shows",
        "pod/The person this pod is about",
        "entry/Where it came from",
        "pod/My lab results",
      ])
        assert.ok(asked.includes(question), question);
    });

    it("answers a question from what the pinned runtime returned", async () => {
      assert.deepEqual(await reader.ask("entry/What it shows"), [
        { entry: "x" },
      ]);
    });
  });
});
