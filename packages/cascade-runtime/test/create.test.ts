import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { agentPrompt, create, type Terminal } from "../src/create.js";

const ADDRESS =
  "https://example.org/releases/download/build-0/cascade-runtime-0.0.0.tgz";

let parent: string;

before(async () => {
  parent = await mkdtemp(join(tmpdir(), "create-cascade-app-"));
});

after(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** A terminal that keeps what is written and records each install, which does nothing. */
function recording(): Terminal & {
  readonly installs: string[];
  text(): string;
} {
  const written: string[] = [];
  const installs: string[] = [];
  return {
    out: (text) => written.push(text),
    err: (text) => written.push(text),
    install: async (folder) => {
      installs.push(folder);
      return true;
    },
    installs,
    text: () => written.join(""),
  };
}

test("given a folder, it makes the project and names it", async () => {
  const folder = join(parent, "my-app");
  const terminal = recording();
  assert.equal(await create([folder, "--tarball", ADDRESS], terminal), 0);

  const manifest = JSON.parse(
    await readFile(join(folder, "package.json"), "utf8"),
  ) as { name: string; dependencies: Record<string, string> };
  assert.equal(manifest.name, "my-app");
  assert.equal(manifest.dependencies["cascade-runtime"], ADDRESS);
  const ignored = (await readFile(join(folder, ".gitignore"), "utf8")).split(
    /\r?\n/,
  );
  assert.ok(ignored.includes("pods/"), ".gitignore does not list pods/");
  assert.equal(existsSync(join(folder, "pods")), false, "the app has a pod");
  assert.deepEqual(terminal.installs, [folder]);
  for (const line of [
    "npm run pod:load alex-rivera",
    "npm start",
    agentPrompt(folder, ADDRESS),
  ])
    assert.ok(terminal.text().includes(line), `it did not print ${line}`);
});

test("it refuses a folder it cannot use and writes nothing", async () => {
  const taken = join(parent, "taken");
  await mkdir(taken);
  await writeFile(join(taken, "notes.txt"), "mine");
  const before = await readdir(parent, { recursive: true });
  const refusals: [string, string[], RegExp][] = [
    ["a folder holding a file", [taken, "--tarball", ADDRESS], /not empty/],
    [
      "a name with a capital letter",
      [join(parent, "My-app"), "--tarball", ADDRESS],
      /no project name/,
    ],
    [
      "a name with a space",
      [join(parent, "my app"), "--tarball", ADDRESS],
      /no project name/,
    ],
    ["no address known", [join(parent, "app")], /no address/],
  ];
  for (const [what, args, reason] of refusals) {
    const terminal = recording();
    assert.equal(await create(args, terminal), 2, what);
    assert.match(terminal.text(), reason, what);
    assert.deepEqual(terminal.installs, [], what);
    assert.deepEqual(await readdir(parent, { recursive: true }), before, what);
  }
});

test("with no folder and no terminal it asks nothing", async () => {
  const bin = fileURLToPath(new URL("../src/create-cli.js", import.meta.url));
  const started = Date.now();
  const { code, stderr } = await new Promise<{
    code: number | null;
    stderr: string;
  }>((done) => {
    const child = execFile(
      process.execPath,
      [bin],
      { timeout: 5000 },
      (_, __, stderr) => done({ code: child.exitCode, stderr }),
    );
  });
  assert.equal(code, 2);
  assert.match(stderr, /usage: create-cascade-app <folder>/);
  assert.ok(Date.now() - started < 1000, "it took a second or more");
});
