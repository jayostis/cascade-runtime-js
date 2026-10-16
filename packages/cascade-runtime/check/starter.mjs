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
import {
  FolderFiles,
  packed,
  vocabularyOf,
} from "@cascade-runtime/runtime/node";
import { tarballAddress } from "../dist/pack/address.js";
import { agentPrompt, KITS, startLine } from "../dist/src/create.js";
import { Tables } from "../dist/src/tables.js";

/** What the tables the app holds now name each code, set once the app is installed. */
let heldNames = async () => new Map();
let heldSeries = async () => [];

const KIT = "conformance/alex-rivera";
const PRIYA = "conformance/priya-natarajan";
const MARTIN = "conformance/martin-okafor";
const MY_VARIANTS = "pod/My genetic variants";
const REPORTS = "pod/What each report says of a variant";
const CORE = "https://ns.cascadeprotocol.org/core/v1#";
const GENOMICS = "https://ns.cascadeprotocol.org/genomics/v1#";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const PREF_LABEL = "http://www.w3.org/2004/02/skos/core#prefLabel";
const COUNSELLOR =
  "Your clinician or a genetic counsellor can explain what this means for you.";
const DIFFERS = "Differs";
const ACMG = [
  "Pathogenic",
  "LikelyPathogenic",
  "VUS",
  "LikelyBenign",
  "Benign",
];
const DIGITS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const MEDICATIONS = "pod/My active medications";
const DRUG_NAME = "https://ns.cascadeprotocol.org/clinical/v1#drugName";
const ALLERGIES = "pod/My active allergies";
const REVIEW = "entry/What needs review";
const SOURCES = "entry/Where it came from";
const ROWAN = "Rowan Ellery Marsh";
const INES = "Ines Calloway";
const idOf = (entry) => entry.split(":").at(-1);
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

/** Reports oldest first, an undated one after the dated, as the page orders them. */
const undatedLast = (a, b) =>
  a.date === undefined || b.date === undefined
    ? Number(a.date === undefined) - Number(b.date === undefined)
    : a.date.localeCompare(b.date);

/** Each line of the page's Worth a look, as the address it links to, its sentence and its tag. */
function worthOf(html) {
  const part = /<div class="card worth">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
  return [...part.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, item]) => ({
    href: textOf(/<a href="([^"]*)"/.exec(item)?.[1] ?? ""),
    sentence: textOf(/<a\b[^>]*>([\s\S]*?)<\/a>/.exec(item)?.[1] ?? item),
    tag: textOf(
      /<span class="tag[^"]*">([\s\S]*?)<\/span>/.exec(item)?.[1] ?? "",
    ),
  }));
}

/** The page's heading, as its text. */
function heading(html) {
  return textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
}

/** The count on each tile of the page, by the tile's title. */
function tilesOf(html) {
  return Object.fromEntries(
    [
      ...html.matchAll(
        /<span class="kind">([^<]*)<\/span><span class="count">(\d+)<\/span>/g,
      ),
    ].map(([, kind, count]) => [kind, Number(count)]),
  );
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
  const tiles = tilesOf(html);
  const rows = {};
  for (const [kind, question] of Object.entries(TILES)) {
    rows[question] = await asked(question, pod);
    assert.equal(
      tiles[kind],
      rows[question].length === 0 ? undefined : rows[question].length,
      `the ${kind} tile of ${pod}`,
    );
  }
  const named = await heldNames(
    rows[ALLERGIES].flatMap(({ code }) => (code === undefined ? [] : [code])),
  );
  for (const { allergen, code } of rows[ALLERGIES]) {
    const shown = named.get(code)?.name?.label ?? allergen;
    assert.ok(text.includes(shown), `no ${shown} on ${pod}`);
  }
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

/** Each `<a href>` of the page as written, and each `id` an element of it has. Forms are not links. */
function linksOf(html) {
  return {
    hrefs: [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map(([, href]) =>
      textOf(href),
    ),
    ids: new Set([...html.matchAll(/\sid="([^"]*)"/g)].map(([, id]) => id)),
  };
}

/** `work` on each of `items`, at most `limit` at once, in the order of `items`. */
async function eachAtOnce(items, limit, work) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++;
        results[at] = await work(items[at]);
      }
    }),
  );
  return results;
}

const MOST_PAGES = 2000;

/**
 * Every same-origin link reached from the pages at `roots`, fetched once by its address without the fragment, four at
 * a time. A page under a root's path has its own links followed; any other page is fetched and not read. A link is dead
 * when it does not answer 200 after its redirects, or names a fragment no element of its page has as an id.
 */
async function crawled(server, roots) {
  const origin = new URL(server.address).origin;
  const under = roots.map((root) => new URL(root, origin).pathname);
  const pages = new Map();
  const links = [];
  let lastToAdd = roots[0];
  let frontier = roots.map((root) => new URL(root, origin).href);
  while (frontier.length > 0) {
    const fetchedNow = frontier;
    await eachAtOnce(fetchedNow, 4, async (address) => {
      try {
        const answer = await fetch(address);
        const html = await answer.text();
        pages.set(address, {
          status: answer.status,
          final: new URL(answer.url),
          html,
          ids: linksOf(html).ids,
        });
      } catch (error) {
        pages.set(address, { status: String(error), html: "", ids: new Set() });
      }
    });
    frontier = [];
    for (const address of fetchedNow) {
      const page = pages.get(address);
      const answered = page.final?.pathname;
      if (
        answered === undefined ||
        !under.some((root) => answered.startsWith(root))
      )
        continue;
      for (const href of linksOf(page.html).hrefs) {
        if (href === "#") continue;
        const to = new URL(href, page.final);
        if (to.origin !== origin) continue;
        const fragment = decodeURIComponent(to.hash.slice(1));
        to.hash = "";
        links.push({ on: address, href, target: to.href, fragment });
        if (!pages.has(to.href) && !frontier.includes(to.href)) {
          frontier.push(to.href);
          lastToAdd = address;
        }
      }
    }
    if (pages.size + frontier.length > MOST_PAGES)
      throw new Error(
        `The crawl passed ${MOST_PAGES} pages and is not ending; the last page to add a new address was ${lastToAdd}`,
      );
  }
  const dead = links.flatMap(({ on, href, target, fragment }) => {
    const reached = pages.get(target);
    if (reached.status !== 200) {
      const said = /<pre>([^<]*)<\/pre>/.exec(reached.html)?.[1];
      return [
        `${on} links ${href}, which answered ${reached.status}${said === undefined ? "" : `: ${said}`}`,
      ];
    }
    return fragment === "" || reached.ids.has(fragment)
      ? []
      : [`${on} links ${href}, whose page has no element #${fragment}`];
  });
  return { pages, dead, links: links.length };
}

/** Each box a pod's page holds for a tile, by its id, as the HTML from its start to the next box's. */
function tileBoxes(html) {
  const starts = [...html.matchAll(/<div class="dialog" id="(see-[^"]*)"/g)];
  return starts.map(([, id], at) => ({
    id,
    html: html.slice(starts[at].index, starts[at + 1]?.index),
  }));
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
import { demoHospital, recordsAt } from "@cascade-runtime/demo-hospital";
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
    const { name } = recordsAt(data.patients[id]).find(({ resourceType }) => resourceType === "Patient");
    return [...name[0].given, name[0].family].join(" ") === person;
  });
const rowan = [north, south].map((data) => ({
  hospital: data.hospital.name,
  fhirBase: data.hospital.fhirBase,
  patient: named(data, ${JSON.stringify(ROWAN)}),
}));
const ines = { fhirBase: north.hospital.fhirBase, patient: named(north, ${JSON.stringify(INES)}) };
console.log(JSON.stringify({ row, patient, patients: Object.keys(north.patients), look, allergens, rowan, ines }));
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
  assert.deepEqual(await podsOf(), [...KITS].sort());
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
  const heldTables = new Tables({
    files: new FolderFiles(join(app, "pods", ".tables")),
    feeds: [],
    vocabulary: vocabulary.files,
    newStore: () => new OxigraphStore(),
    preference: vocabulary.config.tables.preference,
  });
  heldNames = (codes) => heldTables.about(codes);
  heldSeries = () => heldTables.held();
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
    throughSteps: (await kit(through)).steps
      .filter(({ happened }) => !["reference", "open"].includes(happened.kind))
      .map(({ name }) => name),
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
      !said.some((sentence) =>
        sentence.startsWith("Penicillin was recorded at"),
      ),
      "the pod's page still says where penicillin was recorded",
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

    const entryAt = (id) =>
      `/pods/alex-rivera/entries/${encodeURIComponent(id)}`;
    const opens = [
      ...shown.html.matchAll(
        /<td data-key="[^"]*"><a href="(\/pods\/alex-rivera\/entries\/[^"]+)"/g,
      ),
    ].map(([, href]) => href);
    assert.deepEqual(
      [...new Set(opens)].sort(),
      [
        ...new Set(
          Object.values(TILES).flatMap((question) =>
            alex[question].map(({ entry }) => entryAt(idOf(entry))),
          ),
        ),
      ].sort(),
      "a tile row does not open its entry",
    );
    const entryOf = async (label) =>
      served(
        server,
        entryAt(idOf(sources.find((row) => row.entryLabel === label).entry)),
      );

    const penicillinPage = await entryOf("Allergy entry · Penicillin");
    const penicillinRow = alex[ALLERGIES].find(
      ({ entry }) =>
        entry ===
        sources.find((row) => row.entryLabel === "Allergy entry · Penicillin")
          .entry,
    );
    const penicillinName =
      (
        await heldNames(
          penicillinRow.code === undefined ? [] : [penicillinRow.code],
        )
      ).get(penicillinRow.code)?.name?.label ?? penicillinRow.allergen;
    assert.ok(
      heading(penicillinPage).startsWith(penicillinName),
      `penicillin's entry is headed ${heading(penicillinPage)}`,
    );
    const penicillinText = readable(penicillinPage);
    for (const hospital of [...penicillin].filter(Boolean))
      assert.ok(
        penicillinText.includes(hospital),
        `penicillin's entry omits ${hospital}`,
      );
    assert.ok(
      items(penicillinPage).some(
        (sentence) =>
          sentence.startsWith("Cascade recorded it at") &&
          [...penicillin]
            .filter(Boolean)
            .every((hospital) => sentence.includes(hospital)),
      ),
      "penicillin's entry does not say it was recorded at each of its places",
    );
    for (const scheme of ["urn:", "ni:", "http://", "https://"])
      assert.ok(
        !penicillinText.includes(scheme),
        `penicillin's entry shows ${scheme}`,
      );
    const sulfa = "Allergy entry · Sulfamethoxazole";
    const sulfaPage = await entryOf(sulfa);
    assert.ok(
      items(sulfaPage).some((sentence) =>
        /^Sources disagree on how severe the .* allergy is\. Needs review$/.test(
          sentence,
        ),
      ),
      "Sulfamethoxazole's entry does not say the sources disagree",
    );
    assert.ok(
      heading(sulfaPage).endsWith("Needs review"),
      "Sulfamethoxazole's entry is not tagged Needs review",
    );
    const sulfaHref = entryAt(
      idOf(sources.find((row) => row.entryLabel === sulfa).entry),
    );
    assert.ok(
      worthOf(shown.html).some(
        ({ href, sentence, tag }) =>
          href === sulfaHref &&
          /^Sources disagree on how severe the .* allergy is\.$/.test(
            sentence,
          ) &&
          tag === "Needs review",
      ),
      "Worth a look has no line for Sulfamethoxazole linking to its entry, tagged Needs review",
    );
    assert.ok(
      textOf(
        shown.html
          .split("<tr")
          .slice(1)
          .find((part) => part.includes(`href="${sulfaHref}"`)) ?? "",
      ).includes("Needs review"),
      "Sulfamethoxazole's row does not carry Needs review",
    );

    const missing = await fetched(new URL(entryAt("0"), server.address));
    assert.equal(missing.status, 404);
    assert.ok(
      missing.body.includes(
        '<a href="/pods/alex-rivera/">Back to Alex Rivera</a>',
      ),
      "an entry that is not in the pod does not link back",
    );
    assert.ok(readable(missing.body).includes("no longer in this pod"));
  });
  return server;
})();

try {
  await behaviour(
    "every link on each kit's pod page and its entries opens",
    async () => {
      const roots = KITS.map((kit) => `/pods/${kit}/`);
      const began = Date.now();
      const { pages, dead, links } = await crawled(server, roots);
      stdout.write(
        `followed ${links} links over ${pages.size} pages in ${Date.now() - began} ms\n`,
      );
      assert.equal(dead.length, 0, `dead links:\n${dead.join("\n")}`);
      for (const root of roots) {
        const page = pages.get(new URL(root, server.address).href);
        const boxes = tileBoxes(page.html);
        assert.equal(
          boxes.length,
          Object.keys(tilesOf(page.html)).length,
          `${root} holds a box for each tile`,
        );
        for (const { id, html } of boxes)
          assert.ok(
            linksOf(html).hrefs.some((href) => href.includes("/entries/")),
            `${root} opens no entry from its ${id} box`,
          );
      }
      const addresses = [...pages.keys()].map((address) => new URL(address));
      const codePage = addresses.find(
        ({ pathname, searchParams }) =>
          pathname.startsWith("/tables/") && searchParams.has("code"),
      );
      assert.ok(codePage !== undefined, "the crawl reached no code's page");
      assert.ok(
        readable(pages.get(codePage.href).html).includes(
          codePage.searchParams.get("code"),
        ),
        `${codePage.pathname + codePage.search} does not show its code`,
      );
      assert.ok(
        addresses.some(
          ({ pathname, searchParams }) =>
            pathname.startsWith("/tables/") && !searchParams.has("code"),
        ),
        "the crawl reached no table's page",
      );
    },
  );
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
  await behaviour(
    "the reference tables are listed under the pods, and Check now says what it did",
    async () => {
      const html = await served(server, "/pods/alex-rivera/");
      const aside = html.slice(
        html.indexOf("<aside>"),
        html.indexOf("</aside>"),
      );
      assert.ok(
        readable(aside).indexOf("Reference tables") >
          readable(aside).indexOf("Alex Rivera"),
        "no reference tables under the pods",
      );
      assert.match(aside, /<form [^>]*action="\/tables\/check"/);
      const origin = new URL(server.address).origin;
      const checked = await fetch(new URL("/tables/check", origin), {
        method: "POST",
        redirect: "manual",
        headers: { origin },
      });
      assert.equal(checked.status, 303);
      const page = await served(server, checked.headers.get("location"));
      assert.match(page, /<p class="note" role="status">[^<]+<\/p>/);
    },
  );
  await behaviour(
    "Priya's potassium result is named by LOINC, and the class page puts her amlodipine in its ingredient's class and says FDA classes a different form of her lisinopril, so it has none",
    async () => {
      const pod = readable(await served(server, "/pods/priya-natarajan/"));
      assert.ok(
        pod.includes("Potassium [Moles/volume] in Serum or Plasma"),
        "her potassium result is not named by LOINC",
      );
      assert.ok(
        pod.includes("By class"),
        "her Medications tile does not offer the class view",
      );
      const classes = readable(
        await served(server, "/pods/priya-natarajan/classes"),
      );
      for (const said of [
        "Calcium Channel Blocker [EPC]",
        "amlodipine 5 MG Oral Tablet through amlodipine",
        "lisinopril 10 MG Oral Tablet: FDA classes a different form of lisinopril; RxNorm does not tie this product to it.",
      ])
        assert.ok(classes.includes(said), `${said} is not on ${classes}`);
      assert.ok(
        !classes.includes("Angiotensin Converting Enzyme Inhibitor [EPC]"),
        "lisinopril is given the class FDA gives lisinopril anhydrous",
      );
    },
  );
  await behaviour(
    "from her potassium result a person opens the electrolytes panel and sees her potassium with its place and requirement, and the required tests she has no result for",
    async () => {
      const raw = await served(server, "/pods/priya-natarajan/");
      const entry = /href="([^"]*\/entries\/[^"]+)"[^>]*>[^<]*Potassium/.exec(
        raw,
      )?.[1];
      assert.ok(entry, "her page links no potassium result");
      const result = await served(server, entry);
      assert.ok(
        readable(result).includes("In LOINC panels"),
        "her potassium result names no panel",
      );
      const panel = /href="([^"]*\/panel\?panel=[^"]*24326-1)"/.exec(
        result,
      )?.[1];
      assert.ok(panel, "her potassium result links no electrolytes panel");
      const said = readable(await served(server, panel));
      for (const expected of [
        "Your results in",
        "Potassium",
        "required",
        "missing: ",
        "No result",
      ])
        assert.ok(said.includes(expected), `${expected} is not on ${said}`);
    },
  );
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

  await behaviour(
    "Martin's pod is loaded, its page has a Genetic variants tile whose rows open each variant's entry, and the entry puts what ClinVar says today beside what each of his reports, from its lab, said, in the four states of his variants",
    async () => {
      const triplesOf = async (path) =>
        new OxigraphStore().parse(
          await readFile(join(story.vocabulary, path)),
          `file:///${path}`,
        );
      const objectsOf = (triples, subject, predicate) =>
        triples
          .filter(([s, p]) => s.value === subject && p.value === predicate)
          .map(([, , o]) => o.value);
      const entriesOf = (triples) =>
        [
          ...new Set(
            triples
              .filter(([, p]) => p.value === `${CORE}mergedFrom`)
              .map(([s]) => s.value),
          ),
        ].map((entry) => ({
          entry,
          hgvs: objectsOf(triples, entry, `${GENOMICS}hgvsCDot`).sort(),
          variations: objectsOf(
            triples,
            entry,
            `${GENOMICS}clinvarVariationId`,
          ),
          genes: objectsOf(triples, entry, `${GENOMICS}geneSymbol`),
        }));
      const titleOf = ({ genes, hgvs, variations }) =>
        [...genes, ...hgvs, ...variations.map((id) => `ClinVar ${id}`)].join(
          " · ",
        );
      const kitVariants = entriesOf(
        await triplesOf(`${MARTIN}/expected/variants.ttl`),
      );
      assert.ok(kitVariants.length > 0, "Martin's kit expects no variant");

      const rows = await asked(MY_VARIANTS, "martin-okafor");
      assert.equal(
        new Set(rows.map(({ variant }) => variant)).size,
        kitVariants.length,
        "the pod's variants are not as many as the kit's entries",
      );
      assert.equal(
        rows.length,
        kitVariants.reduce(
          (sum, { hgvs, variations }) =>
            sum + Math.max(hgvs.length + variations.length, 1),
          0,
        ),
        "the pod's rows are not one for each code of each entry of the kit",
      );

      const tables = `${MARTIN}/scripted-input/martin/tables/clinvar-story`;
      const index = await triplesOf(`${tables}/references.ttl`);
      const version = index.find(([, p]) => p.value === `${REC}coversGene`)[0]
        .value;
      const covered = objectsOf(index, version, `${REC}coversGene`).sort();
      const held = await triplesOf(
        `${tables}/${version.replace("urn:uuid:", "")}.ttl`,
      );
      const rowOf = (id) =>
        objectsOf(
          held,
          `http://www.ncbi.nlm.nih.gov/clinvar/${id}`,
          `${REC}clinvarClassification`,
        );
      const labels = await triplesOf("ontologies/records/v1-draft/records.ttl");
      const label = (concept) => {
        const [text] = objectsOf(labels, concept, PREF_LABEL);
        return text.slice(0, 1).toLowerCase() + text.slice(1);
      };
      // The page reads the app's copy of the published ClinVar series; this check reads the kit's subset of it. They agree
      // because the subset is the published rows, so the sentence is built here from the kit's own row.
      const saidOf = (id) => {
        const row = `http://www.ncbi.nlm.nih.gov/clinvar/${id}`;
        const classifications = rowOf(id);
        const [status] = objectsOf(held, row, `${REC}clinvarReviewStatus`);
        const [submitters] = objectsOf(
          held,
          row,
          `${REC}contributingSubmitters`,
        );
        const count = Number(submitters);
        assert.ok(
          classifications.length > 0 && status && count < 10,
          `${id}: the kit's row`,
        );
        const said = ACMG.map((name) => GENOMICS + name)
          .filter((iri) => classifications.includes(iri))
          .map(label)
          .join("/");
        const counted = `${DIGITS[count]} contributing ${count === 1 ? "submitter" : "submitters"}`;
        return `ClinVar today says ${said}: ${label(status)}, ${counted}.`;
      };
      assert.deepEqual(
        kitVariants.flatMap(({ variations }) => variations).sort(),
        [
          ...new Set(
            held
              .filter(([, p]) => p.value === `${REC}clinvarClassification`)
              .map(([row]) => row.value.split("/").at(-1)),
          ),
        ].sort(),
        "the kit's ClinVar IDs are not the rows its story's table holds",
      );
      const kitReports = await triplesOf(
        `${MARTIN}/expected/variant-interpretations.ttl`,
      );
      const signature = (reports) =>
        JSON.stringify(
          reports
            .map(({ classification, date }) => `${classification} ${date}`)
            .sort(),
        );
      const kitGroups = new Map();
      for (const entry of new Set(
        kitReports
          .filter(([, p]) => p.value === `${CORE}mergedFrom`)
          .map(([s]) => s.value),
      )) {
        const [about] = objectsOf(
          kitReports,
          entry,
          `${GENOMICS}variantInterpreted`,
        );
        kitGroups.set(about, [
          ...(kitGroups.get(about) ?? []),
          {
            classification: objectsOf(
              kitReports,
              entry,
              `${GENOMICS}acmgClassification`,
            )[0],
            date: objectsOf(kitReports, entry, `${GENOMICS}interpretedDate`)[0],
          },
        ]);
      }
      const podReports = Map.groupBy(
        await asked(REPORTS, "martin-okafor"),
        ({ variant }) => variant,
      );
      assert.deepEqual(
        [...podReports.values()].map(signature).sort(),
        [...kitGroups.values()].map(signature).sort(),
        "the pod's reports are not the kit's, grouped by variant",
      );

      const entryPath = (variant) =>
        `/pods/martin-okafor/entries/${encodeURIComponent(idOf(variant))}`;
      const sources = await asked(SOURCES, "martin-okafor");
      const labOf = (report) => {
        const labs = [
          ...new Set(
            sources
              .filter((row) => row.entry === report && row.hospital)
              .map(({ hospital }) => hospital.replace(/ Demo Hospital$/, "")),
          ),
        ];
        return labs.length === 0 ? "" : ` from ${labs.join(" and ")}`;
      };

      const shown = await started();
      let html;
      const entries = new Map();
      try {
        html = await settled(shown, "/pods/martin-okafor/");
        for (const variant of new Set(rows.map((row) => row.variant)))
          entries.set(variant, await served(shown, entryPath(variant)));
      } finally {
        await shown.stop();
      }
      assert.equal(heading(html), "Martin Okafor");
      const tiles = tilesOf(html);
      let kitTiles = 0;
      for (const [kind, question] of Object.entries(TILES)) {
        const view = `${MARTIN}/expected/${kind.toLowerCase().replaceAll(" ", "-")}.ttl`;
        if (!existsSync(join(story.vocabulary, view))) continue;
        const kitRows = entriesOf(await triplesOf(view)).length;
        if (kitRows === 0) continue;
        kitTiles++;
        assert.notEqual(
          tiles[kind],
          undefined,
          `Martin's page has no ${kind} tile, though his kit's ${view} holds ${kitRows} rows`,
        );
        assert.equal(
          tiles[kind],
          (await asked(question, "martin-okafor")).length,
          `the ${kind} tile of Martin's page`,
        );
      }
      assert.ok(kitTiles > 0, "Martin's kit holds rows for no kind of tile");
      assert.equal(
        tiles["Genetic variants"],
        kitVariants.length,
        "the Genetic variants tile of Martin's page",
      );
      assert.ok(
        !html.includes('class="variant"') &&
          !html.includes('class="card variants"'),
        "Martin's page still has a card of variants",
      );
      const opens = new Set(
        [
          ...html.matchAll(
            /<td data-key="[^"]*"><a href="(\/pods\/martin-okafor\/entries\/[^"]+)"/g,
          ),
        ].map(([, href]) => href),
      );
      for (const variant of entries.keys())
        assert.ok(
          opens.has(entryPath(variant)),
          `no row opens the entry ${entryPath(variant)}`,
        );
      for (const variant of podReports.keys())
        assert.ok(entries.has(variant), "a report's variant has no row");

      for (const [variant, group] of podReports) {
        const rowsOfVariant = rows.filter((row) => row.variant === variant);
        const title = titleOf({
          genes: [...new Set(rowsOfVariant.flatMap(({ gene }) => gene ?? []))],
          hgvs: [
            ...new Set(rowsOfVariant.flatMap(({ hgvs }) => hgvs ?? [])),
          ].sort(),
          variations: [
            ...new Set(
              rowsOfVariant.flatMap(({ variation }) => variation ?? []),
            ),
          ],
        });
        const kitVariant = kitVariants.find((each) => titleOf(each) === title);
        assert.ok(kitVariant, `${title} is no variant of the kit`);
        const [id] = kitVariant.variations;
        const [gene] = kitVariant.genes;
        const page = entries.get(variant);
        const text = readable(page);
        for (const scheme of ["urn:", "ni:", "http://", "https://"])
          assert.ok(!text.includes(scheme), `${title}'s entry shows ${scheme}`);
        const lines = items(page);
        const reports = lines.filter((line) =>
          /^(Your .+|An undated) report\b/.test(line),
        );
        const sentences = [...group]
          .sort(undatedLast)
          .map(({ report, classification, date }) => ({
            sentence: `${date === undefined ? "An undated" : `Your ${date.slice(0, 4)}`} report${labOf(report)} said ${label(classification)}.`,
            differs: id !== undefined && !rowOf(id).includes(classification),
          }));
        assert.equal(reports.length, sentences.length, `${title}: ${reports}`);
        sentences.forEach(({ sentence, differs }, at) => {
          assert.ok(
            reports[at].startsWith(sentence),
            `${title}: ${reports[at]}`,
          );
          assert.equal(
            reports[at].includes(DIFFERS),
            differs,
            `${title}: ${reports[at]}`,
          );
        });
        const row = html
          .split("<tr")
          .slice(1)
          .find((part) => part.includes(`href="${entryPath(variant)}"`));
        assert.equal(
          textOf(row).includes(DIFFERS),
          sentences.some(({ differs }) => differs),
          `${title}: the tile's row`,
        );
        assert.deepEqual(
          worthOf(html)
            .filter(
              ({ href, tag }) => href === entryPath(variant) && tag === DIFFERS,
            )
            .map(({ sentence }) =>
              sentence.replace(/^.*?: (?=(?:your|an undated) )/, ""),
            ),
          [...group]
            .sort(undatedLast)
            .filter(
              ({ classification }) =>
                id !== undefined && !rowOf(id).includes(classification),
            )
            .map(
              ({ report, date }) =>
                `${date === undefined ? "an undated" : `your ${date.slice(0, 4)}`} report${labOf(report)} differs from ClinVar today.`,
            ),
          `${title}: Worth a look on Martin's page`,
        );
        assert.equal(
          heading(page).includes(DIFFERS),
          sentences.some(({ differs }) => differs),
          `${title}: the entry's heading`,
        );
        if (gene === "MLH1" && id !== undefined) {
          const named = "NM_000249.4(MLH1):c.2042C>T (p.Ala681Val)";
          assert.ok(
            textOf(row).includes(named),
            `the MLH1 row is not named by ClinVar: ${textOf(row)}`,
          );
          assert.ok(
            heading(page).includes(named),
            `the MLH1 entry is not named by ClinVar: ${heading(page)}`,
          );
          const origin = (
            await heldNames([`http://www.ncbi.nlm.nih.gov/clinvar/${id}`])
          ).get(`http://www.ncbi.nlm.nih.gov/clinvar/${id}`)?.name?.origin;
          const series = (await heldSeries()).find(({ versions }) =>
            versions.some(({ iri }) => iri === origin),
          );
          assert.ok(series, "no held series names the MLH1 variation");
          const version = series.versions.find(({ iri }) => iri === origin);
          const credit = lines.find((line) =>
            line.startsWith(`ClinVar names this variation ${named}.`),
          );
          assert.ok(credit, "the entry does not say ClinVar names it");
          assert.ok(
            credit.includes(`From ${series.label}, `) &&
              (version.label === undefined ||
                credit.includes(`version ${version.label}`)),
            `the entry does not credit the names series and version: ${credit}`,
          );
          assert.ok(
            heading(page).includes(DIFFERS),
            "the MLH1 variant does not differ",
          );
          assert.ok(
            worthOf(html).some(
              ({ href, tag }) => href === entryPath(variant) && tag === DIFFERS,
            ),
            "Worth a look has no line that the MLH1 variant's report differs",
          );
        }
        const clinvar = lines.find((line) => /^ClinVar(,| today)/.test(line));
        assert.ok(clinvar, `${title}: no sentence of what ClinVar says`);
        if (id !== undefined) {
          assert.ok(clinvar.startsWith(saidOf(id)), `${title}: ${clinvar}`);
          assert.ok(page.includes(`code=${id}`), `${title}: the ID is no link`);
        } else if (covered.includes(gene))
          assert.ok(
            clinvar.startsWith(
              "ClinVar, as this app holds it, has no row for this variant.",
            ),
            clinvar,
          );
        else {
          const [, listed] =
            /^ClinVar, as this app holds it, covers (.+), not ([^.]+)\./.exec(
              clinvar,
            ) ?? [];
          assert.ok(listed, `${title}: ${clinvar}`);
          assert.deepEqual(listed.split(/, | and /).sort(), covered);
          assert.ok(clinvar.includes(`not ${gene}.`), clinvar);
        }
        assert.ok(
          lines.indexOf(COUNSELLOR) > lines.indexOf(clinvar),
          `${title}: the counsellor sentence does not follow ClinVar's`,
        );
        assert.ok(
          text.includes(
            "not intended for direct diagnostic use or medical decision-making without review by a genetics professional",
          ),
          `${title}: the entry does not carry ClinVar's own caution`,
        );
        if (gene === "MLH1" && id !== undefined)
          assert.match(text, /report of [A-Z][a-z]{2} \d{1,2}, \d{4}/);
      }
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

      await behaviour(
        "the world's date is set by post, the hospital's sign-in page and the connection's box say so, a bad date is refused, and Today takes it away",
        async () => {
          const pod = "hospital";
          const north = expected.row.fhirBase;
          const AS_OF = '<time datetime="2024-02-01T23:59:59Z"';
          /** The hospital's sign-in page for a new sign-in, which is then cancelled. */
          const pickerNow = async () => {
            const begun = await send(`/pods/${pod}/hospitals`, {
              fhirBase: north,
            });
            const authorize = new URL(begun.headers.get("location"));
            const picker = await (await fetch(authorize)).text();
            const answered = await send(authorize.pathname, {
              ...Object.fromEntries(authorize.searchParams),
              patient: expected.patient,
              decision: "cancel",
            });
            await fetch(new URL(answered.headers.get("location")), {
              redirect: "manual",
            });
            return picker;
          };
          assert.ok(
            readable(await served(server, "/world-date")).includes(
              "Hospitals answer with everything they hold.",
            ),
          );
          assert.ok(!(await pickerNow()).includes('class="as-of"'));

          const set = await send("/world-date", { date: "2024-02-01" });
          assert.equal(set.status, 303);
          assert.equal(set.headers.get("location"), "/world-date?set");
          assert.ok(
            readable(await served(server, "/world-date?set")).includes(
              "Hospitals answer as of 1 February 2024.",
            ),
          );
          assert.ok((await pickerNow()).includes(AS_OF));

          const connection = await signIn(
            pod,
            north,
            expected.patient,
            "allow",
          );
          const said = readable(await boxed(connection, "Hospital"));
          assert.ok(said.includes("Hospitals answer as of 1 February 2024."));
          assert.ok(said.includes("Change the world's date"));

          const bad = await send("/world-date", { date: "soon" });
          assert.equal(bad.status, 400);
          const refused = readable(await bad.text());
          assert.ok(refused.includes('"soon" is not a date'), refused);
          assert.ok(
            (await pickerNow()).includes(AS_OF),
            "a refused date moved the world's date",
          );

          const today = await send("/world-date", { date: "" });
          assert.equal(today.status, 303);
          assert.ok(!(await pickerNow()).includes('class="as-of"'));
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
            !items(shown).some((sentence) =>
              /hypertension was recorded at/i.test(sentence),
            ),
            "the pod's page still says where hypertension was recorded",
          );
          const hypertension = shown
            .split("<tr")
            .slice(1)
            .filter((row) => /hypertension/i.test(textOf(row)))
            .flatMap((row) =>
              textOf(
                /<a href="(\/pods\/[^"]*\/entries\/[^"]+)"/.exec(row)?.[1] ??
                  "",
              ),
            )
            .filter(Boolean);
          assert.ok(hypertension.length > 0, "no row for hypertension");
          let recorded = false;
          for (const href of hypertension)
            recorded ||= items(await served(server, href)).some(
              (sentence) =>
                sentence.startsWith("Cascade recorded it at") &&
                expected.rowan.every(({ hospital }) =>
                  names(sentence, hospital),
                ),
            );
          assert.ok(
            recorded,
            "no entry of hypertension says it was recorded at both hospitals",
          );
          assert.ok(
            !forms(shown).some(({ person }) => person === ROWAN),
            `the new-pod box still offers ${ROWAN}`,
          );
        },
      );

      await behaviour(
        "a story patient's pod says what changed after a medication started, opens its trend, and every link under the pod opens",
        async () => {
          assert.ok(
            forms(await served(server, "/pods/hospital/")).some(
              ({ person }) => person === INES,
            ),
            `the new-pod box does not offer ${INES}`,
          );
          const made = await send("/pods", { person: INES });
          const page = made.headers.get("location");
          const pod = page.split("/")[2];
          const connection = await signIn(
            pod,
            expected.ines.fhirBase,
            expected.ines.patient,
            "allow",
          );
          const shown = await bringIn(await boxed(connection, INES));
          assert.equal(heading(shown), INES);

          const card = readable(shown);
          assert.match(
            card,
            /\bwas lower after [^.]+ started\./,
            "no card says a test was lower after a medication started",
          );
          assert.ok(
            card.includes(
              "162 → 98.3 mg/dL, the mean of 3 results before and 3 after",
            ),
            "the card does not give both means and their counts",
          );
          const results = shown.slice(
            shown.indexOf('id="change-start-617310-18262-6"'),
          );
          assert.equal(
            linksOf(results.split('class="dialog"')[0]).hrefs.filter((href) =>
              href.includes("/entries/"),
            ).length,
            6,
            "the box behind the card does not link its six results' entries",
          );

          const opens = /<a href="([^"]*)">Open the trend<\/a>/.exec(
            shown,
          )?.[1];
          assert.ok(opens, "the card does not open the trend");
          const trend = new URL(textOf(opens), server.address);
          assert.deepEqual(
            [
              trend.searchParams.get("test"),
              trend.searchParams.get("medication"),
            ],
            ["18262-6", "617310"],
          );
          const chart = await served(server, trend.pathname + trend.search);
          assert.equal(
            chart.split('class="marker"').length - 1,
            6,
            "the trend does not mark each of the six results",
          );
          assert.ok(chart.includes('class="mark start"'), "no start marked");

          const { dead, links, pages } = await crawled(server, [page]);
          stdout.write(`followed ${links} links over ${pages.size} pages\n`);
          assert.equal(dead.length, 0, `dead links:\n${dead.join("\n")}`);
          assert.ok(
            [...pages.keys()].some((address) =>
              new URL(address).pathname.endsWith("/trend"),
            ),
            "the crawl reached no trend",
          );

          const priya = await served(server, "/pods/priya-natarajan/");
          assert.ok(
            readable(priya).includes(
              "1 pair of a medication and a test had too few results to say anything.",
            ),
            "Priya's page does not count her pair with too few results",
          );
          assert.ok(!priya.includes('class="change"'), "Priya has a card");
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
          assert.deepEqual(await podsOf(), [...KITS].sort());
          const back = await served(server, reset.headers.get("location"));
          assert.equal(heading(back), "Alex Rivera");
          assert.ok(
            readable(back).includes(
              "Reset: Alex Rivera, Priya Natarajan and Martin Okafor are back.",
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
    assert.deepEqual(await podsOf(), [...KITS].sort());
    assert.equal(existsSync(join(app, "pods", ".answers")), false);
    assert.equal((await asked(IMPORTS, "alex-rivera")).length, fresh.imports);
    assert.deepEqual(
      multiset(await asked(JUDGMENTS, "alex-rivera")),
      multiset(fresh.judgments),
    );
  });
}

stdout.write(`\nthe starter's check passed, in ${work}\n`);
