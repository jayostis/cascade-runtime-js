// The starter, made by the command from an installed tarball and used as a person would, in a new folder under the
// current one. `node starter.mjs <tarball>` before a merge; `node starter.mjs --release <commit>` once that commit's
// release exists. Run from the repository after `npm ci` and `npm run build`.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { dirname, join, relative, resolve } from "node:path";
import { argv, cwd, env, execPath, kill, platform, stdout } from "node:process";
import { URL, URLSearchParams } from "node:url";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { featureStory, OxigraphStore } from "@cascade-runtime/runtime";
import { packed, vocabularyOf } from "@cascade-runtime/runtime/node";
import { tarballAddress } from "../dist/pack/address.js";
import { agentPrompt, KITS, startLine } from "../dist/src/create.js";

const KIT = "conformance/alex-rivera";
const PRIYA = "conformance/priya-natarajan";
const MEDICATIONS = "pod/My active medications";
const DRUG_NAME = "https://ns.cascadeprotocol.org/clinical/v1#drugName";
const ALLERGIES = "pod/My active allergies";
const REVIEW = "entry/What needs review";
const SOURCES = "entry/Where it came from";
const ROWAN = "Rowan Ellery Marsh";
/** The question each tile of a pod's page counts, by the tile's title. */
const TILES = {
  Allergies: ALLERGIES,
  Medications: MEDICATIONS,
  Conditions: "pod/My active conditions",
  "Lab results": "pod/My lab results",
  Immunizations: "pod/My immunizations",
  Procedures: "pod/My procedures",
};
const JUDGMENTS = "pod/How many judgments count";
const IMPORTS = "pod/What each import brought in";
const C_CDA = "kestrel-harbor-health-summary.xml";
const STATUS = "https://ns.cascadeprotocol.org/clinical/v1#status";
const ALLERGEN = "https://ns.cascadeprotocol.org/health/v1#allergen";
const MINUTES = 60 * 1000;
const { fetch } = globalThis;

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

/** The pods' folders, without `.answers`, which keeps their answers. */
async function podsOf() {
  return (await readdir(join(app, "pods")))
    .filter((name) => !name.startsWith("."))
    .sort();
}

function multiset(rows) {
  return rows.map((row) => JSON.stringify(Object.entries(row).sort())).sort();
}

/** HTML as the text a person reads: tags dropped, entities read, spaces trimmed. */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}

/** Each form of the page, as the fields it posts, by name. */
function forms(html) {
  const attribute = (tag, name) => {
    const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
    return found === null ? undefined : textOf(found[1]);
  };
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(
    ([, form]) =>
      Object.fromEntries(
        [...form.matchAll(/<input\b[^>]*>/g)]
          .map(([tag]) => [attribute(tag, "name"), attribute(tag, "value")])
          .filter(([name]) => name !== undefined),
      ),
  );
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

/** What a person reads of a page: its text, without its style and script. */
function readable(html) {
  return textOf(html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, ""));
}

/** Each item of the page's lists, as its text. */
function items(html) {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, item]) =>
    textOf(item),
  );
}

/** The page's heading, as its text. */
function heading(html) {
  return textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
}

/** The connection's box over the pod's page, as HTML: from its start to the end of the element it starts. */
function connectionBox(html) {
  const start = html.indexOf('<div class="dialog" id="connection"');
  assert.ok(start !== -1, "the pod's page holds no connection box");
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += tag[1] === "" ? 1 : -1;
    if (depth === 0)
      return html.slice(start, start + tag.index + tag[0].length);
  }
  assert.fail("the connection box is never closed");
}

/** The hospital the pod's page says a record was just brought in from, as the page names it, or undefined. */
function noteOf(html) {
  return /Brought in the record from (.+?)\./.exec(readable(html))?.[1];
}

/** Whether `text` names the hospital: by its whole name, or by its first words, two at least. */
function names(text, hospital) {
  const words = hospital.split(" ");
  return words.some(
    (_, at) => at > 0 && text.includes(words.slice(0, at + 1).join(" ")),
  );
}

/**
 * The pod's page reads as a record: the person's name as a heading, a tile per kind with rows counting that question's
 * rows, each allergen, and no IRI or address in what a person reads. Resolves the page and the rows by question.
 */
async function pageShows(server, pod, person) {
  const html = await served(server, `/pods/${pod}/`);
  assert.equal(heading(html), person, `the heading of ${pod}`);
  const text = readable(html);
  for (const scheme of ["urn:", "ni:", "http://", "https://"])
    assert.ok(!text.includes(scheme), `the page of ${pod} shows ${scheme}`);
  const tiles = Object.fromEntries(
    [
      ...html.matchAll(
        /<span class="kind">([^<]*)<\/span><span class="count">(\d+)<\/span>/g,
      ),
    ].map(([, kind, count]) => [kind, Number(count)]),
  );
  const rows = {};
  for (const [kind, question] of Object.entries(TILES)) {
    rows[question] = await asked(question, pod);
    assert.equal(
      tiles[kind],
      rows[question].length === 0 ? undefined : rows[question].length,
      `the ${kind} tile of ${pod}`,
    );
  }
  for (const { allergen } of rows[ALLERGIES])
    assert.ok(text.includes(allergen), `no ${allergen} on ${pod}`);
  return { html, rows };
}

/** The page at `path`, once it no longer refreshes itself, or the page it redirects to once it does. */
async function settled(server, path) {
  const until = Date.now() + 2 * MINUTES;
  for (;;) {
    const answer = await fetched(new URL(path, server.address));
    if (answer.status === 303) return served(server, answer.location);
    assert.equal(answer.status, 200, `GET ${path} answered ${answer.status}`);
    if (!answer.body.includes('http-equiv="refresh"')) return answer.body;
    assert.ok(Date.now() < until, `${path} still refreshes`);
    await setTimeout(200);
  }
}

/** The steps `pod:load` printed, by name, in order. */
function loadedSteps(out) {
  return out
    .split(/\r?\n/)
    .map((line) => /^(\S+) \(\w+\) wrote /.exec(line)?.[1])
    .filter((step) => step !== undefined);
}

/**
 * What the app should show of patient A at Cascade North, worked out in the app with the packages it installed:
 * North's row, its patients, `look` over A's pull made with no person, and the allergens that pull brings into a new
 * pod.
 */
async function expectedPull() {
  const script = `
import { demoHospital } from "@cascade-runtime/demo-hospital";
import { loadHospital } from "@cascade-runtime/demo-hospital/node";
import { connect, DEMO_PLAN, openPod, pull, pullFiles, TEST_DIRECTORY } from "cascade-runtime";
const patient = "pt-1001";
const north = await loadHospital("cascade-north");
const hospital = demoHospital({ ...north, autoApprove: patient });
const fetch = (input, init) => hospital(new Request(input, init));
const row = TEST_DIRECTORY.find(({ fhirBase }) => fhirBase === north.hospital.fhirBase);
const connection = await connect(
  row,
  { clientId: "check", redirectUri: "http://127.0.0.1:1/callback", scopes: ["launch/patient", "patient/*.read"] },
  { fetch, signIn: async (authorize) => new URL((await fetch(authorize)).headers.get("Location")) },
);
const pod = await openPod();
const files = pullFiles(await pull(connection, DEMO_PLAN), "expected");
const look = await pod.look(files);
await pod.import(files, { aboutSubject: true });
const allergens = (await pod.ask(${JSON.stringify(ALLERGIES)})).map(({ allergen }) => allergen).sort();
await pod.close();
const south = await loadHospital("cascade-south");
const named = (data, person) =>
  Object.keys(data.patients).find((id) => {
    const { name } = data.patients[id].entry.find(({ resource }) => resource.resourceType === "Patient").resource;
    return [...name[0].given, name[0].family].join(" ") === person;
  });
const rowan = [north, south].map((data) => ({
  hospital: data.hospital.name,
  fhirBase: data.hospital.fhirBase,
  patient: named(data, ${JSON.stringify(ROWAN)}),
}));
console.log(JSON.stringify({ row, patient, patients: Object.keys(north.patients), look, allergens, rowan }));
`;
  // A file, not `--eval`: the import's Bridge runs in a worker, which inherits node's flags, and `--input-type` there
  // refuses its file.
  const file = join(app, "expected-pull.mjs");
  await writeFile(file, script);
  const { code, out } = await run(execPath, [file]);
  assert.equal(code, 0, "the expected pull failed");
  return JSON.parse(out.trim().split(/\r?\n/).at(-1));
}

async function behaviour(name, check) {
  stdout.write(`\n# ${name}\n`);
  await check();
  stdout.write(`ok - ${name}\n`);
}

const address = release === undefined ? tarball : tarballAddress(release);
let story;
let alex;
let fresh;

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
  assert.deepEqual(await podsOf(), KITS);
  const loads = [
    ...out.matchAll(/Loading the pod (\S+),[^\n]*? loaded in ([\d.]+) s/g),
  ];
  assert.deepEqual(
    loads.map(([, pod]) => pod),
    KITS,
  );
  stdout.write(
    `\nthe loads took ${loads.map(([, pod, seconds]) => `${pod} ${seconds} s`).join(", ")}\n`,
  );
  fresh = {
    judgments: await asked(JUDGMENTS, "alex-rivera"),
    imports: (await asked(IMPORTS, "alex-rivera")).length,
  };
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
    e15: whole.steps[e15].when,
    through,
    throughSteps: (await kit(through)).steps.map(({ name }) => name),
    activeAllergens: triples
      .filter(([s, p]) => active.has(s.value) && p.value === ALLERGEN)
      .map(([, , o]) => o.value)
      .sort(),
  };
});

await behaviour("help lists every command", async () => {
  const { code, out } = await npm("run", "--silent", "help");
  assert.equal(code, 0, "npm run help failed");
  const { scripts } = JSON.parse(
    await readFile(join(app, "package.json"), "utf8"),
  );
  const listed = out
    .split(/\r?\n/)
    .filter((line) => line.startsWith("  npm "))
    .map((line) => {
      const [command, what] = line.trim().split(/\s{2,}/);
      const [, word, script] = command.split(" ");
      return [word === "run" ? script : word, what];
    });
  assert.deepEqual(
    listed.map(([script]) => script),
    Object.keys(scripts),
  );
  for (const [script, what] of listed)
    assert.ok(what !== undefined, `help says nothing of ${script}`);
});

const server = await (async () => {
  let server;
  await behaviour("a loaded pod is shown", async () => {
    server = await started();
    const home = await fetched(new URL("/", server.address));
    assert.equal(home.status, 302);
    assert.equal(home.location, "/pods/alex-rivera/");
    const shown = await pageShows(server, "alex-rivera", "Alex Rivera");
    alex = shown.rows;
    assert.deepEqual(
      alex[ALLERGIES].map(({ allergen }) => allergen).sort(),
      story.activeAllergens,
    );
    const sources = await asked(SOURCES, "alex-rivera");
    const said = items(shown.html);
    for (const hospital of new Set(
      sources.flatMap((row) => row.hospital ?? []),
    ))
      assert.ok(said.includes(hospital), `no place ${hospital}`);
    assert.ok(said.includes("Alex's own entries"), "no place for Alex's own");
    const penicillin = new Set(
      sources
        .filter(({ entryLabel }) => entryLabel === "Allergy entry · Penicillin")
        .map(({ hospital }) => hospital),
    );
    assert.ok(penicillin.size > 1, "Alex's penicillin is from one place");
    assert.ok(
      said.some(
        (sentence) =>
          sentence.startsWith("Penicillin was recorded at") &&
          [...penicillin].every((hospital) => sentence.includes(hospital)),
      ),
      "no sentence that penicillin was recorded at each of its places",
    );
    const review = await asked(REVIEW, "alex-rivera");
    assert.ok(
      review.some(
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
      const { html, rows } = await pageShows(
        server,
        pod,
        `Alex Rivera ${story.through}`,
      );
      assert.deepEqual(multiset(rows[ALLERGIES]), multiset(alex[ALLERGIES]));
      for (const name of ["alex-rivera", pod])
        assert.ok(html.includes(`/pods/${name}/`), `the pods omit ${name}`);
    });
} finally {
  await server.stop();
}

if (release === undefined) {
  await behaviour(
    "a new pod is empty, its answers are kept beside the pods and are no pod, and a reset removes it and them, or them alone",
    async () => {
      const answers = join(app, "pods", ".answers", "scratch");
      assert.equal((await npm("run", "pod:new", "scratch")).code, 0);
      assert.deepEqual(await asked(ALLERGIES, "scratch"), []);
      assert.ok(
        existsSync(join(answers, "answers.json")),
        "no answer was kept",
      );
      assert.equal((await npm("run", "pod:reset", "scratch")).code, 0);
      assert.equal(existsSync(join(app, "pods", "scratch")), false);
      assert.equal(existsSync(answers), false);
      await mkdir(answers, { recursive: true });
      assert.equal((await npm("run", "pod:reset", "scratch")).code, 0);
      assert.equal(existsSync(answers), false);
      const { code, err } = await npm("run", "ask", ALLERGIES);
      assert.equal(code, 2);
      assert.ok(!err.includes(".answers"), "ask names .answers as a pod");
      for (const name of [
        "alex-rivera",
        `alex-rivera-${story.through.toLowerCase()}`,
      ])
        assert.ok(err.includes(name), `ask does not name ${name}`);
    },
  );

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

  await behaviour(
    "Priya's pod is loaded, and her C-CDA download is copied as its file",
    async () => {
      const view = `${PRIYA}/expected/medications.ttl`;
      const triples = await new OxigraphStore().parse(
        await readFile(join(story.vocabulary, view)),
        `file:///${view}`,
      );
      const active = new Set(
        triples
          .filter(([, p, o]) => p.value === STATUS && o.value === "active")
          .map(([s]) => s.value),
      );
      assert.deepEqual(
        (await asked(MEDICATIONS, "priya-natarajan"))
          .map(({ medication }) => medication)
          .sort(),
        triples
          .filter(([s, p]) => active.has(s.value) && p.value === DRUG_NAME)
          .map(([, , o]) => o.value)
          .sort(),
      );
      assert.equal(
        (await npm("run", "kit:export", "--", "priya-natarajan", C_CDA)).code,
        0,
      );
      const copied = await readFile(join(app, C_CDA), "utf8");
      assert.ok(
        copied.includes("<ClinicalDocument") &&
          copied.includes("<name>Kestrel Harbor Hospital</name>"),
        `${C_CDA} is not Kestrel Harbor's C-CDA`,
      );
    },
  );

  {
    assert.equal((await npm("run", "pod:new", "hospital")).code, 0);
    const expected = await expectedPull();
    const server = await started();
    const origin = new URL(server.address).origin;
    const at = (path) => new URL(path, origin).href;
    const send = (path, form, from = origin) =>
      fetch(at(path), {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: from,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form),
      });

    /**
     * Sign the pod's person in at `fhirBase`, answering its page with `decision` as `patient`; gives the pod's page with
     * the connection's box open.
     */
    const signIn = async (pod, fhirBase, patient, decision) => {
      const begun = await send(`/pods/${pod}/hospitals`, { fhirBase });
      assert.equal(begun.status, 303);
      const authorize = new URL(begun.headers.get("location"));
      assert.equal(authorize.origin, origin);
      const picker = await (await fetch(authorize)).text();
      assert.ok(picker.includes(`value="${patient}"`), patient);
      const answered = await send(authorize.pathname, {
        ...Object.fromEntries(authorize.searchParams),
        patient,
        decision,
      });
      const back = new URL(answered.headers.get("location"));
      assert.equal(`${back.origin}${back.pathname}`, at("/callback"));
      const callback = await fetch(back, { redirect: "manual" });
      assert.equal(callback.status, 303);
      const shown = callback.headers.get("location");
      assert.match(
        shown,
        new RegExp(`^/pods/${pod}/\\?connection=\\d+#connection$`),
      );
      return shown;
    };

    /**
     * The connection's box once it no longer refreshes, as HTML, with the pod's page behind it; `person` is the
     * heading that page should have.
     */
    const boxed = async (connection, person) => {
      const html = await settled(server, connection);
      assert.equal(
        heading(html),
        person,
        "the pod's page is not behind the box",
      );
      return connectionBox(html);
    };

    /**
     * Brings the record in with the button of the connection's box, `box`, which goes at once to the box saying it
     * brings the record in, unless the record is in already, where the button posted again goes too; gives the pod's
     * page the box goes to once the record is in.
     */
    const bringIn = async (box) => {
      const action = /<form\b[^>]*action="([^"]*\/connections\/\d+)"/.exec(
        box,
      )?.[1];
      assert.ok(action, "the connection's box has no button to bring it in");
      const imported = await send(action, {});
      assert.equal(imported.status, 303, "the import did not go to the box");
      const boxed = imported.headers.get("location");
      assert.match(boxed, /\?connection=\d+#connection$/);
      const bringing = await fetched(at(boxed));
      if (bringing.status === 200)
        assert.ok(
          readable(connectionBox(bringing.body)).includes("Bringing it in") &&
            bringing.body.includes('http-equiv="refresh"'),
          "the box does not say it brings the record in",
        );
      else assert.equal(bringing.status, 303, `GET ${boxed}`);
      const again = await send(action, {});
      assert.equal(again.status, 303);
      assert.equal(again.headers.get("location"), boxed);
      return settled(server, boxed);
    };

    try {
      await behaviour(
        "a person signs in to a demo hospital and brings the record in",
        async () => {
          const pod = "hospital";
          const north = expected.row.fhirBase;
          const podPage = await served(server, `/pods/${pod}/`);
          assert.ok(
            podPage.includes(`/pods/${pod}/hospitals`),
            "no hospitals link",
          );
          const found = await served(server, `/pods/${pod}/hospitals?q=north`);
          assert.deepEqual(
            forms(found).flatMap(({ fhirBase }) => fhirBase ?? []),
            [north],
          );

          const failed = await signIn(pod, north, expected.patient, "cancel");
          const cancelled = readable(await boxed(failed, "Hospital"));
          assert.ok(cancelled.includes("cancelled"), "Cancel is not cancelled");
          assert.deepEqual(await asked(ALLERGIES, pod), []);
          assert.equal(
            noteOf(
              await served(
                server,
                `/pods/${pod}/?from=${new URL(failed, origin).searchParams.get("connection")}`,
              ),
            ),
            undefined,
            "a note that a cancelled sign-in brought a record in",
          );

          const elsewhere = await send(
            `/pods/${pod}/hospitals`,
            { fhirBase: north },
            "http://elsewhere.invalid",
          );
          assert.equal(elsewhere.status, 403);
          const localhost = await send(
            `/pods/${pod}/hospitals`,
            { fhirBase: north },
            origin.replace("127.0.0.1", "localhost"),
          );
          assert.equal(
            localhost.status,
            303,
            "a form from localhost is refused",
          );

          const connection = await signIn(
            pod,
            north,
            expected.patient,
            "allow",
          );
          const box = await boxed(connection, "Hospital");
          const looked = readable(box);
          const [source] = expected.look;
          const what = /What (.+?) has:/.exec(looked)?.[1];
          assert.ok(
            what !== undefined && names(what, expected.row.name),
            "no What it has",
          );
          for (const [kind, count] of Object.entries(source.records))
            assert.ok(
              looked.includes(
                `${count} ${kind.toLowerCase().replace(/y$/, "")}`,
              ),
              `no ${count} ${kind}`,
            );
          assert.ok(looked.includes("has nothing from here yet"));
          const back = await bringIn(box);
          assert.ok(
            names(noteOf(back) ?? "", expected.row.name),
            "no note after the import",
          );
          assert.ok(expected.allergens.length > 0, "A has no active allergy");
          assert.deepEqual(
            (await asked(ALLERGIES, pod))
              .map(({ allergen }) => allergen)
              .sort(),
            expected.allergens,
          );
        },
      );

      await behaviour("a new pod is made from a person's name", async () => {
        for (let time = 0; time < 2; time += 1) {
          const made = await send("/pods", { person: "Ada  Lovelace" });
          assert.equal(made.status, 303);
          assert.equal(made.headers.get("location"), "/pods/ada-lovelace/");
        }
        const page = await served(server, "/pods/ada-lovelace/");
        assert.equal(heading(page), "Ada Lovelace");
        assert.ok(page.includes("Nothing here yet"), "Ada's pod is not empty");
      });

      await behaviour(
        "a demo person's pod brings in their records from both hospitals",
        async () => {
          const offered = forms(await served(server, "/pods/hospital/"));
          assert.ok(
            offered.some(({ person }) => person === ROWAN),
            `the new-pod box does not offer ${ROWAN}`,
          );
          const made = await send("/pods", { person: ROWAN });
          const page = made.headers.get("location");
          const pod = page.split("/")[2];
          assert.deepEqual(
            forms(await served(server, page))
              .flatMap(({ fhirBase }) => fhirBase ?? [])
              .sort(),
            expected.rowan.map(({ fhirBase }) => fhirBase).sort(),
          );
          let shown;
          for (const { hospital, fhirBase, patient } of expected.rowan) {
            const connection = await signIn(pod, fhirBase, patient, "allow");
            const box = await boxed(connection, ROWAN);
            const said = readable(box);
            assert.ok(
              said.includes("Record fetched") &&
                /What (.+?) has:/.test(said) &&
                names(said, hospital),
              `the box over ${ROWAN}'s pod does not say what ${hospital} has`,
            );
            shown = await bringIn(box);
            assert.ok(
              names(noteOf(shown) ?? "", hospital),
              `no note naming ${hospital}`,
            );
          }
          assert.ok(
            items(shown).some(
              (sentence) =>
                /hypertension was recorded at/i.test(sentence) &&
                expected.rowan.every(({ hospital }) =>
                  names(sentence, hospital),
                ),
            ),
            "no sentence that hypertension was recorded at both hospitals",
          );
          assert.ok(
            !forms(shown).some(({ person }) => person === ROWAN),
            `the new-pod box still offers ${ROWAN}`,
          );
        },
      );

      await behaviour(
        "the File menu deletes every pod and says how many, and resets to the kits' pods",
        async () => {
          const before = await podsOf();
          const page = await served(server, `/pods/${before[0]}/`);
          for (const action of ["/delete-all", "/reset-all"])
            assert.ok(page.includes(`action="${action}"`), `no ${action}`);
          const deleted = await send("/delete-all", {});
          assert.equal(deleted.status, 303);
          assert.deepEqual(await podsOf().catch(() => []), []);
          const home = await served(server, deleted.headers.get("location"));
          assert.equal(heading(home), "No pods yet");
          assert.ok(
            readable(home).includes(`Deleted ${before.length} pods.`),
            "the page does not say how many pods went",
          );
          const reset = await send("/reset-all", {});
          assert.equal(reset.status, 303);
          assert.deepEqual(await podsOf(), KITS);
          const back = await served(server, reset.headers.get("location"));
          assert.equal(heading(back), "Alex Rivera");
          assert.ok(
            readable(back).includes(
              "Reset: Alex Rivera and Priya Natarajan are back.",
            ),
            "the page does not say which pods are back",
          );
          assert.equal(
            (await send("/delete-all", {}, "http://elsewhere.example")).status,
            403,
          );
        },
      );
    } finally {
      await server.stop();
    }
  }

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

  await behaviour("reset puts the app back", async () => {
    const script = join(app, "bring-in.mjs");
    await writeFile(
      script,
      `import { openPod } from "cascade-runtime";
const pod = await openPod("pods/alex-rivera");
const { refused } = await pod.import(${JSON.stringify(C_CDA)}, { aboutSubject: true });
await pod.close();
if (refused !== undefined) throw new Error(refused);
`,
    );
    assert.equal((await run(execPath, [script])).code, 0, "no record in");
    assert.ok((await asked(IMPORTS, "alex-rivera")).length > fresh.imports);
    assert.ok(existsSync(join(app, "pods", ".answers")), "no answer was kept");
    assert.equal((await npm("run", "pod:new", "scratch")).code, 0);
    assert.ok((await podsOf()).length > KITS.length, "no pod was made");
    assert.equal((await npm("run", "reset")).code, 0, "npm run reset failed");
    assert.deepEqual(await podsOf(), KITS);
    assert.equal(existsSync(join(app, "pods", ".answers")), false);
    assert.equal((await asked(IMPORTS, "alex-rivera")).length, fresh.imports);
    assert.deepEqual(
      multiset(await asked(JUDGMENTS, "alex-rivera")),
      multiset(fresh.judgments),
    );
  });
}

stdout.write(`\nthe starter's check passed, in ${work}\n`);
