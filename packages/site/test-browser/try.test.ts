import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  type Route,
} from "playwright";
import {
  connect,
  DEMO_PLAN,
  type Imported,
  openPod,
  type Pod,
  pull,
  pullFiles,
  type Row,
} from "cascade-runtime";
import { demoFetch, hospitalId } from "@cascade-runtime/demo-hospital";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import {
  FILES_JSON,
  parseConfig,
  repositoryName,
  treeIri,
} from "@cascade-runtime/runtime";
import {
  CONFIG_FILE,
  findRoot,
  PACKED,
  type Packed,
} from "@cascade-runtime/runtime/node";
import { type Served, servePages } from "../src/node/serve.js";
import { inPlace, newPod, settled, tiles, watched } from "./shown.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const PAGES = join(ROOT, "build", "pages");
const ALEX = "alex-rivera";
/** Oxigraph's module, the engine a pod computes with. */
const ENGINE = /\/web_bg\.wasm$/;

type Answers = Record<string, Row[]>;
interface Person {
  readonly name: string;
  readonly at: readonly { readonly name: string; readonly fhirBase: string }[];
}
/** What the test reads of the starter's view, the module try/ renders. */
interface View {
  readonly QUESTIONS: readonly string[];
  readonly SECTIONS: readonly { title: string; question: string }[];
  noticed(answers: Answers): string[];
  placeOf(row: Row): string;
  counted(records: Readonly<Record<string, number>>): string;
  hospitalName(name: string): string;
  demoPeople(demo: unknown): Person[];
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
/** The demo person at two hospitals, what Node's look says of each hospital's pull, and what both bring in. */
let joined: {
  person: Person;
  patients: Map<string, string>;
  has: Map<string, string[]>;
  noticed: string[];
};

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

/** What Node pulls of the demo person at each of their hospitals, and the pod both pulls make. */
async function nodeJoin(): Promise<typeof joined> {
  const demo = await loadHospitals();
  const person = view.demoPeople(demo).find(({ at }) => at.length > 1);
  assert.ok(person, "no demo person is at two hospitals");
  const patients = new Map<string, string>();
  const has = new Map<string, string[]>();
  const pod = await openPod();
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
    return {
      person,
      patients,
      has,
      noticed: view.noticed(await answersOf(pod)),
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
    await rm(join(copy, FILES_JSON));
    const pod = await openPod(copy);
    try {
      alex = await answersOf(pod);
    } finally {
      await pod.close();
    }
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
  joined = await nodeJoin();
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

/** The samples the new-pod box offers to load, by folder. */
const loadable = (page: Page): Promise<string[]> =>
  page.$$eval('#new-pod input[name="pod"]', (found) =>
    found.map((each) => (each as HTMLInputElement).value),
  );

test("a first visit copies Alex's and Priya's pods and opens Alex's, which reads as her record: her name, her places, what Cascade noticed, and a tile per kind counting the question's rows; it and a switch to Priya's draw in place before the engine loads, a click on the pod shown adds no entry to the history, so Back draws Alex's again, and the engine then loads in the background", async () => {
  const page = watched(await profile.newPage());
  const held: Route[] = [];
  await page.route(ENGINE, (route) => {
    held.push(route);
  });
  await page.goto(`${served.url}try/index.html`);
  await settled(page);

  assert.equal(await page.textContent("main h1"), "Alex Rivera");
  assert.equal(
    await page.textContent('nav a[aria-current="page"]'),
    "Alex Rivera",
  );
  assert.deepEqual(await texts(page, "nav a"), [
    "Alex Rivera",
    "Priya Natarajan",
  ]);
  assert.deepEqual(await loadable(page), []);
  assert.deepEqual(
    (await texts(page, ".chips li")).sort(),
    [
      ...new Set((alex["entry/Where it came from"] ?? []).map(view.placeOf)),
    ].sort(),
  );
  const noticed = await texts(page, ".noticed li");
  assert.deepEqual(noticed, view.noticed(alex));
  assert.ok(
    noticed.some((sentence) => /^Penicillin was recorded at /.test(sentence)),
    noticed.join("\n"),
  );
  assert.deepEqual(
    await tiles(page),
    new Map(
      view.SECTIONS.map(({ title, question }): [string, number] => [
        title,
        (alex[question] ?? []).length,
      ]).filter(([, count]) => count > 0),
    ),
  );

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
  await page.unroute(ENGINE);
  for (const route of held) await route.continue().catch(() => undefined);
  await page.reload();
  await page.waitForSelector('body[data-engine="ready"]', { timeout: 60_000 });
  await page.close();
});

test("a demo person's new pod signs in at both hospitals in a popup through try/'s own service worker, fetches what Node fetches, and joins what they agree on, a box's filter kept as each record comes in", async () => {
  const { person, patients, has } = joined;
  const page = watched(await profile.newPage());
  const said: string[] = [];
  page.on("console", (message) => said.push(message.text()));
  const secrets = new Set<string>();
  page.on("request", (request) => {
    const bearer = /^Bearer (.+)$/.exec(request.headers().authorization ?? "");
    if (bearer?.[1]) secrets.add(bearer[1]);
  });
  const signIn = async (hospital: string): Promise<Page> => {
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.click(
        `button:has-text("Sign in at ${view.hospitalName(hospital)}")`,
      ),
    ]);
    popup.on("framenavigated", (frame) => {
      const code = new URL(frame.url()).searchParams.get("code");
      if (code) secrets.add(code);
    });
    await popup.waitForSelector('button[value="allow"]');
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
    const text = (await page.textContent("#connection .card p")) ?? "";
    await page.goto(page.url().split("#")[0] ?? "");
    await settled(page);
    return text;
  };

  await page.goto(`${served.url}try/index.html`);
  await settled(page);
  await newPod(page, person.name);
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
  assert.match(await failed(), /^Not connected: .*cancel/);
  await cancelledCloses;

  const closed = await signIn(north);
  await closed.close();
  assert.match(await failed(), /^Not connected: .*closed/);

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

  const noticed = await texts(page, ".noticed li");
  assert.deepEqual(noticed, joined.noticed);
  const both = [north, south].map(view.hospitalName);
  assert.ok(
    noticed.some(
      (sentence) =>
        sentence.includes(" was recorded at ") &&
        both.every((name) => sentence.includes(name)),
    ),
    noticed.join("\n"),
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
    ["Alex Rivera", "Priya Natarajan", joined.person.name].sort(),
  );
});

test("File, Delete all data empties the pods column, leaves no pod nor answers in the browser and says how many went, a later visit still has no pods, and Reset all data brings both samples back", async () => {
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
      "Priya Natarajan",
    ]);
    assert.equal(
      await page.textContent("main .note"),
      "Reset: Alex Rivera and Priya Natarajan are back.",
    );
  } finally {
    await context.close();
  }
});

test("a first visit where no sample copies leaves no database, says there are no pods yet, and offers each sample to load, which loads it", async () => {
  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    const samples = /\/(alex-rivera|priya-natarajan)\/pod[/.]/;
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
    assert.deepEqual(await loadable(page), [ALEX, "priya-natarajan"]);

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
    await page.route(/\/(alex-rivera|priya-natarajan)\/pod[/.]/, (route) =>
      route.abort(),
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
  const components = join(PAGES, "try", "cascade-runtime", "components");
  const config = parseConfig(
    await readFile(join(components, CONFIG_FILE), "utf8"),
  );
  const packed = JSON.parse(
    await readFile(join(components, PACKED), "utf8"),
  ) as Packed;
  const carried = packed.components.map(({ repository, commit }) =>
    treeIri({ repository }, commit),
  );
  const vocabulary = packed.components.find(
    ({ repository }) => repository === config.vocabulary.repository,
  );
  assert.ok(vocabulary);
  const kits = join(
    components,
    repositoryName(config.vocabulary),
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

  const node = await openPod();
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
  page.on("worker", () => {
    workers += 1;
  });
  await page.goto(`${served.url}try/index.html`);
  await settled(page);
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
