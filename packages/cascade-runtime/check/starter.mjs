// The starter, made by the command from an installed tarball and used as a person would, in a new folder under the
// current one. `node starter.mjs <tarball>` before a merge; `node starter.mjs --release <commit>` once that commit's
// release exists. Run from the repository after `npm ci` and `npm run build`.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { get } from "node:http";
import { dirname, join, relative, resolve } from "node:path";
import { argv, cwd, env, execPath, kill, platform, stdout } from "node:process";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import { featureStory, OxigraphStore } from "@cascade-runtime/runtime";
import { packed, vocabularyOf } from "@cascade-runtime/runtime/node";
import { tarballAddress } from "../dist/pack/address.js";
import { agentPrompt, startLine } from "../dist/src/create.js";

const KIT = "conformance/alex-rivera";
const ALLERGIES = "pod/My active allergies";
const REVIEW = "entry/What needs review";
const QUESTIONS = [ALLERGIES, REVIEW, "pod/How many judgments count"];
const IMPORTS = "pod/What each import brought in";
const STATUS = "https://ns.cascadeprotocol.org/clinical/v1#status";
const ALLERGEN = "https://ns.cascadeprotocol.org/health/v1#allergen";
const MINUTES = 60 * 1000;

const { values, positionals } = parseArgs({
  args: argv.slice(2),
  options: { release: { type: "string" } },
  allowPositionals: true,
});
const release = values.release;
const tarball =
  positionals[0] === undefined ? undefined : resolve(positionals[0]);
if ((release === undefined) === (tarball === undefined))
  throw new Error(
    "usage: node starter.mjs <tarball> | node starter.mjs --release <commit>",
  );

const work = await mkdtemp(join(cwd(), "starter-"));
const app = join(work, "my-app");

function npmScript(name) {
  const found = [
    join(dirname(execPath), "node_modules", "npm", "bin", name),
    join(dirname(execPath), "..", "lib", "node_modules", "npm", "bin", name),
  ].find((path) => existsSync(path));
  if (found === undefined) throw new Error(`no ${name} beside ${execPath}`);
  return found;
}
const NPM = npmScript("npm-cli.js");
const NPX = npmScript("npx-cli.js");

/** A command run to its end, its standard input a pipe never written, its output logged. */
function run(command, args, options = {}) {
  stdout.write(`\n$ ${[command, ...args].join(" ")}\n`);
  return new Promise((done, failed) => {
    const child = spawn(command, args, {
      cwd: app,
      timeout: 10 * MINUTES,
      ...options,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", failed);
    child.on("close", (code) => {
      stdout.write(
        `${out}${err === "" ? "" : `[stderr]\n${err}`}[exit ${code}]\n`,
      );
      done({ code, out, err });
    });
  });
}

const npm = (...args) => run(execPath, [NPM, ...args]);

/** The question's rows as `npm run ask` prints them. */
async function asked(question, pod) {
  const { code, out } = await npm(
    "run",
    "--silent",
    "ask",
    "--",
    ...(pod === undefined ? [] : ["--pod", pod]),
    question,
  );
  assert.equal(code, 0, `npm run ask "${question}" failed`);
  return out
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

function multiset(rows) {
  return rows.map((row) => JSON.stringify(Object.entries(row).sort())).sort();
}

function escaped(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fetched(url) {
  return new Promise((done, failed) => {
    get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () =>
        done({
          status: response.statusCode,
          location: response.headers.location,
          body,
        }),
      );
    }).on("error", failed);
  });
}

/** `npm start` on a port the system gives, with its address once it serves. */
async function started() {
  stdout.write("\n$ npm start (PORT=0)\n");
  const child = spawn(execPath, [NPM, "start"], {
    cwd: app,
    env: { ...env, PORT: "0" },
    detached: platform !== "win32",
  });
  let out = "";
  child.stderr.on("data", (chunk) => stdout.write(`[server] ${chunk}`));
  const address = await new Promise((done, failed) => {
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const found = /http:\/\/127\.0\.0\.1:\d+\//.exec(out);
      if (found !== null) done(found[0]);
    });
    child.on("close", (code) =>
      failed(new Error(`npm start exited ${code}: ${out}`)),
    );
  });
  stdout.write(`serving at ${address}\n`);
  const closed = new Promise((done) => child.on("close", done));
  return {
    address,
    stop: async () => {
      if (platform === "win32")
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else kill(-child.pid, "SIGTERM");
      await closed;
    },
  };
}

async function served(server, path) {
  const answer = await fetched(new URL(path, server.address));
  assert.equal(answer.status, 200, `GET ${path} answered ${answer.status}`);
  return answer.body;
}

/** The pod's page holds every value of its three questions' rows, escaped; resolves those rows by question. */
async function pageShows(server, pod) {
  const html = await served(server, `/pods/${pod}/`);
  const rows = {};
  for (const question of QUESTIONS) {
    rows[question] = await asked(question, pod);
    for (const row of rows[question])
      for (const value of Object.values(row))
        assert.ok(
          html.includes(escaped(value)),
          `the page of ${pod} lacks ${value}, from "${question}"`,
        );
  }
  return rows;
}

/** The steps `pod:load` printed, by name, in order. */
function loadedSteps(out) {
  return out
    .split(/\r?\n/)
    .map((line) => /^(\S+) \(\w+\) wrote /.exec(line)?.[1])
    .filter((step) => step !== undefined);
}

async function behaviour(name, check) {
  stdout.write(`\n# ${name}\n`);
  await check();
  stdout.write(`ok - ${name}\n`);
}

const address = release === undefined ? tarball : tarballAddress(release);
let story;
let alex;

await behaviour("the command makes the app", async () => {
  const { code, out } =
    release === undefined
      ? await run(
          execPath,
          [
            NPX,
            "--yes",
            `--package=${tarball}`,
            "create-cascade-app",
            "my-app",
            "--tarball",
            tarball,
          ],
          { cwd: work },
        )
      : await run(startLine(address, "my-app"), [], { cwd: work, shell: true });
  assert.equal(code, 0, "the command failed");
  assert.ok(out.includes(agentPrompt("my-app")), "no agent prompt");
  assert.equal(existsSync(join(app, "pods")), false, "the app has pods/");
  if (release !== undefined) {
    const manifest = JSON.parse(
      await readFile(join(app, "package.json"), "utf8"),
    );
    assert.equal(manifest.dependencies["cascade-runtime"], address);
  }
  const components = join(app, "node_modules", "cascade-runtime", "components");
  const vocabulary = await vocabularyOf(await packed(components));
  const kit = (through) =>
    featureStory(
      vocabulary.files,
      `${KIT}/alex-rivera.feature`,
      () => new OxigraphStore(),
      through === undefined ? {} : { through },
    );
  const whole = await kit();
  const e15 = whole.steps.findIndex(({ name }) => name === "E15");
  assert.ok(e15 > 0, "Alex's story has no E15 after a first step");
  const through = whole.steps[e15 - 1].name;
  const triples = await new OxigraphStore().parse(
    await readFile(
      join(vocabulary.files.folder, KIT, "expected", "allergies.ttl"),
    ),
    `file:///${KIT}/expected/allergies.ttl`,
  );
  const active = new Set(
    triples
      .filter(([, p, o]) => p.value === STATUS && o.value === "active")
      .map(([s]) => s.value),
  );
  story = {
    vocabulary: vocabulary.files.folder,
    steps: whole.steps.map(({ name }) => name),
    e15: whole.steps[e15].when,
    through,
    throughSteps: (await kit(through)).steps.map(({ name }) => name),
    activeAllergens: triples
      .filter(([s, p]) => active.has(s.value) && p.value === ALLERGEN)
      .map(([, , o]) => o.value)
      .sort(),
  };
});

if (release === undefined)
  await behaviour("with no pod, the page says what to run", async () => {
    const server = await started();
    try {
      const html = await served(server, "/");
      assert.ok(
        html.includes("No pod loaded"),
        "the page has no No pod loaded",
      );
      assert.ok(
        html.includes("npm run pod:load alex-rivera"),
        "the page names no command",
      );
    } finally {
      await server.stop();
    }
    const { code, err } = await npm("run", "ask", ALLERGIES);
    assert.equal(code, 2);
    assert.ok(
      err.includes("No pod loaded. Run `npm run pod:load alex-rivera`."),
    );
  });

const server = await (async () => {
  let server;
  await behaviour("a loaded pod is shown", async () => {
    const { code, out } = await npm("run", "pod:load", "alex-rivera");
    assert.equal(code, 0, "pod:load failed");
    assert.deepEqual(loadedSteps(out), story.steps);
    server = await started();
    const home = await fetched(new URL("/", server.address));
    assert.equal(home.status, 302);
    assert.equal(home.location, "/pods/alex-rivera/");
    alex = await pageShows(server, "alex-rivera");
    assert.deepEqual(
      alex[ALLERGIES].map(({ allergen }) => allergen).sort(),
      story.activeAllergens,
    );
    assert.ok(
      alex[REVIEW].some(
        ({ entryLabel, needs }) =>
          entryLabel === "Allergy entry · Sulfamethoxazole" &&
          needs === "members disagree on criticality",
      ),
      "no entry where the hospitals disagree on Sulfamethoxazole's criticality",
    );
  });
  return server;
})();

try {
  if (release === undefined)
    await behaviour("a pod loaded through a step stops there", async () => {
      const pod = `alex-rivera-${story.through.toLowerCase()}`;
      const { code, out } = await npm(
        "run",
        "pod:load",
        "--",
        "alex-rivera",
        "--through",
        story.through,
        "--as",
        pod,
      );
      assert.equal(code, 0, "pod:load --through failed");
      assert.deepEqual(loadedSteps(out), story.throughSteps);
      const at = Date.parse(story.e15);
      const startedAtE15 = (rows) =>
        rows.some(({ started }) => Date.parse(started) === at);
      assert.equal(startedAtE15(await asked(IMPORTS, pod)), false);
      assert.equal(startedAtE15(await asked(IMPORTS, "alex-rivera")), true);
      const rows = await pageShows(server, pod);
      assert.deepEqual(multiset(rows[ALLERGIES]), multiset(alex[ALLERGIES]));
      const home = await served(server, "/");
      for (const name of ["alex-rivera", pod])
        assert.ok(home.includes(`/pods/${name}/`), `/ does not list ${name}`);
    });
} finally {
  await server.stop();
}

if (release === undefined) {
  await behaviour("a new pod is empty, and a reset removes it", async () => {
    assert.equal((await npm("run", "pod:new", "scratch")).code, 0);
    assert.deepEqual(await asked(ALLERGIES, "scratch"), []);
    assert.equal((await npm("run", "pod:reset", "scratch")).code, 0);
    assert.equal(existsSync(join(app, "pods", "scratch")), false);
    const { code, err } = await npm("run", "ask", ALLERGIES);
    assert.equal(code, 2);
    for (const name of [
      "alex-rivera",
      `alex-rivera-${story.through.toLowerCase()}`,
    ])
      assert.ok(err.includes(name), `ask does not name ${name}`);
  });

  await behaviour("a kit's download is copied whole", async () => {
    const source = join(
      story.vocabulary,
      `${KIT}/scripted-input/alex/downloads/x-e12/apple_health_export`,
    );
    const filesIn = async (folder) =>
      (await readdir(folder, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
        .sort();
    assert.equal(
      (await npm("run", "kit:export", "--", "alex-rivera", "x-e12")).code,
      0,
    );
    const copied = await filesIn(join(app, "apple_health_export"));
    assert.ok(copied.length > 0, "x-e12 holds no files");
    assert.deepEqual(copied, await filesIn(source));
    const { code, err } = await npm(
      "run",
      "kit:export",
      "--",
      "alex-rivera",
      "x-e12",
    );
    assert.equal(code, 2);
    assert.ok(err.includes("apple_health_export exists already"));
  });

  await behaviour("the console evaluates await", async () => {
    const prompt = "alex-rivera> ";
    const child = spawn(
      execPath,
      [NPM, "run", "--silent", "console", "--", "--pod", "alex-rivera"],
      { cwd: app },
    );
    let out = "";
    let waiting;
    child.stdout.on("data", (chunk) => {
      out += chunk;
      waiting?.();
    });
    child.stderr.on("data", (chunk) => stdout.write(`[console] ${chunk}`));
    const exited = new Promise((done) => child.on("close", done));
    const promptAfter = (from) =>
      new Promise((done) => {
        waiting = () => {
          const at = out.indexOf(prompt, from);
          if (at >= 0) done(at);
        };
        waiting();
      });
    const first = await promptAfter(0);
    child.stdin.write(`(await pod.ask(${JSON.stringify(ALLERGIES)})).length\n`);
    const second = await promptAfter(first + prompt.length);
    const answer = out.slice(first + prompt.length, second).trim();
    child.stdin.write(".exit\n");
    stdout.write(out);
    assert.equal(answer, String(alex[ALLERGIES].length));
    assert.equal(await exited, 0);
  });
}

stdout.write(`\nthe starter's check passed, in ${work}\n`);
