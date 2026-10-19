import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
  type Route,
  type Worker as PageWorker,
} from "playwright";
import {
  changeTools,
  connect,
  DEMO_PLAN,
  type Imported,
  openPod,
  type Pod,
  pull,
  pullFiles,
  type Row,
} from "cascade-runtime";
import {
  demoFetch,
  hospitalId,
  recordsAt,
} from "@the-cascade-protocol/sandbox";
import {
  loadHospital,
  loadHospitals,
  loadStories,
} from "@the-cascade-protocol/sandbox/node";
import * as oxigraph from "oxigraph";
import type * as Fixtures from "cascade-runtime/fixtures";
import type * as Published from "cascade-runtime/published";
import { type Served, servePages } from "../src/node/serve.js";
import { inPlace, newPod, settled, tiles, watched } from "./shown.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PAGES = join(ROOT, "build", "pages");
/** The package as an app installs it: in this repository, the one `npm run build:package` staged. */
const INSTALLED = join(ROOT, "build", "package");
/** The components try/ serves, as the package carries them. */
const SERVED = join(PAGES, "try", "cascade-runtime", "components");

interface Followed {
  readonly repository: string;
}

interface Config {
  readonly vocabulary: Followed;
  readonly adapters: readonly Followed[];
  readonly tables: { readonly feeds: readonly string[] };
}

/** The cascade-runtime.json try/ serves. */
const servedConfig = async (): Promise<Config> =>
  JSON.parse(
    await readFile(join(SERVED, "cascade-runtime.json"), "utf8"),
  ) as Config;

type Triple = readonly [
  oxigraph.Quad_Subject,
  oxigraph.Quad_Predicate,
  oxigraph.Quad_Object,
];

/** A Turtle document's triples, each as its subject, predicate and object. */
const turtle = (bytes: Uint8Array, base: string): Triple[] =>
  oxigraph
    .parse(bytes, { format: "text/turtle", base_iri: base })
    .map(
      ({ subject, predicate, object }) => [subject, predicate, object] as const,
    );

/** The triples as N-Triples. */
const ntriples = (triples: readonly Triple[]): string =>
  new oxigraph.Store(
    triples.map(([subject, predicate, object]) =>
      oxigraph.quad(subject, predicate, object),
    ),
  ).dump({
    format: "application/n-triples",
    from_graph_name: oxigraph.defaultGraph(),
  });
const ALEX = "alex-rivera";
const DCAT = "http://www.w3.org/ns/dcat#";
const PROV = "http://www.w3.org/ns/prov#";
/** Oxigraph's module, the engine a pod computes with. */
const ENGINE = /\/web_bg\.wasm$/;

/** The files a table's rows are read from, which the engine reads once it is ready. */
const TABLE_ROWS = /\/components\/tables\/[^/]+\.(nq\.gz|codes\.json)$/;

type Answers = Record<string, Row[]>;
interface Person {
  readonly name: string;
  readonly family: string;
  readonly given: string;
  readonly at: readonly { readonly name: string; readonly fhirBase: string }[];
}
interface Section {
  readonly title: string;
  readonly question?: string;
}
/** What the test reads of the starter's view, the module try/ renders. */
interface View {
  readonly QUESTIONS: readonly string[];
  readonly SECTIONS: readonly Section[];
  sectionRows(section: Section, answers: Answers): Row[];
  worthALook(
    answers: Answers,
    about?: Map<string, unknown>,
    said?: unknown,
  ): { sentence: string; entry: string; tag?: string }[];
  seenAt(answers: Answers): Map<string, { places: string[]; across: number }>;
  entryId(entry: string): string;
  placeOf(row: Row): string;
  counted(records: Readonly<Record<string, number>>): string;
  hospitalName(name: string): string;
  day(text: string): string;
  dayInWords(asOf: string): string;
  demoPeople(demo: unknown): Person[];
  familyFirst(person: Person): string;
  patientName(bundle: unknown): string | undefined;
  slug(person: string): string;
}

const view = (await import(
  pathToFileURL(
    join(ROOT, "packages", "cascade-runtime", "starter", "summary.mjs"),
  ).href
)) as View;

let served: Served;
let browser: Browser;
/** One browser profile for the tests that share its pods. */
let profile: BrowserContext;
let alex: Answers;
/** A demo person, what Node's look says of each hospital's pull, and what the pulls bring in. */
interface Joined {
  person: Person;
  patients: Map<string, string>;
  has: Map<string, string[]>;
  worth: string[];
  worthLinks: string[];
  /** Each judgment the pod holds, by its justification's name, with the table version it cites (none for a judgment citing none). */
  judged: { justification: string; used: string }[];
  /** How many records of each type the person's hospitals hold, before the pod joins any. */
  held: Map<string, number>;
  /** The entry both hospitals recorded; its IRI comes from the records, so Node and the browser name it alike. */
  seenAtBoth: string | undefined;
}
/** Rowan Marsh, whom both hospitals hold, and Tobias Fenn, whom only North does. */
let joined: Joined;
let tobias: Joined;

/** Does a judgment of this justification cite a table version, a content-addressed `ni:` IRI beside the rule list it used? */
const cites = (judged: Joined["judged"], justification: string): boolean =>
  judged.some(
    (judgment) =>
      judgment.justification === justification &&
      judgment.used.startsWith("ni:"),
  );

/** A Worth a look line as the page's text reads it: its sentence, then its tag. */
const worthText = ({ sentence, tag }: { sentence: string; tag?: string }) =>
  tag === undefined ? sentence : `${sentence} ${tag}`;

async function answersOf(pod: Pod): Promise<Answers> {
  const answers: Answers = {};
  for (const question of view.QUESTIONS)
    answers[question] = await pod.ask(question);
  return answers;
}

/** The sentences the connection's box says of what each source of a pull holds. */
const hasLines = (
  hospital: string,
  sources: readonly { records: Readonly<Record<string, number>> }[],
): string[] =>
  sources.map(
    (source) =>
      `What ${view.hospitalName(hospital)} has: ${view.counted(source.records) || "nothing"}.`,
  );

/** A Node pod in memory, opened by the installed package over the starter tables it carries, which the page ships. */
async function pageTablesPod(): Promise<Pod> {
  const from = (path: string) =>
    import(
      pathToFileURL(join(INSTALLED, "dist", "src", ...path.split("/"))).href
    );
  const { installedParts } = (await from("fixtures.js")) as typeof Fixtures;
  const { openPodWith } = (await from("node/published.js")) as typeof Published;
  return openPodWith(await installedParts());
}

/** What Node pulls of the demo person with this family name at each of their hospitals, and the pod the pulls make. */
async function nodeJoin(family: string): Promise<Joined> {
  const demo = await loadHospitals();
  const person = view.demoPeople(demo).find((each) => each.family === family);
  assert.ok(person, `no demo person is named ${family}`);
  const patients = new Map<string, string>();
  const has = new Map<string, string[]>();
  const held = new Map<string, number>();
  const pod = await pageTablesPod();
  try {
    for (const hospital of person.at) {
      const loaded = demo.find(
        (each) => each.hospital.fhirBase === hospital.fhirBase,
      );
      assert.ok(loaded);
      const id = Object.entries(loaded.patients).find(
        ([, bundle]) => view.patientName(bundle) === person.name,
      )?.[0];
      assert.ok(id);
      patients.set(hospital.name, id);
      for (const resource of recordsAt(loaded.patients[id]!))
        held.set(
          resource.resourceType,
          (held.get(resource.resourceType) ?? 0) + 1,
        );
      const fetch = demoFetch([{ ...loaded, autoApprove: id }]);
      const connection = await connect(
        { name: hospital.name, vendor: "demo", fhirBase: hospital.fhirBase },
        {
          clientId: "cascade-runtime-demo",
          redirectUri: "http://127.0.0.1/try/signed-in.html",
          scopes: ["launch/patient", "patient/*.read"],
        },
        {
          fetch,
          signIn: async (authorize) =>
            new URL(
              (await fetch(authorize, { redirect: "manual" })).headers.get(
                "Location",
              ) ?? "",
            ),
        },
      );
      const files = pullFiles(
        await pull(connection, DEMO_PLAN),
        hospitalId(loaded),
      );
      has.set(hospital.name, hasLines(hospital.name, await pod.look(files)));
      const imported = await pod.import(files, { aboutSubject: true });
      assert.equal(imported.refused, undefined);
    }
    const answers = await answersOf(pod);
    const both = person.at.map(({ name }) => view.hospitalName(name));
    const seenAtBoth = [...view.seenAt(answers)].find(([, { places }]) =>
      both.every((name) => places.includes(name)),
    )?.[0];
    const judged = (
      await pod.ask({
        query: `SELECT ?justification ?used WHERE {
          ?judgment <https://ns.cascadeprotocol.org/judgments/v1-draft#justification> ?justification .
          OPTIONAL { ?judgment <http://www.w3.org/ns/prov#used> ?used }
        }`,
      })
    ).map(({ justification = "", used = "" }) => ({
      justification: justification.replace(/^.*#/, ""),
      used,
    }));
    return {
      seenAtBoth,
      person,
      patients,
      has,
      judged,
      held,
      worth: view.worthALook(answers).map(worthText),
      worthLinks: view
        .worthALook(answers)
        .map(
          ({ entry }) =>
            `?pod=${view.slug(person.name)}&entry=${encodeURIComponent(view.entryId(entry))}`,
        ),
    };
  } finally {
    await pod.close();
  }
}

before(async () => {
  if (!existsSync(join(PAGES, "try", "index.html")))
    throw new Error(
      `${PAGES} holds no try/; run npm run build:package and npm run build:pages first`,
    );
  const copy = await mkdtemp(join(tmpdir(), "try-"));
  try {
    await cp(join(PAGES, ALEX, "pod"), copy, { recursive: true });
    await rm(join(copy, "files.json"));
    const pod = await openPod(copy);
    try {
      alex = await answersOf(pod);
    } finally {
      await pod.close();
    }
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
  joined = await nodeJoin("Marsh");
  tobias = await nodeJoin("Fenn");
  served = await servePages(PAGES);
  browser = await chromium.launch();
  profile = await browser.newContext();
});

after(async () => {
  await browser?.close();
  await served?.close();
});

const texts = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(selector, (found) => found.map((each) => each.textContent ?? ""));

/**
 * What a person waits for on Martin's pages, in ms with the tables kept and the HTTP cache warm, each median at most
 * twice its budget. CI's runners vary by more than a budget's margin; twice still fails a regression of the size that
 * matters.
 */
const BUDGET_MS = {
  "Martin's pod page, a new load, until the MLH1 Differs line": 1250,
  "Martin's pod page, a reload, until the MLH1 Differs line": 610,
  "the MLH1 entry, a new load, until the ClinVar sentence": 1250,
  "the MLH1 entry, a reload, until the ClinVar sentence": 610,
  "a click on a Genetic variants row, until the ClinVar sentence": 610,
};
const SAMPLES = 3;

/**
 * A fresh browser's first visit to try/, in ms from its navigation until the tables' names are drawn on Alex's page,
 * its median at most twice the budget, as Martin's are.
 */
const FIRST_VISIT_NAMES_BUDGET_MS = 650;

/** Prints each sample and the median, and fails a median over twice the budget. */
function withinBudget(
  what: string,
  samples: readonly number[],
  budget: number,
): void {
  for (const [at, ms] of samples.entries())
    console.log(`# ${what} ${at + 1} ${Math.round(ms)} ms`);
  console.log(
    `# ${what}: median ${Math.round(median(samples))} ms, budget ${budget} ms`,
  );
  assert.ok(
    median(samples) <= 2 * budget,
    `${what}: median ${Math.round(median(samples))} ms is over twice its budget of ${budget} ms (${samples.map(Math.round).join(", ")})`,
  );
}

interface Drawn {
  drawn: Record<string, number>;
  clicked?: number;
}

/**
 * Records, in every page of the context, `performance.now()` when the line Worth a look has for MLH1's report, tagged
 * Differs (`differs`), the entry's ClinVar sentence (`clinvar`) and Alex's influenza vaccine named by CVX (`names`)
 * are first drawn; a click starts the count again.
 * Playwright's waits and the test's round trips are not in the number.
 */
function recordDraws(): void {
  const here = globalThis as unknown as Drawn;
  here.drawn = {};
  const sees: Record<string, () => boolean> = {
    differs: () =>
      [...document.querySelectorAll(".worth li")].some((line) => {
        const text = line.textContent ?? "";
        return (
          text.includes("your 2022 report from Harbourline Genetics") &&
          text.includes("Differs")
        );
      }),
    clinvar: () =>
      /ClinVar today (says|gives no classification)|ClinVar, as this app holds it|This app holds no ClinVar table/.test(
        document.querySelector("main")?.textContent ?? "",
      ),
    names: () =>
      (document.querySelector("main")?.textContent ?? "").includes(
        "split virus",
      ),
  };
  new MutationObserver(() => {
    for (const [what, seen] of Object.entries(sees))
      if (here.drawn[what] === undefined && seen())
        here.drawn[what] = performance.now();
  }).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener(
    "click",
    () => {
      here.clicked = performance.now();
      here.drawn = {};
    },
    true,
  );
}

interface Registered {
  registered: { name: string; signal: AbortSignal }[];
}

/**
 * Gives every page of the context a stand-in `document.modelContext`, as WebMCP's gives one, recording each tool
 * registered and the signal that takes it away.
 */
function recordTools(): void {
  const registered: Registered["registered"] = [];
  Object.assign(globalThis, { registered });
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: (
        tool: { name: string },
        options: { signal: AbortSignal },
      ) => {
        registered.push({ name: tool.name, signal: options.signal });
      },
    },
  });
}

/**
 * Holds what Preact runs after a paint, a view's registration and the abort a page leaving gives it, once
 * `globalThis.effectsHeld` is set (never until a test sets it): its frame callbacks and 35 ms timeouts are dropped
 * and never run, so no machine is slow enough to let them through.
 */
function lagEffects(): void {
  const held = (): boolean =>
    (globalThis as unknown as { effectsHeld?: boolean }).effectsHeld === true;
  const timeout = globalThis.setTimeout.bind(globalThis);
  const frame = globalThis.requestAnimationFrame.bind(globalThis);
  // Preact waits for a frame or 35 ms, whichever comes first.
  globalThis.setTimeout = ((
    callback: TimerHandler,
    ms?: number,
    ...rest: unknown[]
  ) =>
    ms === 35 && held()
      ? 0
      : timeout(callback, ms, ...rest)) as typeof globalThis.setTimeout;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    held() ? 0 : frame(callback)) as typeof frame;
}

/** When `what` was first drawn in the page, ms since its navigation started or, after a click, since the click. */
async function drawnAt(page: Page, what: string): Promise<number> {
  try {
    await page.waitForFunction(
      (what) => (globalThis as unknown as Drawn).drawn[what] !== undefined,
      what,
      { timeout: 20_000 },
    );
  } catch (error) {
    throw new Error(`"${what}" was never drawn on ${page.url()} in 20 s`, {
      cause: error,
    });
  }
  return page.evaluate((what) => {
    const here = globalThis as unknown as Drawn;
    return (here.drawn[what] ?? 0) - (here.clicked ?? 0);
  }, what);
}

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** The query names of an address a page links, joined: the shape of the address. */
const shapeOf = (href: string): string =>
  [...new URL(href, "http://x/try/index.html").searchParams.keys()]
    .sort()
    .join(",");

/** The samples the new-pod box offers to load, by folder. */
const loadable = (page: Page): Promise<string[]> =>
  page.$$eval('#new-pod input[name="pod"]', (found) =>
    found.map((each) => (each as HTMLInputElement).value),
  );

test("a first visit copies Alex's, Martin's, Priya's and Tamsin's pods and opens Alex's, which reads as her record: her name, her places, what is worth a look with each line linking to its entry, and a tile per kind counting the question's rows; it and a switch to Priya's draw in place before the engine loads, a click on the pod shown adds no entry to the history, so Back draws Alex's again, and the engine then loads in the background, an entry opened and left for a code page before it does leaves the code page drawn when it lands; a fresh browser's first visit draws the tables' names within twice its budget", async () => {
  const page = watched(await profile.newPage());
  const held: Route[] = [];
  await page.route(ENGINE, (route) => {
    held.push(route);
  });
  const rows: Route[] = [];
  await page.route(TABLE_ROWS, (route) => {
    rows.push(route);
  });
  const wrong: string[] = [];
  page.on("pageerror", (error) => wrong.push(error.message));
  await page.goto(`${served.url}try/index.html`);
  await settled(page);

  assert.equal(await page.textContent("main h1"), "Alex Rivera");
  assert.equal(
    await page.textContent('nav a[aria-current="page"]'),
    "Alex Rivera",
  );
  assert.deepEqual(await texts(page, "nav a"), [
    "Alex Rivera",
    "Martin Okafor",
    "Priya Natarajan",
    "Tamsin Vale",
  ]);
  assert.deepEqual(await loadable(page), []);
  assert.deepEqual(
    (await texts(page, ".chips li")).sort(),
    [
      ...new Set((alex["entry/Where it came from"] ?? []).map(view.placeOf)),
    ].sort(),
  );
  const worth = await texts(page, ".worth li");
  const lines = view.worthALook(alex);
  assert.deepEqual(worth, lines.map(worthText));
  assert.ok(lines.length > 0, "Alex's record has nothing worth a look");
  assert.ok(
    !worth.some((sentence) => /was recorded at /.test(sentence)),
    worth.join("\n"),
  );
  assert.deepEqual(
    await page.$$eval(".worth li a", (found) =>
      found.map((each) => each.getAttribute("href")),
    ),
    lines.map(
      ({ entry }) =>
        `?pod=${ALEX}&entry=${encodeURIComponent(view.entryId(entry))}`,
    ),
  );
  assert.deepEqual(
    await tiles(page),
    new Map(
      view.SECTIONS.map((section: Section): [string, number] => [
        section.title,
        view.sectionRows(section, alex).length,
      ]).filter(([, count]) => count > 0),
    ),
  );
  const sidebar = (await page.textContent("aside section.tables")) ?? "";
  assert.ok(
    sidebar.includes("Loading the reference tables"),
    `the sidebar does not say the tables are loading: ${sidebar}`,
  );
  assert.ok(!sidebar.includes("None yet"), sidebar);

  await inPlace(page, () => page.click('nav a:has-text("Priya Natarajan")'));
  assert.equal(await page.textContent("main h1"), "Priya Natarajan");
  assert.equal(await page.getAttribute("body", "data-engine"), null);
  await inPlace(page, () => page.click('nav a[aria-current="page"]'));
  assert.equal(await page.textContent("main h1"), "Priya Natarajan");
  await inPlace(page, async () => {
    await page.goBack();
    await page.waitForFunction(
      () => document.querySelector("main h1")?.textContent === "Alex Rivera",
    );
  });
  assert.equal(new URL(page.url()).searchParams.get("pod"), ALEX);
  await inPlace(page, () => page.click(".worth li a"));
  assert.match(new URL(page.url()).search, /entry=/);
  const entryName = await page.textContent("main h1");
  await page.evaluate(() => {
    history.pushState(null, "", "?table=&code=141");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.unroute(ENGINE);
  for (const route of held) await route.continue().catch(() => undefined);
  await page.waitForSelector('body[data-engine="ready"]', { timeout: 60_000 });
  await page.unroute(TABLE_ROWS);
  for (const route of rows) await route.continue().catch(() => undefined);
  await page.waitForFunction(
    (name) => document.querySelector("main h1")?.textContent !== name,
    entryName,
    { timeout: 120_000 },
  );
  await settled(page);
  assert.equal(
    await page.textContent("main h1"),
    "141 Influenza, split virus, trivalent, preservative",
    (await page.textContent("main")) ?? "",
  );
  assert.match((await page.textContent("main")) ?? "", /141 Influenza/);
  assert.deepEqual(wrong, []);
  await page.goto(`${served.url}try/index.html`);
  await page.waitForSelector('body[data-engine="ready"]', { timeout: 60_000 });
  await page.close();

  const names: number[] = [];
  for (let at = 0; at < SAMPLES; at += 1) {
    const first = await browser.newContext();
    try {
      await first.addInitScript(recordDraws);
      const fresh = watched(await first.newPage());
      await fresh.goto(`${served.url}try/index.html`);
      names.push(await drawnAt(fresh, "names"));
    } finally {
      await first.close();
    }
  }
  withinBudget(
    "a first visit, until the tables' names are drawn",
    names,
    FIRST_VISIT_NAMES_BUDGET_MS,
  );
});

test("a demo person's new pod signs in at both hospitals in a popup through try/'s own service worker, asking for patient/*.rs as Node does, fetches what Node fetches, and joins what they agree on, a box's filter kept as each record comes in", async () => {
  const { person, patients, has } = joined;
  const page = watched(await profile.newPage());
  const said: string[] = [];
  page.on("console", (message) => said.push(message.text()));
  const secrets = new Set<string>();
  page.on("request", (request) => {
    const bearer = /^Bearer (.+)$/.exec(request.headers().authorization ?? "");
    if (bearer?.[1]) secrets.add(bearer[1]);
  });
  const signIn = async (hospital: string, again = false): Promise<Page> => {
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.click(
        `button:has-text("Sign in ${again ? "again " : ""}at ${view.hospitalName(hospital)}")`,
      ),
    ]);
    popup.on("framenavigated", (frame) => {
      const code = new URL(frame.url()).searchParams.get("code");
      if (code) secrets.add(code);
    });
    await popup.waitForSelector('button[value="allow"]');
    const scope = new URL(popup.url()).searchParams.get("scope") ?? "";
    assert.ok(
      scope.split(" ").includes("patient/*.rs"),
      `the sign-in asks for ${scope}`,
    );
    return popup;
  };
  /** Waits for the connection's box over the pod's page, open, with the pod's page behind it. */
  const boxed = async (): Promise<void> => {
    await settled(page);
    assert.ok(await page.isVisible("#connection"), "the box is not open");
    assert.equal(await page.textContent("main h1"), person.name);
  };
  const failed = async (): Promise<string> => {
    await boxed();
    const text = (await page.textContent("#connection .card .detail")) ?? "";
    await page.goto(page.url().split("#")[0] ?? "");
    await settled(page);
    return text;
  };

  await page.goto(`${served.url}try/index.html`);
  await settled(page);
  await newPod(page, view.familyFirst(person));
  assert.equal(await page.textContent("main h1"), person.name);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.match(
    (await page.evaluate(
      () => navigator.serviceWorker.controller?.scriptURL,
    )) ?? "",
    /\/try\/demo-hospital-worker\.js$/,
  );

  const [north = "", south = ""] = person.at.map(({ name }) => name);
  const cancelled = await signIn(north);
  const cancelledCloses = cancelled.waitForEvent("close");
  await cancelled.click('button[value="cancel"]');
  await cancelledCloses;
  await boxed();
  assert.match(
    (await page.textContent("#connection [role=alert]")) ?? "",
    /Cascade North.*cancelled/,
  );
  const again = await signIn(north, true);
  const againCloses = again.waitForEvent("close");
  await again.click('button[value="cancel"]');
  assert.match(await failed(), /cancel/);
  await againCloses;

  const closed = await signIn(north);
  await closed.close();
  assert.match(await failed(), /closed/);

  /** A box over the pod's page, by its address, and the text typed into its filter after the first record came in. */
  let box = "";
  let filter = "";
  for (const hospital of [north, south]) {
    const allowed = await signIn(hospital);
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = `data:text/html,<script>parent.postMessage({ type: "cascade-runtime:signed-in", url: "${location.origin}/try/signed-in.html?code=forged&state=forged" }, "*")</script>`;
      document.body.append(frame);
    });
    await allowed.check(
      `input[name="patient"][value="${patients.get(hospital)}"]`,
    );
    await allowed.click('button[value="allow"]');
    await boxed();
    assert.deepEqual(
      (await texts(page, "#connection .card p")).filter((line) =>
        line.startsWith("What "),
      ),
      has.get(hospital),
    );
    await page.evaluate(() => {
      const seen: string[] = [];
      Object.assign(globalThis, { bringing: seen });
      new MutationObserver(() => {
        const now = document.querySelector("#connection .steps li.now");
        const text = now?.textContent ?? "";
        if (text.startsWith("Bringing it in") && seen.at(-1) !== text)
          seen.push(text);
      }).observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await page.click("#connection button:has-text('Bring it into')");
    assert.equal(
      await page.textContent(".doing:not([hidden])"),
      "Bringing the record in…",
    );
    // A bring takes 70 s and more in Chromium on CI (#131, step 6 measures it): the second one passed 120 s.
    await settled(page, 300_000);
    assert.equal(
      await page.textContent("main .note"),
      `Brought in the record from ${view.hospitalName(hospital)}.`,
    );
    const bringing = await page.evaluate(
      () => (globalThis as unknown as { bringing: string[] }).bringing,
    );
    assert.deepEqual(
      [
        ...new Set(
          bringing.flatMap(
            (line) => /^Bringing it in: ([a-z ]+)/.exec(line)?.[1] ?? [],
          ),
        ),
      ],
      ["loading the adapter", "converting", "saving", "judging"],
      bringing.join("\n"),
    );
    assert.equal(await page.$("#connection"), null, "the box is still there");
    if (hospital === north) {
      box = (await page.getAttribute(".tiles .tile", "href")) ?? "";
      await page.click(`.tiles .tile[href="${box}"]`);
      filter = (await page.textContent(`${box} tbody td`)) ?? "";
      await page.fill(`${box} .filter`, filter);
      await page.mouse.click(5, 5);
    }
  }

  assert.equal(await page.inputValue(`${box} .filter`), filter);
  const rows = await page.$$eval(`${box} tbody tr`, (shown) =>
    shown.map((row) => [(row as HTMLElement).hidden, row.textContent ?? ""]),
  );
  for (const [hidden, text] of rows)
    assert.equal(
      hidden,
      !String(text).toLowerCase().includes(filter.toLowerCase()),
      `the filter did not survive the import: ${String(text)}`,
    );

  await page.waitForSelector('body[data-tables="ready"]', {
    timeout: 120_000,
  });
  // Node's look gives the lines that need no table; the tables add the one lisinopril line.
  const lines = await page.$$eval(".worth li", (found) =>
    found.map((each) => ({
      text: each.textContent ?? "",
      href: each.querySelector("a")?.getAttribute("href") ?? "",
    })),
  );
  const lisinopril =
    /lisinopril 10 .* and lisinopril 20 .* share an ingredient, lisinopril/i;
  assert.equal(
    lines.filter(({ text }) => lisinopril.test(text)).length,
    1,
    "Worth a look has no line, or two, for the two lisinopril doses",
  );
  const own = lines.filter(({ text }) => !lisinopril.test(text));
  assert.deepEqual(
    own.map(({ text }) => text),
    joined.worth,
  );
  assert.deepEqual(
    own.map(({ href }) => href),
    joined.worthLinks,
  );
  const rowsIn = (box: string): Promise<string[]> =>
    texts(page, `#see-${box} tbody tr`);
  const medicines = await rowsIn("medications");
  assert.equal(
    medicines.filter((row) => /loratadine/i.test(row)).length,
    1,
    `Claritin and loratadine are one medicine, among ${medicines.join("; ")}`,
  );
  assert.ok(!medicines.some((row) => /claritin/i.test(row)), "a brand row");
  const allergies = await rowsIn("allergies");
  assert.equal(
    allergies.filter((row) => /amoxicillin/i.test(row)).length,
    1,
    `the two amoxicillin allergies are one, among ${allergies.join("; ")}`,
  );
  assert.equal(
    allergies.length,
    (joined.held.get("AllergyIntolerance") ?? 0) - 1,
    `exactly the two amoxicillin allergies join, among ${allergies.join("; ")}`,
  );
  assert.ok(
    allergies.some((row) => /penicillin/i.test(row)) &&
      !allergies.some(
        (row) => /penicillin/i.test(row) && /amoxicillin/i.test(row),
      ),
    `penicillin stays apart from amoxicillin, among ${allergies.join("; ")}`,
  );
  for (const justification of [
    "SameBrandGeneric",
    "SameProductCode",
    "SameMappedCode",
  ])
    assert.ok(
      cites(joined.judged, justification),
      `no ${justification} judgment cites a table version`,
    );
  assert.ok(secrets.size >= 2, "the test saw no token or no code");
  const shown = await page.content();
  for (const secret of secrets) {
    assert.ok(!shown.includes(secret), "the page shows a token or a code");
    assert.ok(
      !said.some((line) => line.includes(secret)),
      "the console shows a token or a code",
    );
  }

  const both = [north, south].map(view.hospitalName);
  const pod = view.slug(person.name);
  const atBoth = joined.seenAtBoth;
  assert.ok(atBoth, `no entry was seen at both ${both.join(" and ")}`);
  await page.goto(
    `${served.url}try/index.html?pod=${pod}&entry=${encodeURIComponent(view.entryId(atBoth))}`,
  );
  await settled(page);
  const recorded = await page
    .locator("main li", { hasText: "Cascade recorded it at" })
    .innerText({ timeout: 60_000 });
  for (const name of both)
    assert.ok(recorded.includes(name), `${name} is not in: ${recorded}`);

  await page.goto(`${served.url}try/index.html?pod=${pod}`);
  await settled(page);
  await page.waitForSelector('body[data-tables="ready"]', {
    timeout: 120_000,
  });
  await page.click('a.tile[href="#see-medications"]');
  await inPlace(page, () =>
    page
      .locator("#see-medications tbody td:first-child a", {
        hasText: "oratadine",
      })
      .first()
      .click(),
  );
  const matched = await page
    .locator("main li .from", { hasText: "Matched using" })
    .first()
    .innerText({ timeout: 60_000 });
  assert.match(
    matched,
    /^Matched using .+, version \S+/,
    `the joined medication does not name the table and version: ${matched}`,
  );
});

test("in try/, a new pod for Tobias Fenn signed in at North names his hip condition by ICD-10-CM once for the retired code and the one that replaced it, and tags a retired CVX code and a retired LOINC code, the code that replaced it beside it untagged", async () => {
  const { person, patients, held, judged } = tobias;
  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await newPod(page, view.familyFirst(person));
    const [north = ""] = person.at.map(({ name }) => name);
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.click(`button:has-text("Sign in at ${view.hospitalName(north)}")`),
    ]);
    await popup.waitForSelector('button[value="allow"]');
    await popup.check(`input[name="patient"][value="${patients.get(north)}"]`);
    await popup.click('button[value="allow"]');
    await settled(page);
    await page.click("#connection button:has-text('Bring it into')");
    await settled(page, 300_000);
    await page.waitForSelector('body[data-tables="ready"]', {
      timeout: 120_000,
    });
    const rowsIn = (box: string): Promise<string[]> =>
      texts(page, `#see-${box} tbody tr`);
    const retired = (row: string): boolean => row.includes("Retired code");

    const conditions = await rowsIn("conditions");
    const hip = conditions.filter((row) => row.includes("Periprosthetic"));
    assert.equal(hip.length, 1, conditions.join("; "));
    assert.ok(
      !conditions.some((row) => row.includes("hip replacement")),
      "a row keeps the record's own text, not ICD-10-CM's name",
    );
    assert.ok(
      conditions.length < (held.get("Condition") ?? 0),
      "the two codes of the hip condition were not joined into one entry",
    );
    assert.ok(
      cites(judged, "SameConvertedCode"),
      "no one-to-one conversion judgment cites a table version",
    );

    const vaccines = await rowsIn("immunizations");
    const hepA = vaccines.filter((row) => row.includes("Hep A"));
    assert.equal(hepA.length, 1, vaccines.join("; "));
    assert.ok(retired(hepA[0] ?? ""), hepA.join("; "));
    const hdl = (await rowsIn("lab-results")).filter((row) =>
      /Cholesterol.in HDL/.test(row),
    );
    assert.equal(hdl.length, 2, hdl.join("; "));
    const [old, current] = [
      hdl.filter((row) => /Deprecated/.test(row)),
      hdl.filter((row) => !/Deprecated/.test(row)),
    ];
    assert.equal(old?.length, 1, hdl.join("; "));
    assert.ok(old?.every(retired), `the Deprecated row is tagged: ${hdl}`);
    assert.ok(
      current?.every((row) => !retired(row)),
      `the current row is untagged: ${hdl}`,
    );
  } finally {
    await context.close();
  }
});

/** The `data-key` of each row the lab results' table shows, in the column headed `head`. */
async function column(page: Page, head: string): Promise<string[]> {
  return page.$$eval(
    "#see-lab-results table",
    ([table], head) => {
      const heads = [...(table?.querySelectorAll("th") ?? [])].map(
        (th) => th.textContent ?? "",
      );
      const at = heads.findIndex((text) => text.startsWith(head));
      return [...(table?.querySelectorAll("tbody tr:not([hidden])") ?? [])].map(
        (row) => (row as HTMLTableRowElement).cells[at]?.dataset.key ?? "",
      );
    },
    head,
  );
}

test("in the lab results' box of the joined pod, a heading sorts by its column one way then the other, numbers as numbers, the filter keeps only the rows holding its text, and a click outside the box or Escape closes it", async () => {
  const page = watched(await profile.newPage());
  await page.goto(
    `${served.url}try/index.html?pod=${view.slug(joined.person.name)}`,
  );
  await settled(page);
  await page.waitForSelector('body[data-tables="ready"]', {
    timeout: 120_000,
  });
  await page.click('a.tile[href="#see-lab-results"]');
  const sort = (head: string): Promise<void> =>
    page.click(`#see-lab-results th button:has-text("${head}")`);

  const opened = await column(page, "Date");
  assert.ok(opened.length > 1);
  await sort("Date");
  assert.deepEqual(await column(page, "Date"), [...opened].reverse());
  await sort("Date");
  assert.deepEqual(await column(page, "Date"), opened);

  await sort("Value");
  const values = await column(page, "Value");
  const isNumber = (value: string): boolean =>
    value.trim() !== "" && Number.isFinite(Number(value));
  const numbers = values.filter(isNumber).map(Number);
  assert.ok(numbers.length > 1);
  assert.deepEqual(
    numbers,
    [...numbers].sort((a, b) => a - b),
  );
  assert.ok(values.slice(0, numbers.length).every(isNumber));

  const [first = ""] = await column(page, "Test");
  const rows = await texts(page, "#see-lab-results tbody tr");
  await page.fill("#see-lab-results .filter", first);
  const kept = await texts(page, "#see-lab-results tbody tr:not([hidden])");
  assert.deepEqual(
    kept,
    rows.filter((row) => row.toLowerCase().includes(first.toLowerCase())),
  );
  assert.ok(kept.length < rows.length, "the filter hid nothing");

  const open = (): Promise<boolean> => page.isVisible("#see-lab-results");
  await page.click("#see-lab-results h2");
  assert.ok(await open(), "a click in the box closed it");
  await page.mouse.click(5, 5);
  assert.ok(!(await open()), "a click outside the box left it open");
  await page.click('a.tile[href="#see-lab-results"]');
  assert.ok(await open());
  await page.keyboard.press("Escape");
  assert.ok(!(await open()), "Escape left the box open");
});

test("after a reload, the pods made in this browser are still on the left", async () => {
  const page = watched(await profile.newPage());
  await page.goto(`${served.url}try/index.html`);
  await settled(page);
  assert.deepEqual(
    (await texts(page, "nav a")).sort(),
    [
      "Alex Rivera",
      "Martin Okafor",
      "Priya Natarajan",
      "Tamsin Vale",
      joined.person.name,
    ].sort(),
  );
});

test("File, Delete all data empties the pods column, leaves no pod nor answers in the browser and says how many went, a later visit still has no pods, and Reset all data brings the four samples back", async () => {
  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    const before = await texts(page, "nav a");
    /** Opens File, picks `item`, and presses the confirming box's one button; waits for the page it draws in place. */
    const fromFile = async (item: string): Promise<void> => {
      await page.click('.menu summary:has-text("File")');
      await page.click(`.menu a:has-text(${JSON.stringify(item)})`);
      await inPlace(page, () => page.click(".dialog:target button"));
    };
    await fromFile("Delete all data");
    assert.deepEqual(await texts(page, "nav a"), []);
    assert.deepEqual(
      await page.evaluate(async () =>
        (await indexedDB.databases())
          .map(({ name }) => name ?? "")
          .filter((name) => /^cascade-(pod|answers):/.test(name)),
      ),
      [],
    );
    assert.equal(await page.textContent("main h1"), "No pods yet");
    assert.equal(
      await page.textContent("main .note"),
      `Deleted ${before.length} pods.`,
    );
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    assert.equal(await page.textContent("main h1"), "No pods yet");
    assert.deepEqual(await texts(page, "nav a"), []);
    await fromFile("Reset all data");
    assert.deepEqual(await texts(page, "nav a"), [
      "Alex Rivera",
      "Martin Okafor",
      "Priya Natarajan",
      "Tamsin Vale",
    ]);
    assert.equal(
      await page.textContent("main .note"),
      "Reset: Alex Rivera, Martin Okafor, Priya Natarajan and Tamsin Vale are back.",
    );
  } finally {
    await context.close();
  }
});

test("a first visit where no sample copies leaves no database, says there are no pods yet, and offers each sample to load, which loads it; a first visit to a sample's link copies them all and opens that sample, and to any other pod's link says it is not found", async () => {
  const link = await browser.newContext();
  try {
    const page = watched(await link.newPage());
    await page.goto(`${served.url}try/index.html?pod=martin-okafor`);
    await settled(page);
    assert.equal(await page.textContent("main h1"), "Martin Okafor");
    assert.equal((await texts(page, "nav a")).length, 4);
    await page.goto(`${served.url}try/index.html?pod=nobody`);
    await settled(page);
    assert.equal(await page.textContent("main h1"), "Not found");
  } finally {
    await link.close();
  }
  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    const samples =
      /\/(alex-rivera|martin-okafor|priya-natarajan|tamsin-vale)\/pod[/.]/;
    await page.route(samples, (route) => route.abort());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    assert.deepEqual(
      await page.evaluate(async () =>
        (await indexedDB.databases())
          .map(({ name }) => name ?? "")
          .filter((name) => name.startsWith("cascade-pod:")),
      ),
      [],
    );
    assert.equal(await page.textContent("main h1"), "No pods yet");
    assert.deepEqual(await texts(page, "nav a"), []);
    assert.deepEqual(await loadable(page), [
      ALEX,
      "martin-okafor",
      "priya-natarajan",
      "tamsin-vale",
    ]);

    await page.unroute(samples);
    await newPod(page, "Load Alex Rivera");
    assert.equal(await page.textContent("main h1"), "Alex Rivera");
    assert.deepEqual(await texts(page, "nav a"), ["Alex Rivera"]);
  } finally {
    await context.close();
  }
});

test("a failed copy whose database another connection holds open says so, and one into a database another copy filled keeps it", async () => {
  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    await page.route(
      /\/(alex-rivera|martin-okafor|priya-natarajan|tamsin-vale)\/pod[/.]/,
      (route) => route.abort(),
    );
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    const outcome = await page.evaluate(async () => {
      const { openPod } = (await import("cascade-runtime" as string)) as {
        openPod(name: string, options: { from: string }): Promise<unknown>;
      };
      const raw = (name: string) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const opening = indexedDB.open(name, 1);
          opening.onupgradeneeded = () =>
            opening.result.createObjectStore("files");
          opening.onsuccess = () => resolve(opening.result);
          opening.onerror = () => reject(opening.error);
        });
      const failure = (opening: Promise<unknown>) =>
        Promise.race([
          opening.then(
            () => "opened",
            (error: unknown) => (error as Error).message,
          ),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("still waiting"), 5_000),
          ),
        ]);

      const holder = await raw("cascade-pod:held");
      const held = await failure(openPod("held", { from: "../nowhere/" }));
      holder.close();

      const fetched = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("/raced/")) return fetched(input, init);
        if (url.endsWith("/files.json")) return Response.json(["mine.ttl"]);
        const other = await raw("cascade-pod:raced");
        await new Promise<void>((resolve, reject) => {
          const writing = other.transaction("files", "readwrite");
          writing
            .objectStore("files")
            .put(new TextEncoder().encode("theirs"), "theirs.ttl");
          writing.oncomplete = () => resolve();
          writing.onerror = () => reject(writing.error);
        });
        other.close();
        throw new TypeError("this copy failed");
      };
      const raced = await failure(openPod("raced", { from: "../raced/" }));
      globalThis.fetch = fetched;
      const kept = await raw("cascade-pod:raced");
      const paths = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const keys = kept
          .transaction("files")
          .objectStore("files")
          .getAllKeys();
        keys.onsuccess = () => resolve(keys.result);
        keys.onerror = () => reject(keys.error);
      });
      kept.close();
      return { held, raced, kept: paths.map(String) };
    });
    assert.equal(outcome.raced, "this copy failed");
    assert.deepEqual(outcome.kept, ["theirs.ttl"]);
    assert.match(outcome.held, /has no files\.json.*cascade-pod:held/);
  } finally {
    await context.close();
  }
});

/** What a pod shows after an import, its own address left out, so two pods compare. */
interface After {
  readonly refused?: string;
  readonly claimed: number;
  readonly unclaimed: number;
  readonly rows: string[][];
}

const QUESTIONS = ["pod/My active allergies", "pod/My active medications"];

/** The import and the rows of the questions after it; self-contained, so the page runs it from its source as Node does. */
async function shownAfter(
  pod: Pod,
  imported: Imported,
  questions: readonly string[],
): Promise<After> {
  const rows: string[][] = [];
  for (const question of questions)
    for (const row of await pod.ask(question))
      rows.push([
        question,
        ...Object.entries(row)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(
            ([column, value]) =>
              `${column}=${value.startsWith(pod.address) ? value.slice(pod.address.length) : value}`,
          ),
      ]);
  return {
    ...(imported.refused === undefined ? {} : { refused: imported.refused }),
    claimed: imported.claimed.length,
    unclaimed: imported.unclaimed.length,
    rows: rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  };
}

test("in the browser, look and import read the files a person picks as Node reads them by path, the Bridge in a Web Worker started by the first import, each import loading only the adapter of its documents", async () => {
  const config = await servedConfig();
  const packed = JSON.parse(
    await readFile(join(SERVED, "packed.json"), "utf8"),
  ) as {
    readonly components: readonly {
      readonly repository: string;
      readonly commit: string;
    }[];
  };
  const carried = packed.components.map(
    ({ repository, commit }) => `${repository}/tree/${commit}/`,
  );
  const vocabulary = packed.components.find(
    ({ repository }) => repository === config.vocabulary.repository,
  );
  assert.ok(vocabulary);
  const { repository } = config.vocabulary;
  const kits = join(
    SERVED,
    repository.slice(repository.lastIndexOf("/") + 1),
    vocabulary.commit,
    "conformance",
  );
  const picked = [
    join(
      kits,
      "alex-rivera/scripted-input/alex/downloads/x-e2/apple_health_export",
    ),
    join(
      kits,
      "priya-natarajan/scripted-input/priya/downloads/kestrel-harbor-health-summary.xml",
    ),
  ];

  const node = await pageTablesPod();
  const expected: { look: unknown; after: After }[] = [];
  try {
    for (const path of picked)
      expected.push({
        look: await node.look(path),
        after: await shownAfter(
          node,
          await node.import(path, { aboutSubject: true }),
          QUESTIONS,
        ),
      });
  } finally {
    await node.close();
  }

  const page = watched(await browser.newPage());
  await page.addInitScript(() => {
    const loads: string[] = [];
    (globalThis as unknown as { bridgeLoads: string[] }).bridgeLoads = loads;
    const post = Worker.prototype.postMessage as (
      this: Worker,
      ...args: unknown[]
    ) => void;
    Worker.prototype.postMessage = function (
      this: Worker,
      message: unknown,
      ...rest: unknown[]
    ) {
      const request = (
        message as {
          request?: {
            op?: string;
            adapter?: { iri: string };
            vocabulary?: { iri: string };
          };
        }
      )?.request;
      if (request?.op === "load")
        loads.push(
          ...[request.adapter?.iri, request.vocabulary?.iri].flatMap(
            (iri) => iri ?? [],
          ),
        );
      return post.call(this, message, ...rest);
    };
  });
  let workers = 0;
  page.on("worker", (worker) => {
    if (worker.url().endsWith("/wasm-worker.js")) workers += 1;
  });
  const tablesWorker = page.waitForEvent("worker", {
    predicate: (worker) => worker.url().endsWith("/tables-worker.js"),
    timeout: 120_000,
  });
  await page.goto(`${served.url}try/index.html`);
  await settled(page);
  await tablesWorker;
  await page.evaluate(() => {
    for (const [id, folder] of [
      ["pick-folder", true],
      ["pick-file", false],
    ] as const) {
      const input = document.createElement("input");
      input.type = "file";
      input.id = id;
      input.webkitdirectory = folder;
      document.body.append(input);
    }
  });
  const [folder = "", file = ""] = picked;
  await page.setInputFiles("#pick-folder", folder);
  await page.setInputFiles("#pick-file", file);
  await page.evaluate(async () => {
    const { openPod } = (await import(
      "cascade-runtime" as string
    )) as typeof import("cascade-runtime");
    (globalThis as unknown as { pod: Pod }).pod = await openPod();
  });

  const adapters = config.adapters.map(
    ({ repository }) =>
      carried.find((iri) => iri.startsWith(`${repository}/tree/`)) ?? "",
  );
  /** The adapters loaded into the Bridge by the end of each import. */
  const loadedAfter: Set<string>[] = [];
  for (const [at, id] of ["pick-folder", "pick-file"].entries()) {
    const want = expected[at];
    assert.ok(want);
    const look = await page.evaluate(async (id) => {
      const input = document.getElementById(id) as HTMLInputElement;
      const files = new Map(
        [...(input.files ?? [])].map((file) => [
          file.webkitRelativePath || file.name,
          file,
        ]),
      );
      (globalThis as unknown as { picked: Map<string, File> }).picked = files;
      return (globalThis as unknown as { pod: Pod }).pod.look(files);
    }, id);
    assert.deepEqual(look, want.look, id);
    if (at === 0) assert.equal(workers, 0, "a look started a worker");
    const got = await page.evaluate(
      async ({ questions, source }) => {
        const scope = globalThis as unknown as {
          pod: Pod;
          picked: Map<string, File>;
        };
        const run = new Function(`return ${source}`)() as (
          pod: Pod,
          imported: Imported,
          questions: readonly string[],
        ) => Promise<After>;
        return run(
          scope.pod,
          await scope.pod.import(scope.picked, { aboutSubject: true }),
          questions,
        );
      },
      { questions: QUESTIONS, source: shownAfter.toString() },
    );
    assert.deepEqual(got, want.after, id);
    loadedAfter.push(
      new Set(
        (
          await page.evaluate(
            () =>
              (globalThis as unknown as { bridgeLoads: string[] }).bridgeLoads,
          )
        ).filter((iri) => adapters.includes(iri)),
      ),
    );
  }
  assert.ok(workers > 0, "no import started a worker");
  const loads = await page.evaluate(
    () => (globalThis as unknown as { bridgeLoads: string[] }).bridgeLoads,
  );
  const [first, both] = loadedAfter;
  assert.equal(first?.size, 1, `the first import loaded ${[...(first ?? [])]}`);
  assert.deepEqual(both, new Set(adapters));
  for (const iri of loads) assert.ok(carried.includes(iri), iri);
});

test("in the browser, a check keeps the test feed's planted newer version in the app's own database, and a pod opened after it adopts it: the version is recorded, the Same it newly joins is filed and the one that used the replaced version filed again", async () => {
  const [feedUrl] = (await servedConfig()).tables.feeds;
  assert.ok(feedUrl);
  const valid = join(
    ROOT,
    "node_modules",
    "cascade-reference-tables",
    "fixtures",
    "feeds",
    "valid",
  );
  const catalog = turtle(await readFile(join(valid, "feed.ttl")), feedUrl);
  const of = (subject: string, predicate: string): string | undefined =>
    catalog.find(([s, p]) => s.value === subject && p.value === predicate)?.[2]
      .value;
  const series =
    catalog.find(([, , o]) => o.value.endsWith("#VaccineGroups"))?.[0].value ??
    "";
  const second = of(series, `${DCAT}hasCurrentVersion`) ?? "";
  const first = of(second, `${PROV}wasRevisionOf`) ?? "";
  assert.ok(first);
  const bodies = new Map<string, Buffer>();
  for (const [, predicate, url] of catalog)
    if (predicate.value === `${DCAT}downloadURL`)
      bodies.set(
        url.value,
        await readFile(
          join(valid, ...new URL(url.value).pathname.split("/").slice(-2)),
        ),
      );
  const feedOf = (current: (version: string) => string): string =>
    ntriples(
      catalog.map(([s, p, o]) =>
        p.value === `${DCAT}hasCurrentVersion`
          ? [s, p, oxigraph.namedNode(current(o.value))]
          : [s, p, o],
      ),
    );
  let feed = feedOf(
    (version) => of(version, `${PROV}wasRevisionOf`) ?? version,
  );
  const context = await browser.newContext();
  try {
    await context.route(
      (url) => url.href === feedUrl || bodies.has(url.href),
      (route) => {
        const url = route.request().url();
        return route.fulfill(
          url === feedUrl
            ? { body: feed, contentType: "text/turtle" }
            : { body: bodies.get(url) ?? "" },
        );
      },
    );
    await context.route(new URL("checked.json", feedUrl).href, (route) =>
      route.fulfill({ status: 404 }),
    );
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    interface Runtime {
      checkTables(): Promise<{ kept: string[]; refused: unknown[] }[]>;
      openPod(name: string): Promise<{
        subject: string;
        owner: string;
        opened?: { refused?: string; unheld: string[] };
        enter(turtle: string): Promise<{ refused?: string }>;
        ask(
          question: string | { query: string },
        ): Promise<Record<string, string>[]>;
        close(): Promise<void>;
      }>;
    }
    const entered = await page.evaluate(async () => {
      const runtime = (await import("cascade-runtime" as string)) as Runtime;
      await runtime.checkTables();
      const pod = await runtime.openPod("tables-proof");
      const shots = [
        ["141", "2025-10-01"],
        ["150", "2025-10-01"],
        ["140", "2024-10-01"],
        ["141", "2024-10-01"],
      ].map(
        (
          [code, date],
          index,
        ) => `<urn:cascade:output-${index}> a <https://ns.cascadeprotocol.org/health/v1#ImmunizationRecord> .
<urn:cascade:output-${index}-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-${index}> ;
  <https://ns.cascadeprotocol.org/health/v1#vaccineCode> "${code}" ;
  <https://ns.cascadeprotocol.org/health/v1#administrationDate> "${date}"^^<http://www.w3.org/2001/XMLSchema#date> ;
  <https://ns.cascadeprotocol.org/records/v1-draft#patient> <${pod.subject}> .`,
      );
      const done =
        await pod.enter(`<urn:cascade:this-entry> a <http://www.w3.org/ns/prov#Activity> ;
  <http://www.w3.org/ns/prov#qualifiedAssociation> [ <http://www.w3.org/ns/prov#agent> <${pod.owner}> ;
    <http://www.w3.org/ns/prov#hadRole> <https://ns.cascadeprotocol.org/judgments/v1-draft#patient> ] .
${shots.join("\n")}`);
      await pod.close();
      return done;
    });
    assert.equal(entered.refused, undefined);

    feed = feedOf((version) => version);
    const after = await page.evaluate(
      async ({ series, first, second }) => {
        const runtime = (await import("cascade-runtime" as string)) as Runtime;
        const checked = await runtime.checkTables();
        const pod = await runtime.openPod("tables-proof");
        try {
          const current = await pod.ask({
            query: `SELECT ?version WHERE { <${series}> <http://purl.org/pav/hasCurrentVersion> ?version }`,
          });
          const sames = await pod.ask({
            query: `SELECT ?used (GROUP_CONCAT(?code; separator=" ") AS ?codes) WHERE {
              ?judgment <https://ns.cascadeprotocol.org/judgments/v1-draft#justification> <https://ns.cascadeprotocol.org/judgments/v1-draft#SameMappedCodeAndDate> ;
                <http://www.w3.org/ns/prov#used> ?used ; <http://www.w3.org/ns/prov#hadMember> ?record .
              VALUES ?used { <${first}> <${second}> }
              ?record <http://purl.org/pav/hasCurrentVersion>/<https://ns.cascadeprotocol.org/health/v1#vaccineCode> ?code
            } GROUP BY ?judgment ?used`,
          });
          return {
            kept: checked.flatMap(({ kept }) => kept),
            opened: pod.opened,
            current,
            sames,
            databases: (await indexedDB.databases()).map(
              ({ name }) => name ?? "",
            ),
          };
        } finally {
          await pod.close();
        }
      },
      { series, first, second },
    );
    assert.ok(after.kept.includes(second));
    assert.equal(after.opened?.refused, undefined);
    assert.deepEqual(after.opened?.unheld, []);
    assert.deepEqual(after.current, [{ version: second }]);
    assert.deepEqual(
      after.sames
        .map(
          ({ used = "", codes = "" }) =>
            `${used === first ? "first" : "second"}: ${codes.split(" ").sort().join(" ")}`,
        )
        .sort(),
      ["first: 141 150", "second: 140 141", "second: 141 150"],
    );
    assert.ok(
      after.databases.some((name) => name.endsWith(":cascade-tables")),
      `no tables database among ${after.databases.join(", ")}`,
    );

    await page.goto(
      `${served.url}try/index.html?table=${series.replace(/^urn:uuid:/, "")}&q=141`,
    );
    await settled(page);
    const label = of(series, "http://www.w3.org/2000/01/rdf-schema#label");
    assert.ok(label);
    assert.equal(await page.locator("main h1").innerText(), label);
    assert.equal(
      await page.locator("aside section.tables a[aria-current]").count(),
      1,
      "the table's source is not marked in the sidebar",
    );
    const shown = await page.locator("main").innerText();
    assert.ok(
      shown.includes(
        `Using version ${of(second, "http://purl.org/pav/version") ?? ""}`,
      ),
      shown,
    );
    assert.deepEqual(
      await page.locator("table.codes tbody td:first-child").allInnerTexts(),
      ["141"],
    );
    assert.ok(shown.includes("Tables Proof"), shown);
    await inPlace(page, () => page.click("section.tables button"));
    assert.match(
      await page.locator("p.note").innerText(),
      /^Checked the feeds: nothing new\.$/,
    );

    const said = await page.evaluate(async () => {
      const runtime = (await import("cascade-runtime" as string)) as Runtime & {
        appTables(): Promise<{
          about(codes: string[]): Promise<
            Map<
              string,
              {
                name?: { label: string };
                status?: { deprecated: boolean; replacedBy: string[] };
              }
            >
          >;
        }>;
      };
      const pod = await runtime.openPod("tables-proof");
      try {
        const shots = ["57", "03"].map(
          (
            code,
          ) => `<urn:cascade:output-${code}> a <https://ns.cascadeprotocol.org/health/v1#ImmunizationRecord> .
<urn:cascade:output-${code}-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-${code}> ;
  <https://ns.cascadeprotocol.org/health/v1#vaccineCode> "${code}" ;
  <https://ns.cascadeprotocol.org/health/v1#administrationDate> "2020-01-01"^^<http://www.w3.org/2001/XMLSchema#date> ;
  <https://ns.cascadeprotocol.org/records/v1-draft#patient> <${pod.subject}> .`,
        );
        await pod.enter(`<urn:cascade:this-entry> a <http://www.w3.org/ns/prov#Activity> ;
  <http://www.w3.org/ns/prov#qualifiedAssociation> [ <http://www.w3.org/ns/prov#agent> <${pod.owner}> ;
    <http://www.w3.org/ns/prov#hadRole> <https://ns.cascadeprotocol.org/judgments/v1-draft#patient> ] .
${shots.join("\n")}`);
        const given = await pod.ask("pod/My immunizations");
        const reviewed = new Set(
          (await pod.ask("entry/What needs review")).map(({ entry }) => entry),
        );
        const about = await (
          await runtime.appTables()
        ).about(given.map(({ code = "" }) => code));
        return given.map(({ code = "", entry = "" }) => ({
          label: about.get(code)?.name?.label ?? "",
          retired: about.get(code)?.status?.deprecated === true,
          review: reviewed.has(entry),
        }));
      } finally {
        await pod.close();
      }
    });
    assert.ok(
      said.some(({ label }) => label !== ""),
      "the names series names no shot",
    );
    assert.ok(
      said.some(({ retired }) => retired),
      "the status series retires no shot",
    );
    await page.goto(
      `${served.url}try/index.html?pod=tables-proof#see-immunizations`,
    );
    await settled(page);
    await page.waitForSelector('body[data-tables="ready"]');
    assert.deepEqual(
      (
        await page
          .locator("#see-immunizations tbody td:first-child")
          .allTextContents()
      ).sort(),
      said
        .map(
          ({ label, retired, review }) =>
            `${label}${review ? " Needs review" : ""}${retired ? " Retired code" : ""}`,
        )
        .sort(),
    );

    const retired = said.find((each) => each.retired);
    assert.ok(retired);
    const opened = (title: string): Promise<boolean> =>
      page
        .waitForFunction(
          (expected) =>
            document
              .querySelector("main h1")
              ?.textContent?.startsWith(expected),
          title,
        )
        .then(() => true);
    await inPlace(page, async () => {
      await page
        .locator("#see-immunizations tbody tr")
        .filter({ hasText: retired.label })
        .locator("td:first-child a")
        .click();
      await opened(retired.label);
    });
    assert.ok(new URL(page.url()).searchParams.has("entry"));
    assert.ok(
      (await page.locator("main h1 .tag").allInnerTexts()).includes(
        "Retired code",
      ),
      "the entry's heading does not tag the retired code",
    );
    const code = page.locator('main a[href*="code="]').first();
    const notation = (await code.innerText()).trim();
    await inPlace(page, async () => {
      await code.click();
      await opened(notation);
    });
    const at = new URL(page.url()).searchParams;
    assert.ok(at.has("table"));
    assert.equal(at.get("code"), notation);
    for (const expected of [retired.label, "Tables Proof"])
      await inPlace(page, async () => {
        await page.goBack();
        await opened(expected);
      });
    assert.equal(new URL(page.url()).hash, "#see-immunizations");
    assert.ok(
      await page.locator("#see-immunizations").isVisible(),
      "Back does not open the box the row was in",
    );
  } finally {
    await context.close();
  }
});

test("in try/, Martin's pod, copied on a first visit, has a Genetic variants tile whose rows open each variant's entry once the engine is ready: the MLH1 variant's two reports with their labs and what ClinVar says today, a gene the series does not cover, and a variant it holds no row for, then the counsellor sentence and ClinVar's disclaimer; a row opens its entry with no request, each address shape the pod's page and the entry link opens a page, and the pages reach their table-dependent line within twice their budgets", async () => {
  const context = await browser.newContext();
  await context.addInitScript(recordDraws);
  try {
    const page = watched(await context.newPage());
    let tablesWorkers = 0;
    const counted = (worker: PageWorker): void => {
      if (worker.url().endsWith("/tables-worker.js")) tablesWorkers += 1;
    };
    page.on("worker", counted);
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await page.waitForSelector('body[data-tables="ready"]', {
      timeout: 60_000,
    });
    page.off("worker", counted);
    assert.equal(tablesWorkers, 1, "the starter is copied in one worker");
    await page.goto(
      `${served.url}try/index.html?pod=martin-okafor#see-genetic-variants`,
    );
    await settled(page);
    assert.equal(await page.textContent("main h1"), "Martin Okafor");
    await page.waitForSelector('body[data-tables="ready"]', {
      timeout: 120_000,
    });
    const rows = page.locator("#see-genetic-variants tbody tr");
    assert.equal(
      (await tiles(page)).get("Genetic variants"),
      await rows.count(),
      "the tile counts its rows",
    );
    assert.equal(
      await page.locator("main .variants, main .variant").count(),
      0,
    );
    const mlh1 = rows.filter({ hasText: "p.Ala681Val" });
    assert.match(
      await mlh1.innerText(),
      /NM_000249\.4\(MLH1\):c\.2042C>T \(p\.Ala681Val\)/,
      "the MLH1 row is not named by ClinVar",
    );
    assert.match(
      await mlh1.innerText(),
      /Differs/,
      "the MLH1 row is not tagged",
    );
    const mlh1Href = await mlh1
      .locator("td:first-child a")
      .getAttribute("href");
    const worth = page
      .locator(".worth li")
      .filter({ hasText: "your 2022 report from Harbourline Genetics" });
    assert.equal(await worth.count(), 1, "Worth a look has no line for MLH1");
    assert.equal(
      await worth.locator("a").getAttribute("href"),
      mlh1Href,
      "the line does not link to the entry the MLH1 row opens",
    );
    assert.match(
      await worth.innerText(),
      /differs from ClinVar today\.\s*Differs$/,
    );
    const body = async (): Promise<string> =>
      ((await page.locator("main").innerText()) ?? "").replace(/\s+/g, " ");
    const clicks: number[] = [];
    const requested: string[] = [];
    const feedHome = new URL(".", (await servedConfig()).tables.feeds[0]).href;
    page.on("request", (request) => {
      const url = request.url();
      if (/^https?:/.test(url) && !url.startsWith(feedHome))
        requested.push(url);
    });
    const opens = async (row: Locator): Promise<void> => {
      requested.length = 0;
      await inPlace(page, () => row.locator("td:first-child a").click());
      assert.ok(new URL(page.url()).searchParams.has("entry"));
      assert.deepEqual(
        requested,
        [],
        "a click from a row to its entry asked for something",
      );
      clicks.push(await drawnAt(page, "clinvar"));
    };
    const back = async (): Promise<void> => {
      await inPlace(page, () => page.goBack());
      assert.equal(new URL(page.url()).hash, "#see-genetic-variants");
      assert.ok(
        await page.locator("#see-genetic-variants").isVisible(),
        "Back does not open the box the row was in",
      );
    };

    await opens(mlh1);
    const entryUrl = page.url();
    const entry = await body();
    for (const sentence of [
      "Your 2022 report from Harbourline Genetics said uncertain significance.",
      "Your 2024 report from St Columba's Hospital said likely pathogenic.",
      "ClinVar today says pathogenic/likely pathogenic: criteria provided, multiple submitters, no conflicts, five contributing submitters.",
      "Your clinician or a genetic counsellor can explain what this means for you.",
    ])
      assert.ok(entry.includes(sentence), `${sentence} is not in ${entry}`);
    assert.match(
      await page
        .locator("main li")
        .filter({ hasText: "Your 2022 report" })
        .innerText(),
      /Differs/,
    );
    assert.match(
      entry,
      /not intended for direct diagnostic use or medical decision-making without review by a genetics professional/i,
    );
    await back();

    await opens(rows.filter({ hasText: "BRCA2" }));
    assert.match(
      await body(),
      /ClinVar, as this app holds it, covers .*, not BRCA2\./,
    );
    await back();

    await opens(rows.filter({ hasText: "NM_001258271" }));
    assert.ok(
      (await body()).includes(
        "ClinVar, as this app holds it, has no row for this variant.",
      ),
    );

    const podUrl = `${served.url}try/index.html?pod=martin-okafor`;
    const opened = async (fresh: Page, address: string): Promise<void> => {
      await fresh.goto(address);
      await settled(fresh);
      await fresh.waitForSelector('body[data-tables="ready"]', {
        timeout: 120_000,
      });
    };
    const times: Record<keyof typeof BUDGET_MS, number[]> = {
      "Martin's pod page, a new load, until the MLH1 Differs line": [],
      "Martin's pod page, a reload, until the MLH1 Differs line": [],
      "the MLH1 entry, a new load, until the ClinVar sentence": [],
      "the MLH1 entry, a reload, until the ClinVar sentence": [],
      "a click on a Genetic variants row, until the ClinVar sentence": clicks,
    };
    for (const [loads, reloads, address, what] of [
      [
        "Martin's pod page, a new load, until the MLH1 Differs line",
        "Martin's pod page, a reload, until the MLH1 Differs line",
        podUrl,
        "differs",
      ],
      [
        "the MLH1 entry, a new load, until the ClinVar sentence",
        "the MLH1 entry, a reload, until the ClinVar sentence",
        entryUrl,
        "clinvar",
      ],
    ] as const) {
      for (let at = 0; at < SAMPLES; at += 1) {
        const fresh = watched(await context.newPage());
        await opened(fresh, address);
        times[loads].push(await drawnAt(fresh, what));
        await fresh.close();
      }
      const fresh = watched(await context.newPage());
      await opened(fresh, address);
      for (let at = 0; at < SAMPLES; at += 1) {
        await fresh.reload();
        await settled(fresh);
        times[reloads].push(await drawnAt(fresh, what));
      }
      await fresh.close();
    }
    for (const [what, budget] of Object.entries(BUDGET_MS))
      withinBudget(what, times[what as keyof typeof BUDGET_MS], budget);

    const shapes = async (
      fresh: Page,
    ): Promise<{ shape: string; href: string }[]> => {
      const found = new Map<string, string>();
      for (const href of await fresh.$$eval('a[href^="?"]', (links) =>
        links.map((link) => link.getAttribute("href") ?? ""),
      ))
        if (!found.has(shapeOf(href))) found.set(shapeOf(href), href);
      return [...found].map(([shape, href]) => ({ shape, href }));
    };
    for (const address of [podUrl, entryUrl]) {
      const fresh = watched(await context.newPage());
      await opened(fresh, address);
      const found = await shapes(fresh);
      assert.ok(found.length > 1, `${address} links one shape of address`);
      for (const { shape, href } of found) {
        await opened(fresh, address);
        await inPlace(fresh, () =>
          fresh
            .locator(`a[href="${href}"]`)
            .first()
            .evaluate((link) => (link as HTMLElement).click()),
        );
        assert.ok(
          !["Not found", "Something went wrong"].includes(
            (await fresh.textContent("main h1")) ?? "",
          ),
          `${address} links ${href} (${shape}), which draws a page that is not found`,
        );
      }
      await fresh.close();
    }
  } finally {
    await context.close();
  }
});

test("in try/, Priya's pod, copied on a first visit, names her potassium result by LOINC once the tables are ready, her potassium result opens the electrolytes panel with her tests in LOINC's order and the required ones she has no result for, and its class page puts her amlodipine in its ingredient's class and says FDA classes a different form of her lisinopril, so it has none", async () => {
  const context = await browser.newContext();
  await context.addInitScript(recordDraws);
  try {
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await page.waitForSelector('body[data-tables="ready"]', {
      timeout: 60_000,
    });
    await page.goto(
      `${served.url}try/index.html?pod=priya-natarajan#see-lab-results`,
    );
    await settled(page);
    await page.waitForSelector('body[data-tables="ready"]', {
      timeout: 120_000,
    });
    const tests = (
      await page
        .locator("#see-lab-results tbody td:first-child")
        .allInnerTexts()
    ).map((text) => text.trim());
    assert.ok(
      tests.includes("Potassium [Moles/volume] in Serum or Plasma"),
      `no potassium result is named by LOINC among ${tests.join("; ")}`,
    );
    assert.ok(
      !tests.includes("Potassium"),
      "a result keeps the record's own name",
    );
    await inPlace(page, () =>
      page
        .locator("#see-lab-results tbody td:first-child a", {
          hasText: "Potassium",
        })
        .first()
        .click(),
    );
    await page.waitForSelector("text=In LOINC panels", { timeout: 60_000 });
    await inPlace(page, () => page.locator('main a[href$="24326-1"]').click());
    await page.waitForFunction(
      () =>
        document
          .querySelector("main h1")
          ?.textContent?.startsWith("Your results in"),
      undefined,
      { timeout: 120_000 },
    );
    const panel = ((await page.locator("main").innerText()) ?? "").replace(
      /\s+/g,
      " ",
    );
    const at = (word: string): number => panel.lastIndexOf(word);
    assert.ok(
      at("Sodium") > -1 &&
        at("Sodium") < at("Potassium") &&
        at("Potassium") < at("Chloride"),
      `her tests are not in LOINC's order in ${panel}`,
    );
    for (const said of ["required", "No result", "missing: "])
      assert.ok(panel.includes(said), `${said} is not in ${panel}`);
    assert.ok(
      !((await page.textContent("aside section.tables")) ?? "").includes(
        "Loading",
      ),
      "the sidebar still says the tables are loading",
    );
    await page.goto(`${served.url}try/index.html?pod=priya-natarajan`);
    await settled(page);
    await inPlace(page, () =>
      page.click(".tiles .tile-box:has(.kind:text-is('Medications')) a.by"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("main h1")?.textContent === "Medicines by class",
      undefined,
      { timeout: 120_000 },
    );
    await page.waitForSelector("main .card h2", { timeout: 120_000 });
    const body = ((await page.locator("main").innerText()) ?? "").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      "Calcium Channel Blocker [EPC]",
      "amlodipine 5 MG Oral Tablet through amlodipine",
      "lisinopril 10 MG Oral Tablet: FDA classes a different form of lisinopril; RxNorm does not tie this product to it.",
    ])
      assert.ok(body.includes(said), `${said} is not in ${body}`);
    assert.ok(
      !body.includes("Angiotensin Converting Enzyme Inhibitor [EPC]"),
      "lisinopril is given the class FDA gives lisinopril anhydrous",
    );
  } finally {
    await context.close();
  }
});

test("in try/, Ines Calloway's new pod signed in at North says what changed after atorvastatin started and registers the trend and the pod's change tools with the model context, opens the trend at its address, and going to another pod takes every tool away", async () => {
  const demo = await loadHospitals();
  const ines = view
    .demoPeople(demo)
    .find(({ name }) => name === "Ines Calloway");
  assert.ok(ines, "no demo person is Ines Calloway");
  const [north] = ines.at;
  assert.ok(north && ines.at.length === 1, "Ines is not at North alone");
  const loaded = demo.find((each) => each.hospital.fhirBase === north.fhirBase);
  const patient = Object.entries(loaded?.patients ?? {}).find(
    ([, bundle]) => view.patientName(bundle) === ines.name,
  )?.[0];
  assert.ok(patient, "North holds no patient Ines Calloway");

  const context = await browser.newContext();
  await context.addInitScript(recordTools);
  await context.addInitScript(lagEffects);
  try {
    const page = watched(await context.newPage());
    const live = (): Promise<string[]> =>
      page.evaluate(() =>
        (globalThis as unknown as Registered).registered
          .filter(({ signal }) => !signal.aborted)
          .map(({ name }) => name)
          .sort(),
      );
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await newPod(page, view.familyFirst(ines));
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.click(
        `button:has-text("Sign in at ${view.hospitalName(north.name)}")`,
      ),
    ]);
    await popup.waitForSelector('button[value="allow"]');
    await popup.check(`input[name="patient"][value="${patient}"]`);
    await popup.click('button[value="allow"]');
    await settled(page);
    await page.click("#connection button:has-text('Bring it into')");
    await settled(page, 300_000);

    const card = page.locator(".change");
    await card.first().waitFor({ timeout: 60_000 });
    assert.equal(await card.count(), 1);
    const said = (await card.innerText()).replace(/\s+/g, " ");
    assert.match(said, /was lower after .+ started\./);
    assert.ok(
      said.includes(
        "162 → 98.3 mg/dL, the mean of 3 results before and 3 after",
      ),
      said,
    );

    const tools = changeTools({ ask: async () => [] }).map(({ name }) => name);
    await page.waitForFunction(() =>
      (globalThis as unknown as Registered).registered.some(
        ({ name, signal }) => name === "show_trend" && !signal.aborted,
      ),
    );
    assert.deepEqual(await live(), ["show_trend", ...tools].sort());

    await inPlace(page, () =>
      page.click('.change a:has-text("Open the trend")'),
    );
    const query = new URL(page.url()).searchParams;
    assert.deepEqual(
      [
        query.get("pod"),
        query.has("trend"),
        query.get("test"),
        query.get("medication"),
      ],
      ["ines-calloway", true, "18262-6", "617310"],
    );
    const chart = page.locator("svg.chart.large");
    assert.equal(await chart.locator("circle.marker").count(), 6);
    assert.equal(
      await chart.locator("title").first().textContent(),
      await page.textContent("main h1"),
    );
    assert.deepEqual(await live(), ["show_trend", ...tools].sort());

    const recorded = await page.evaluate(
      () => (globalThis as unknown as Registered).registered.length,
    );
    await page.evaluate(() => {
      Object.assign(globalThis, { effectsHeld: true });
    });
    await inPlace(page, () => page.click('nav a:has-text("Alex Rivera")'));
    assert.equal(await page.textContent("main h1"), "Alex Rivera");
    assert.ok(
      await page.evaluate(
        (count) =>
          (globalThis as unknown as Registered).registered
            .slice(0, count)
            .every(({ signal }) => signal.aborted),
        recorded,
      ),
      "a tool of the pod left is still registered",
    );
    assert.deepEqual(await live(), [...tools].sort());

    await page.goto(`${served.url}try/index.html?pod=ines-calloway&classes`);
    await settled(page);
    await page.waitForFunction(
      () =>
        document.querySelector("main h1")?.textContent === "Medicines by class",
      undefined,
      { timeout: 120_000 },
    );
    await page.waitForSelector("main .card h2", { timeout: 120_000 });
    const estrogen = (
      await page
        .locator("main .card", {
          has: page.locator("h2", { hasText: "Estrogen [EPC]" }),
        })
        .innerText()
    ).replace(/\s+/g, " ");
    assert.match(
      estrogen,
      /stradiol 1 (mg tablet|MG Oral Tablet) through estradiol/i,
    );
  } finally {
    await context.close();
  }
});

test("in try/, the world's date set before a sign-in shows on the hospital's sign-in page and in the box as the date the pull was made under, survives the worker being stopped, and Today takes it away; a typed date that is no date and a pod named Con are each Not done, saying why", async () => {
  const demo = await loadHospitals();
  const ines = view
    .demoPeople(demo)
    .find(({ name }) => name === "Ines Calloway");
  assert.ok(ines, "no demo person is Ines Calloway");
  const [north] = ines.at;
  assert.ok(north && ines.at.length === 1, "Ines is not at North alone");
  const loaded = demo.find((each) => each.hospital.fhirBase === north.fhirBase);
  const patient = Object.entries(loaded?.patients ?? {}).find(
    ([, bundle]) => view.patientName(bundle) === ines.name,
  )?.[0];
  assert.ok(patient, "North holds no patient Ines Calloway");

  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    const box = page.locator("#connection");
    /** The sign-in page in a popup, and the date its line says records stood on, if it has one. */
    const signInPage = async (
      allow: boolean,
    ): Promise<string | null | undefined> => {
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.click(
          `button:has-text("Sign in at ${view.hospitalName(north.name)}")`,
        ),
      ]);
      await popup.waitForSelector('button[value="allow"]');
      const line = popup.locator("p.as-of time");
      const stood =
        (await line.count()) === 0
          ? undefined
          : await line.getAttribute("datetime");
      if (allow) {
        await popup.check(`input[name="patient"][value="${patient}"]`);
        await popup.click('button[value="allow"]');
      } else await popup.close();
      return stood;
    };
    const world = page.locator(".world-date");
    const worldSays = (what: string) =>
      page.waitForFunction(
        (text) =>
          document.querySelector(".world-date")?.textContent?.includes(text) ??
          false,
        what,
      );
    const boxSays = async () => (await box.textContent()) ?? "";
    /** Closes the connection's box, and sets the world's date to a day, or with undefined takes it away. */
    const setDate = async (day: string | undefined) => {
      if ((await box.count()) > 0) await box.locator("a.close").click();
      await settled(page);
      await world.locator("summary").click();
      if (day === undefined)
        await world.getByRole("button", { name: "Today", exact: true }).click();
      else {
        await world.locator('input[type="date"]').fill(day);
        await world.getByRole("button", { name: "Set", exact: true }).click();
      }
    };

    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await newPod(page, view.familyFirst(ines));
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
    await worldSays("Hospitals answer with everything they hold.");
    assert.equal(await signInPage(true), undefined);
    await settled(page);
    assert.ok(!(await boxSays()).includes("Pulled as of"));

    await setDate("2024-02-01");
    await worldSays("Hospitals answer as of 1 February 2024.");

    const cdp = await context.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    await page.goto(`${served.url}try/index.html?pod=ines-calloway`);
    await settled(page);
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
    await worldSays("Hospitals answer as of 1 February 2024.");
    assert.equal(await signInPage(true), "2024-02-01T23:59:59Z");
    await settled(page);
    assert.ok((await boxSays()).includes("Pulled as of 1 February 2024."));

    await setDate(undefined);
    await worldSays("Hospitals answer with everything they hold.");
    assert.equal(await signInPage(false), undefined);

    /** Waits for try/ to say "Not done" and why, as a page it drew ready, not as something gone wrong. */
    const notDone = async (why: RegExp) => {
      await settled(page);
      assert.equal(await page.textContent("main h1"), "Not done");
      assert.match((await page.textContent("main")) ?? "", why);
    };
    await settled(page);
    await box.locator("a.close").click();
    await world.locator("details").evaluate((details: HTMLDetailsElement) => {
      details.open = true;
    });
    await world
      .locator('input[type="date"]')
      .evaluate((input: HTMLInputElement) => {
        input.type = "text";
        input.value = "soon";
      });
    await world.getByRole("button", { name: "Set", exact: true }).click();
    await notDone(/"soon" is not a date/);
    await page.click('a[href="#new-pod"]');
    await page.fill(
      '#new-pod input[name="person"]:not([type="hidden"])',
      "Con",
    );
    await page.click('#new-pod button:has-text("Make the pod")');
    await notDone(/Windows keeps for itself/);
  } finally {
    await context.close();
  }
});

test("in try/, where the demo hospitals' service worker cannot run, a sign-in at North draws the worker's own sentence in the box, neither blaming the hospital nor offering Sign in again", async () => {
  const demo = await loadHospitals();
  const ines = view
    .demoPeople(demo)
    .find(({ name }) => name === "Ines Calloway");
  assert.ok(ines, "no demo person is Ines Calloway");
  const [north] = ines.at;
  assert.ok(north && ines.at.length === 1, "Ines is not at North alone");

  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await newPod(page, view.familyFirst(ines));
    await page.click(
      `button:has-text("Sign in at ${view.hospitalName(north.name)}")`,
    );
    const box = page.locator("#connection");
    await box.waitFor();
    await settled(page);
    const said = (await box.textContent()) ?? "";
    assert.ok(said.trim().length > 0, "the box says nothing");
    assert.ok(!said.includes("refused the sign-in"), said);
    assert.ok(!said.includes("Sign in again"), said);
    assert.equal(await box.locator("button").count(), 0, said);
  } finally {
    await context.close();
  }
});

test("in try/, Tamsin Vale signed in at North with the world's date at her story's first pull has metformin among her medications; with the date back at today, brought in again, it has stopped and the pod says what changed after", async () => {
  const story = (await loadStories()).find(({ pulls }) => pulls?.length);
  assert.ok(story?.pulls, "no story names its pulls");
  const [finding] = story.findings;
  assert.ok(finding?.kind === "after stop", "the story's finding is no stop");
  const [first] = story.pulls;
  assert.ok(
    first && Date.parse(first.asOf) < Date.parse(finding.date),
    "the story's first pull is not before the stop",
  );
  const north = await loadHospital(story.hospital);

  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    /** Sets the date the demo hospitals answer as of, through try/'s own module, before a sign-in. */
    const world = (asOf: string | undefined) =>
      page.evaluate(async (at) => {
        const { setWorldDate } = (await import(
          new URL("demo-hospitals.js", location.href).href
        )) as {
          setWorldDate(script: URL, asOf: string | undefined): Promise<void>;
        };
        await setWorldDate(
          new URL("demo-hospital-worker.js", location.href),
          at ?? undefined,
        );
      }, asOf ?? null);
    /** Signs the pod in at North as the story's patient, from Find a hospital, and brings the record in. */
    const bringIn = async () => {
      await page.click('a:has-text("Find a hospital")');
      await settled(page);
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.click(
          `.card:has(h2:text-is(${JSON.stringify(view.hospitalName(north.hospital.name))})) button`,
        ),
      ]);
      await popup.waitForSelector('button[value="allow"]');
      await popup.check(`input[name="patient"][value="${story.patient}"]`);
      await popup.click('button[value="allow"]');
      await settled(page);
      await page.click("#connection button:has-text('Bring')");
      await settled(page, 300_000);
    };
    const metformin = async () =>
      (await texts(page, "#see-medications tbody tr")).filter((row) =>
        /metformin/i.test(row),
      );

    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await page.click('a[href="#new-pod"]');
    await page.fill(
      '#new-pod input[name="person"]:not([type="hidden"])',
      "Tamsin at North",
    );
    await page.click('#new-pod button:has-text("Make the pod")');
    await settled(page);
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );

    assert.equal(
      await page.locator("h1").first().innerText(),
      "Tamsin at North",
    );

    await world(first.asOf);
    await bringIn();
    const [taken, ...more] = await metformin();
    assert.deepEqual(more, []);
    assert.match(taken ?? "", /Active/, "metformin is not taken");
    assert.equal(await page.locator(".change").count(), 0);

    await world(undefined);
    await bringIn();
    const [stopped, ...others] = await metformin();
    assert.deepEqual(others, []);
    assert.match(stopped ?? "", /Stopped/, "metformin is still taken");
    const card = page.locator(".change");
    await card.first().waitFor({ timeout: 60_000 });
    assert.equal(await card.count(), 1);
    assert.match(
      (await card.innerText()).replace(/\s+/g, " "),
      /was higher after .+ stopped\./,
    );
  } finally {
    await context.close();
  }
});

test("in try/, the sample pod tamsin-vale draws What changed and, in its card, where it comes from: the story's pulls in order, each with its source and the date it answered as of, and the metformin's two versions", async () => {
  const story = (await loadStories()).find(({ pulls }) => pulls?.length);
  assert.ok(story?.pulls, "no story names its pulls");
  const [finding] = story.findings;
  assert.ok(finding?.kind === "after stop", "the story's finding is no stop");
  const north = await loadHospital(story.hospital);

  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await page.goto(`${served.url}try/index.html?pod=tamsin-vale`);
    await page.locator(".changes .how").waitFor({ timeout: 60_000 });

    const card = page.locator(".change");
    assert.equal(await card.count(), 1);
    const said = (await card.innerText()).replace(/\s+/g, " ");
    assert.match(said, /was higher after .+ stopped\./);
    assert.ok(
      !said.includes("Metformin 500 mg tablet"),
      "the card is drawn by the record's own name, not the tables'",
    );

    const pulls = await texts(page, ".how li");
    assert.equal(pulls.length, story.pulls.length);
    story.pulls.forEach(({ asOf }, at) => {
      const said = pulls[at]!;
      assert.ok(
        said.includes(`From ${view.hospitalName(north.hospital.name)}`),
        said,
      );
      assert.ok(said.includes(`as of ${view.dayInWords(asOf)}`), said);
    });
    const how = (await page.locator(".how").innerText()).replace(/\s+/g, " ");
    assert.ok(
      how.includes(
        `version 1 to version 2, in import 2, as of ${view.dayInWords(story.pulls[1]!.asOf)}`,
      ),
      how,
    );
    assert.match(
      how,
      new RegExp(
        `Status active → completed; end date none → ${view.day(finding.date)}`,
      ),
    );
    assert.doesNotMatch(how, /urn:|https?:/);
  } finally {
    await context.close();
  }
});

test("try/ ships the starter tables its published answers were computed with: after a check that finds nothing new, a visit draws a copied pod from its kept answers, the engine held back", async () => {
  const [feedUrl] = (await servedConfig()).tables.feeds;
  assert.ok(feedUrl);
  const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
  const shipped = turtle(
    await readFile(join(SERVED, "tables", "references.ttl")),
    "urn:test:starter/",
  ).filter(([, predicate]) => predicate.value === `${REC}shipsWith`);
  assert.ok(shipped.length > 0, "try/ ships no starter tables");
  const feed = ntriples(
    shipped.flatMap(([series, , version]): Triple[] => [
      [
        series,
        oxigraph.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        oxigraph.namedNode(`${REC}ReferenceSeries`),
      ],
      [series, oxigraph.namedNode(`${DCAT}hasCurrentVersion`), version],
    ]),
  );
  const context = await browser.newContext();
  try {
    await context.route(feedUrl, (route) =>
      route.fulfill({ body: feed, contentType: "text/turtle" }),
    );
    await context.route(new URL("checked.json", feedUrl).href, (route) =>
      route.fulfill({ status: 404 }),
    );
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await page.waitForSelector('body[data-tables="ready"]', {
      timeout: 60_000,
    });
    const checked = await page.evaluate(async () => {
      const runtime = (await import("cascade-runtime" as string)) as {
        checkTables(): Promise<
          { kept: string[]; later?: string; refused: unknown[] }[]
        >;
      };
      return runtime.checkTables();
    });
    assert.deepEqual(
      checked.map(({ kept, later, refused }) => ({ kept, later, refused })),
      [{ kept: [], later: undefined, refused: [] }],
    );

    await page.route(ENGINE, (route) => route.abort());
    await page.goto(`${served.url}try/index.html?pod=${ALEX}`);
    await settled(page, 30_000);
    assert.equal(await page.textContent("main h1"), "Alex Rivera");
    assert.ok((await tiles(page)).size > 0);
    assert.equal(await page.getAttribute("body", "data-engine"), null);
    await page.waitForFunction(
      () =>
        document
          .querySelector("aside section.tables")
          ?.textContent?.includes("The reference tables could not be read."),
      undefined,
      { timeout: 30_000 },
    );
    const nav = (await page.textContent("aside section.tables")) ?? "";
    assert.ok(!nav.includes("Loading") && !nav.includes("None yet"), nav);

    const sources = alex["entry/Where it came from"] ?? [];
    const penicillin = sources.filter(
      ({ entryLabel }) => entryLabel === "Allergy entry · Penicillin",
    );
    assert.ok(penicillin.length > 1, "Alex's penicillin is from one place");
    const row = (alex["pod/My active allergies"] ?? []).find(
      ({ entry }) => entry === penicillin[0]?.entry,
    );
    assert.ok(row);
    await page.click('a.tile[href="#see-allergies"]');
    await inPlace(page, async () => {
      await page
        .locator("#see-allergies tbody tr")
        .filter({ hasText: String(row.allergen) })
        .locator("td:first-child a")
        .first()
        .click();
      await page.waitForFunction(() =>
        new URLSearchParams(location.search).has("entry"),
      );
    });
    assert.equal(
      new URL(page.url()).searchParams.get("entry"),
      view.entryId(String(row.entry)),
    );
    assert.equal(await page.textContent("main h1"), row.allergen);
    const came = await page
      .locator("main .card", { hasText: "Where it came from" })
      .innerText();
    for (const place of new Set(penicillin.map(view.placeOf)))
      assert.ok(came.includes(place), `${place} is not in ${came}`);
    assert.equal(await page.getAttribute("body", "data-engine"), null);
    await page.close();
  } finally {
    await context.close();
  }
});

/** Every value of every object store of the database `name`, as text, by key. */
async function storedIn(
  page: Page,
  name: string,
): Promise<{ key: string; text: string }[]> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((done, failed) => {
      const opening = indexedDB.open(name);
      opening.onerror = () => failed(opening.error);
      opening.onsuccess = () => done(opening.result);
    });
    const asked = <T>(request: IDBRequest<T>) =>
      new Promise<T>((done, failed) => {
        request.onerror = () => failed(request.error);
        request.onsuccess = () => done(request.result);
      });
    const decoder = new TextDecoder("latin1");
    const texted = (value: unknown): string =>
      typeof value === "string"
        ? value
        : value instanceof ArrayBuffer || ArrayBuffer.isView(value)
          ? decoder.decode(value)
          : JSON.stringify(value);
    const stores = [...database.objectStoreNames];
    const transaction = database.transaction(stores, "readonly");
    const reads = stores.map((store) => {
      const objects = transaction.objectStore(store);
      return Promise.all([
        asked(objects.getAllKeys()),
        asked(objects.getAll()),
      ]);
    });
    const found: { key: string; text: string }[] = [];
    for (const [keys, values] of await Promise.all(reads))
      keys.forEach((key, at) =>
        found.push({ key: String(key), text: texted(values[at]) }),
      );
    database.close();
    return found;
  }, name);
}

test("in try/, a pod for Rowan Ellery Marsh signed in at North as Odalys Brandt warns that the record is Odalys's, not Rowan's, and offers only a button that names both, which brings the record in", async () => {
  const demo = await loadHospitals();
  const people = view.demoPeople(demo);
  const rowan = people.find(({ name }) => name === "Rowan Ellery Marsh");
  const odalys = people.find(({ name }) => name === "Odalys Brandt");
  assert.ok(rowan && odalys, "a demo person is missing");
  const north = odalys.at[0];
  assert.ok(north, "Odalys is at no hospital");
  const loaded = demo.find((each) => each.hospital.fhirBase === north.fhirBase);
  const patient = Object.entries(loaded?.patients ?? {}).find(
    ([, bundle]) => view.patientName(bundle) === odalys.name,
  )?.[0];
  assert.ok(patient, "the hospital holds no patient Odalys Brandt");

  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await newPod(page, view.familyFirst(rowan));
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.click(
        `button:has-text("Sign in at ${view.hospitalName(north.name)}")`,
      ),
    ]);
    await popup.waitForSelector('button[value="allow"]');
    await popup.check(`input[name="patient"][value="${patient}"]`);
    await popup.click('button[value="allow"]');
    await settled(page);
    assert.equal(
      (await page.textContent("#connection .note.warm"))?.trim(),
      "This record is Odalys Brandt's, not Rowan Ellery Marsh's.",
    );
    assert.deepEqual(
      await page.$$eval("#connection button", (found) =>
        found.map((each) => each.textContent?.trim()),
      ),
      ["Bring Odalys Brandt's records into Rowan Ellery Marsh's pod anyway"],
    );
    await page.click("#connection button.quiet:has-text('anyway')");
    await settled(page, 300_000);
    assert.ok((await tiles(page)).size > 0, "the pod's page shows no record");
  } finally {
    await context.close();
  }
});

test("in try/, an encrypted pod shows six words, is made once words 2 and 5 are typed, keeps nothing readable in the browser's storage, and after a reload opens only with the words", async () => {
  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await page.click('a[href="#new-pod"]');
    await page.check("#encrypt-pod");
    await page.fill(
      '#new-pod input[aria-label="A person\'s name"]',
      "Grace Hopper",
    );
    await inPlace(page, () =>
      page.click('#new-pod button:has-text("Make the pod")'),
    );
    const words = await page.locator(".words li").allTextContents();
    assert.equal(words.length, 6);

    const confirm = page.locator("form", {
      has: page.locator('input[name="word2"]'),
    });
    const signUp = await confirm.evaluate((form) => {
      const named = (field: string) =>
        form.querySelector<HTMLInputElement>(`input[name="${field}"]`)!;
      return ["username", "password"].map((field) => {
        const input = named(field);
        return {
          type: input.type,
          autocomplete: input.autocomplete,
          value: input.value,
          hidden:
            input.readOnly ||
            input.closest("[aria-hidden]") !== null ||
            input.offsetParent === null,
        };
      });
    });
    assert.deepEqual(signUp, [
      {
        type: "text",
        autocomplete: "username",
        value: "grace-hopper",
        hidden: false,
      },
      {
        type: "password",
        autocomplete: "new-password",
        value: words.join(" "),
        hidden: false,
      },
    ]);
    assert.equal(
      page.url().includes(words[0]!),
      false,
      "the words are never in the address",
    );

    assert.equal(
      await page.getAttribute("button[data-copy-words]", "type"),
      "button",
    );

    await page.fill('input[name="password"]', "a suggested password");
    await page.fill('input[name="word2"]', words[1]!);
    await page.fill('input[name="word5"]', words[4]!);
    await inPlace(page, () =>
      page.click('button:has-text("Make the encrypted pod")'),
    );
    assert.match(
      (await page.textContent("main")) ?? "",
      /must hold the six words above/,
    );
    assert.equal(
      await page.inputValue('input[name="password"]'),
      words.join(" "),
      "the field is reset to the words",
    );
    assert.equal(
      (await page.evaluate(async () => await indexedDB.databases())).some(
        ({ name }) => name === "cascade-pod:grace-hopper",
      ),
      false,
      "a changed password field makes nothing",
    );
    await page.fill('input[name="username"]', "someone-else");
    await page.fill('input[name="word2"]', words[1]!);
    await page.fill('input[name="word5"]', words[4]!);
    await inPlace(page, () =>
      page.click('button:has-text("Make the encrypted pod")'),
    );
    assert.match(
      (await page.textContent("main")) ?? "",
      /Pod field must keep the pod's name/,
    );

    await page.fill('input[name="word2"]', words[1]!);
    await page.fill('input[name="word5"]', "wrong");
    await inPlace(page, () =>
      page.click('button:has-text("Make the encrypted pod")'),
    );
    assert.match(
      (await page.textContent("main")) ?? "",
      /Those aren't words 2 and 5/,
    );
    assert.equal(
      (await page.evaluate(async () => await indexedDB.databases())).some(
        ({ name }) => name === "cascade-pod:grace-hopper",
      ),
      false,
      "a wrong check makes nothing",
    );

    await page.fill('input[name="word2"]', words[1]!);
    await page.fill('input[name="word5"]', words[4]!);
    await inPlace(page, () =>
      page.click('button:has-text("Make the encrypted pod")'),
    );
    assert.match(await page.url(), /pod=grace-hopper/);

    for (const database of [
      "cascade-pod:grace-hopper",
      "cascade-answers:grace-hopper",
    ]) {
      const stored = await storedIn(page, database);
      assert.ok(stored.length > 0, `${database} holds values`);
      for (const { key, text } of stored) {
        if (key === "settings/encryption.json") continue;
        assert.ok(text.length > 0, key);
        for (const readable of ["@prefix", "Grace", '"title"', '"rows"'])
          assert.equal(text.includes(readable), false, `${key}: ${readable}`);
        assert.throws(() => JSON.parse(text), `${key} parses as JSON`);
      }
    }

    await page.goto(`${served.url}try/index.html?pod=grace-hopper`);
    await settled(page);
    await page.fill('input[name="password"]', "one two three four five six");
    await inPlace(page, () => page.click('button:has-text("Open this pod")'));
    assert.match((await page.textContent("main")) ?? "", /don't open this pod/);
    await page.fill('input[name="password"]', words.join(" "));
    await inPlace(page, () => page.click('button:has-text("Open this pod")'));
    assert.match((await page.textContent("main")) ?? "", /Grace Hopper/);
  } finally {
    await context.close();
  }
});
