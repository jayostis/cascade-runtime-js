import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/plan.js";
import {
  checkKept,
  cloneAt,
  type Environment,
  pinnedPod,
  resolvePins,
  runtimeRoot,
} from "../src/pinned.js";
import { mcpServer } from "../src/pod-client.js";

test("a pinned run pins the runtime and only the repositories the pod arm depends on, each at a commit", async () => {
  const { pins } = await loadConfig("baseline-pre-w3");
  assert.deepEqual(resolvePins(pins!), {
    "cascade-vocabulary": "f1ab8ed",
    "cascade-bridge-adapter-fhir-r4": "f0c1bc6",
    "cascade-bridge-adapter-ccda": "0429600",
    "cascade-bridge-rs": "b4047ec",
    "cascade-bridge-spec": "cefce33",
    "cascade-runtime-js": "bdd39e5",
  });
  assert.throws(
    () => resolvePins({ "cascade-vocabulary": "f1ab8ed" }),
    /pins cascade-runtime-js/,
  );
  assert.throws(
    () =>
      resolvePins({
        "cascade-runtime-js": "bdd39e5",
        "cascade-site": "abc1234",
      }),
    /cascade-site is no repository a run pins/,
  );
});

test("a pinned runtime runs in its own checkout, so it reads its own cascade-runtime.json, never the one where the harness runs", async () => {
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

test("a pinned clone keeps long paths on, so the runtime and git see every file of it", async () => {
  const root = await mkdtemp(join(tmpdir(), "cascade-evals-clone-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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
    const commit = git(source, "rev-parse", "HEAD");
    cloneAt(root, "clone", source, commit);
    assert.equal(
      git(join(root, "clone"), "config", "--local", "--get", "core.longpaths"),
      "true",
    );
    // a kept environment's clone that lost the setting gets it back before it is checked, and a changed one is refused
    git(join(root, "clone"), "config", "--local", "--unset", "core.longpaths");
    checkKept(root, { clone: commit });
    assert.equal(
      git(join(root, "clone"), "config", "--local", "--get", "core.longpaths"),
      "true",
    );
    await writeFile(join(root, "clone", "a.txt"), "changed\n");
    assert.throws(() => checkKept(root, { clone: commit }), /no longer clone/);
    assert.equal(git(join(root, "clone"), "rev-parse", "HEAD"), commit);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("a pinned build's cascade-mcp starts in its own checkout, and this checkout's where the harness runs", () => {
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
  assert.equal(
    mcpServer({ mcp, pods: "pods" }).cwd,
    join("C:", "pinned", "cascade-runtime-js"),
  );
  assert.equal(runtimeRoot(mcp), join("C:", "pinned", "cascade-runtime-js"));
  assert.equal("cwd" in mcpServer({ pods: "pods" }), false);
});
