// The app: each pod as a person reads it, a way to make a new one, and a box over it that brings a record in from a
// hospital.
// `npm start`, then open the address it prints. What the pages show is in `summary.mjs`; this file answers requests,
// reads the pods, hands the module what it shows, with the addresses of this app, and renders what it gives to HTML.
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import process, { env, exit, stderr, stdout } from "node:process";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { HospitalDataError } from "@cascade-runtime/demo-hospital";
import {
  DATA_FOLDER,
  loadHospitals,
} from "@cascade-runtime/demo-hospital/node";
import {
  changesIn,
  ConnectionFailure,
  labSeriesIn,
  openPod,
  pullFiles,
  Refusal,
  sixWords,
  tablesBeside,
  timelineIn,
  typedWords,
  Unopened,
} from "cascade-runtime";
import { render } from "preact-render-to-string";
import { chatRoute, chatTools, entryPath } from "./chat.mjs";
import { hospitalsAt } from "./hospitals.mjs";
import { modelFrom } from "./model-client.mjs";
import {
  deleteAll,
  KITS,
  podFolder,
  podNames,
  podPath,
  POD_NAME,
  PODS,
  resetAll,
  trendPath,
} from "./pods.mjs";
import {
  checkedNote,
  classedElsewhere,
  classesPage,
  classesSaid,
  codePage,
  codesSaid,
  connectionDialog,
  demoPeople,
  didNote,
  entryOf,
  entryPage,
  frame,
  HISTORY,
  hospitalName,
  hospitalsPage,
  html,
  joinedBy,
  LABS,
  MEDICATIONS,
  newPodDialog,
  noPods,
  noTables,
  NOT_WORDS,
  openPodPage,
  pageNumber,
  panelPage,
  panelSaid,
  panelsOf,
  patientName,
  personName,
  podPage,
  postButton,
  slug,
  sourcePage,
  sixWordsPage,
  sourcesOf,
  suggestedQuestions,
  tableId,
  tablePage,
  trendInput,
  trendPage,
  trendTitle,
  savedLoginChanged,
  variantsSaid,
  worldDatePage,
  utcInstant,
  worldInstant,
} from "./summary.mjs";
import {
  answersOf,
  changeAnswers,
  podTools,
  worthLines,
} from "./pod-tools.mjs";

/** Names Windows keeps for devices, which no folder may have. */
const DEVICES = /^(con|prn|aux|nul|com\d|lpt\d)$/;

/** Each pod opened on the first request for it, and kept open. */
const open = new Map();

function podNamed(name, secret) {
  if (!open.has(name)) {
    const opening = openPod(podFolder(name), { secret });
    opening.catch(() => open.delete(name));
    open.set(name, opening);
  }
  return open.get(name);
}

/** The six words of each encrypted pod being made, by its name, until the person has checked them. Kept in memory only. */
const waiting = new Map();

/** Why the pod could not be opened without words: an `Unopened` outcome; nothing when it is open. */
async function lockedOutcome(name) {
  try {
    await podNamed(name);
    return undefined;
  } catch (error) {
    if (error instanceof Unopened) return error.outcome;
    throw error;
  }
}

/** Each pod's answers, by question, as its page last showed them. */
const lastShown = new Map();

/** The reference tables the pods are matched with, kept in `pods/.tables/`. */
const tables = () => tablesBeside(PODS);
const tablePath = (series) =>
  `/tables/${encodeURIComponent(tableId(series.iri))}/`;

let unnamedSaid = false;

function sayUnnamed(error) {
  if (!unnamedSaid)
    stderr.write(`Records are shown by their own names: ${error.message}
`);
  unnamedSaid = true;
}

/** What the tables say of the codes `answers` hold and of their ingredients; nothing when they cannot say, which the console is told once. */
function aboutCodes(answers) {
  return tables()
    .then((kept) => codesSaid(answers, { tables: kept }))
    .catch((error) => {
      sayUnnamed(error);
      return undefined;
    });
}
let variantsUnsaid = false;

/** What the tables say of the variants `answers` hold; nothing when they cannot say, which the console is told once. */
async function variantsOf(answers, pod) {
  try {
    return await variantsSaid(answers, { tables: await tables(), pod });
  } catch (error) {
    if (!variantsUnsaid)
      stderr.write(`What ClinVar says is not shown: ${error.message}\n`);
    variantsUnsaid = true;
    return undefined;
  }
}

/** What the last Check now did, which the page it goes to says. */
let lastCheck;

/**
 * `body` in the frame, with the pods there are and the reference tables, as HTML; `names` given, it reads no pods.
 * `current` is the pod shown, `table` the reference table's IRI; `note` says what was just done.
 */
async function page(
  title,
  body,
  {
    current,
    table,
    refresh,
    names,
    note,
    suggestions = [],
    locked = false,
  } = {},
) {
  const pods = names ?? (await podNames());
  const encrypted =
    locked ||
    (current !== undefined &&
      (await open.get(current)?.catch(() => undefined))?.encrypted === true);
  const held = await tables()
    .then((kept) => kept.held())
    .catch(() => []);
  return `<!doctype html>\n${render(
    frame({
      title,
      body,
      pods,
      current,
      href: podPath,
      home: "/",
      dialog: newPodDialog({ people, pods, action: "/pods" }),
      menu: { deleteAll: "/delete-all", resetAll: "/reset-all", about },
      note,
      refresh,
      chat: {
        model: model && {
          provider: model.provider,
          name: model.name,
          local: model.local,
        },
        pod: current ?? "",
        suggestions,
        encrypted,
      },
      tables: {
        series: sourcesOf(held),
        current: table,
        href: tablePath,
        check: "/tables/check",
      },
    }),
  )}`;
}

/**
 * A reference source or table, by its id, or the first source with none. A source's page searches all its tables,
 * `query`'s `q` for what and `page` for which page, or with `code` shows that code's page; a table's page searches it
 * alone. `checked` says the page tells what the last Check now did.
 */
async function showTable(response, id, query) {
  const kept = await tables();
  const held = await kept.held();
  const sources = sourcesOf(held);
  const series =
    id === undefined || query.has("code")
      ? undefined
      : held.find((each) => tableId(each.iri) === id);
  const source =
    series !== undefined
      ? sources.find((each) => each.series.includes(series))
      : id === undefined
        ? sources[0]
        : sources.find((each) => tableId(each.iri) === id);
  const note = query.has("checked") ? lastCheck : undefined;
  const notFound = async (said) =>
    send(
      response,
      404,
      await page(
        "Not found",
        html`<h1>Not found</h1>
<p>${said}</p>`,
      ),
    );
  if (source === undefined)
    return id === undefined
      ? send(
          response,
          200,
          await page("Reference tables", noTables(), { note }),
        )
      : notFound(`This app holds no reference table ${id}.`);
  const text = query.get("q") ?? "";
  const shown = pageNumber(query.get("page"));
  const names = await podNames();
  const at = series ?? source;
  const searchedHere = {
    text,
    search: tablePath(at),
    page: shown,
    pageHref: (page) =>
      `${tablePath(at)}?${new URLSearchParams({ q: text, page })}`,
    now: Date.now(),
  };
  const codeHref = (code) =>
    `${tablePath(source)}?${new URLSearchParams({ code })}`;
  let title = source.label;
  let body;
  if (series !== undefined) {
    title = series.label;
    body = tablePage({
      ...searchedHere,
      series,
      codeHref,
      searched: await kept.search(series.iri, text, shown),
      uses: await kept.uses(),
      pods: names,
      href: podPath,
    });
  } else if (query.has("code")) {
    const written = query.get("code") ?? "";
    const code = await kept.codeNamed(
      [...new Set([...source.series, ...held].map(({ iri }) => iri))],
      written,
    );
    if (code === undefined)
      return notFound(`${source.label} holds no code ${written}.`);
    const facts = await kept.facts(
      code,
      source.series.map(({ iri }) => iri),
    );
    title = `${facts.notation} ${facts.about?.name?.label ?? ""}`.trim();
    body = codePage({
      source,
      held,
      facts,
      codeHref,
      back: tablePath(source),
    });
  } else
    body = sourcePage({
      ...searchedHere,
      source,
      searched: await kept.search(
        source.series.map(({ iri }) => iri),
        text,
        shown,
      ),
      codeHref,
      tableHref: tablePath,
    });
  send(
    response,
    200,
    await page(title, body, { names, table: source.iri, note }),
  );
}

/** Check now: reads every feed past any cache; the plaintext pods held open close when it kept a version, to open with it. An encrypted pod stays open, so it stays unlocked and an import into it goes on; it reads the new tables when next opened. */
async function checkNow(response) {
  const kept = await tables();
  const checked = await kept.check({ cache: "no-cache" });
  if (checked.some((each) => each.kept.length > 0)) await closePods(true);
  lastCheck = checkedNote(checked, await kept.held());
  redirect(response, "/tables/?checked");
}

/** Closes every pod the server holds open, or with `plaintextOnly` only those not encrypted, to be opened again on the next request for it. */
async function closePods(plaintextOnly = false) {
  const closing = [];
  for (const [name, opening] of [...open]) {
    const pod = await opening.catch(() => undefined);
    if (plaintextOnly && pod?.encrypted) continue;
    open.delete(name);
    if (pod !== undefined) closing.push(pod.close());
  }
  lastShown.clear();
  await Promise.allSettled(closing);
}

/** Closes every pod the server holds open, so that their folders can go, and forgets every connection to a hospital. */
async function closeAll() {
  hospitals?.forget();
  waiting.clear();
  await closePods();
}

/** File, Delete all data: every pod removed, then the home page says how many. */
async function deleteEverything(response) {
  await closeAll();
  const removed = await deleteAll();
  redirect(response, `/?deleted=${removed.length}`);
}

/** File, Reset all data: what `npm run reset` does, then the first pod's page says which are back. */
async function resetEverything(response) {
  await closeAll();
  await resetAll();
  redirect(response, `${podPath(KITS[0])}?reset`);
}

/** A button that starts signing the pod's person in to the hospital at `fhirBase`. */
function signIn(name, fhirBase, label) {
  return postButton(
    `${podPath(name)}hospitals`,
    { fhirBase },
    label,
    undefined,
    "Signing in…",
  );
}

async function home(response, query) {
  const names = await podNames();
  if (names.length > 0) return redirect(response, podPath(names[0]), 302);
  send(
    response,
    200,
    await page("No pods yet", noPods(), { names, note: didNote(query, KITS) }),
  );
}

/**
 * The questions an empty chat offers on a page of the pod `name`, none with no model set. What the caller already has of
 * the pod's `answers`, what the tables say of them (`about`) and `changes` is used; the rest is read.
 */
async function remembered(name) {
  const answers = await answersOf(await podNamed(name));
  lastShown.set(name, answers);
  return answers;
}

async function suggested(name, known = {}) {
  if (model === undefined) return [];
  const answers =
    known.answers ?? lastShown.get(name) ?? (await remembered(name));
  return suggestedQuestions(answers, {
    changes:
      known.changes ??
      changesIn(answers[HISTORY], answers[LABS], { limit: 20 }),
    about: known.about ?? (await aboutCodes(answers)),
    said:
      "said" in known
        ? known.said
        : await variantsOf(answers, await podNamed(name)),
  });
}

/**
 * The pod as a person reads it. `query`'s `from` is the number of a connection, and the page notes the record it
 * brought in when its import did; its `connection` is the number of one whose box the page holds, refreshing itself
 * while it signs in, fetches and brings the record in. Once the record is in, the box's address goes to the note.
 */
async function showPod(response, name, query, names) {
  const found = query.has("connection")
    ? hospitals.connection(name, query.get("connection"))
    : undefined;
  if (found?.imported !== undefined && found.bringing === undefined) {
    const done = await found.imported.catch(() => undefined);
    if (done !== undefined && done.refused === undefined)
      return redirect(response, `${podPath(name)}?from=${found.n}`);
  }
  // As it is now, so that the box and whether the page refreshes agree on its step.
  const shown =
    found === undefined
      ? undefined
      : {
          ...found,
          ...(found.bringing !== undefined && { step: "bringing in" }),
        };
  // A pod answers once its import is done, so while one runs the page behind the box is the one last shown.
  const answers =
    shown?.step === "bringing in" && lastShown.has(name)
      ? lastShown.get(name)
      : await answersOf(await podNamed(name));
  lastShown.set(name, answers);
  const [about, said, held] = await Promise.all([
    aboutCodes(answers),
    podNamed(name).then((pod) => variantsOf(answers, pod)),
    tables()
      .then((kept) => kept.held())
      .catch(() => []),
  ]);
  const changes = changesIn(answers[HISTORY], answers[LABS], { limit: 20 });
  const from = query.get("from");
  const noted = from === null ? undefined : hospitals.connection(name, from);
  const broughtIn = await noted?.imported?.catch(() => undefined);
  const box =
    shown === undefined
      ? undefined
      : connectionDialog({
          id: "connection",
          pod: name,
          hospital: shown.row.name,
          back: podPath(name),
          connection: shown,
          bring: `${podPath(name)}connections/${shown.n}`,
          pulledAsOf: shown.asOf,
          ...(await connectionView(name, shown)),
        });
  const body = podPage(answers, {
    pod: name,
    person: people.find((each) => slug(each.name) === name),
    from:
      broughtIn === undefined || broughtIn.refused !== undefined
        ? undefined
        : noted.row.name,
    signIn: (hospital) =>
      signIn(
        name,
        hospital.fhirBase,
        `Sign in at ${hospitalName(hospital.name)}`,
      ),
    findHospital: `${podPath(name)}hospitals`,
    world: worldDateAt(podPath(name)),
    entryHref: (entry) => entryPath(name, entry),
    connection: box,
    unheld: (await podNamed(name)).opened?.unheld,
    about,
    held,
    said,
    changes,
    trendHref: (trend) => trendPath(name, trend),
    classesHref: classesPath(name),
    ask: model !== undefined,
  });
  send(
    response,
    200,
    await page(personName(name), body, {
      current: name,
      names,
      note: didNote(query, KITS),
      refresh: ["signing in", "pulling", "bringing in"].includes(shown?.step),
      suggestions: await suggested(name, { answers, about, changes, said }),
    }),
  );
}

/**
 * The entry of the pod whose address part is `id`: what it is, where it came from and what else is known, from the
 * answers the pod's page last showed when they hold it, else the pod's answers now. An entry the pod does not hold is
 * 404.
 */
async function showEntry(response, name, id, names) {
  let answers = lastShown.get(name);
  if (answers === undefined || entryOf(answers, id) === undefined) {
    answers = await answersOf(await podNamed(name));
    lastShown.set(name, answers);
  }
  const [about, held, said, panels, joined] = await Promise.all([
    aboutCodes(answers),
    tables()
      .then((kept) => kept.held())
      .catch(() => []),
    podNamed(name).then((pod) => variantsOf(answers, pod)),
    tables()
      .then(async (kept) =>
        panelsOf(entryOf(answers, id), {
          tables: kept,
          held: await kept.held(),
        }),
      )
      .catch(() => []),
    podNamed(name)
      .then(joinedBy)
      .catch(() => new Map()),
  ]);
  const entry = entryOf(answers, id, { about, said, held, joined });
  const sources = sourcesOf(held);
  const body = entryPage({
    entry,
    pod: name,
    back: podPath(name),
    codeHref: (series, notation) =>
      `${tablePath(sources.find((each) => each.series.includes(series)))}?${new URLSearchParams({ code: notation })}`,
    tableHref: tablePath,
    ask: model !== undefined,
    panels,
    panelHref: (code) => panelPath(name, code),
  });
  send(
    response,
    entry === undefined ? 404 : 200,
    await page(entry?.name ?? "Not found", body, {
      current: name,
      names,
      suggestions: await suggested(name, { answers, about, said }),
    }),
  );
}

/**
 * The trend of the test `query`'s `test` names, the medication `medication` names marked: the pod's results of one
 * test over time. With no `test` it is the strongest change's, else the pod's first. A test the pod holds no result of
 * is 404.
 */
async function showTrend(response, name, query, names) {
  const pod = await podNamed(name);
  const answers = await changeAnswers(pod);
  const { [HISTORY]: medications, [LABS]: labs } = answers;
  const asked = {
    test: query.get("test") ?? undefined,
    medication: query.get("medication") ?? undefined,
  };
  const changes = changesIn(medications, labs, { limit: 20 });
  const input = trendInput({ changes, labs }, asked);
  let series;
  try {
    series = input === undefined ? undefined : labSeriesIn(labs, input.test);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
  }
  const about = await aboutCodes(answers);
  const body = trendPage({
    pod: name,
    back: podPath(name),
    labs,
    series,
    timeline: timelineIn(medications),
    test: input?.test,
    medication: input?.medication,
    trendHref: (trend) => trendPath(name, trend),
    about,
    ask: model !== undefined,
  });
  send(
    response,
    series === undefined ? 404 : 200,
    await page(
      series === undefined ? "Not found" : trendTitle(series, about),
      body,
      {
        current: name,
        names,
        suggestions: await suggested(name, { changes }),
      },
    ),
  );
}

const classesPath = (name) => `${podPath(name)}classes`;

/**
 * The pod's active medicines by the class the tables give them, or with `query`'s `class`, the medicines in that class
 * alone: `pod.medicationClasses()` names the classes, the tables their names. With no tables to name them the classes
 * are shown by their codes.
 */
async function showClasses(response, name, query, names) {
  const pod = await podNamed(name);
  const [rows, medications] = await Promise.all([
    pod.medicationClasses(),
    pod.ask(MEDICATIONS),
  ]);
  const kept = await tables();
  const [about, elsewhere, held] = await Promise.all([
    classesSaid(rows, { tables: kept }).catch(() => undefined),
    classedElsewhere(rows, medications, { tables: kept }).catch(
      () => undefined,
    ),
    kept.held(),
  ]);
  const sources = sourcesOf(held);
  const body = classesPage({
    pod: name,
    back: podPath(name),
    rows,
    medications,
    about,
    elsewhere,
    held,
    picked: query.get("class") ?? undefined,
    classHref: (code) =>
      `${classesPath(name)}?${new URLSearchParams({ class: code })}`,
    allHref: classesPath(name),
    entryHref: (entry) => entryPath(name, entry),
    codeHref: (series, notation) =>
      `${tablePath(sources.find((each) => each.series.includes(series)))}?${new URLSearchParams({ code: notation })}`,
  });
  send(
    response,
    200,
    await page("Medicines by class", body, { current: name, names }),
  );
}

const panelPath = (name, code) =>
  `${podPath(name)}panel?${new URLSearchParams({ panel: code })}`;

/**
 * The pod's results in the LOINC panel `query`'s `panel` names, the code a person picked from a lab result's page:
 * `pod.panelResults(panel)` finds them, the tables name them. A panel is a code, so no panel is a 404.
 */
async function showPanel(response, name, query, names) {
  const panel = query.get("panel");
  if (panel === null)
    return send(
      response,
      404,
      await page("Not found", html`<h1>Not found</h1>`, { names }),
    );
  const pod = await podNamed(name);
  const [rows, labs] = await Promise.all([
    pod.panelResults(panel),
    pod.ask(LABS),
  ]);
  const kept = await tables();
  const [about, held] = await Promise.all([
    panelSaid(panel, rows, { tables: kept }).catch(() => undefined),
    kept.held(),
  ]);
  const sources = sourcesOf(held);
  const body = panelPage({
    pod: name,
    back: podPath(name),
    panel,
    rows,
    labs,
    about,
    held,
    entryHref: (entry) => entryPath(name, entry),
    codeHref: (series, notation) =>
      `${tablePath(sources.find((each) => each.series.includes(series)))}?${new URLSearchParams({ code: notation })}`,
  });
  send(
    response,
    200,
    await page(
      `Your results in ${about?.get(panel)?.name?.label ?? "a panel"}`,
      body,
      {
        current: name,
        names,
      },
    ),
  );
}

/** Makes an empty pod named after the person given, unless it exists, and goes to it. */
async function newPod(request, response) {
  const form = await formOf(request);
  const name = slug(form.get("person") ?? "");
  const refused = !POD_NAME.test(name)
    ? "Give a name with at least one letter from a to z, or a digit."
    : DEVICES.test(name)
      ? "That name is one Windows keeps for itself: add another word."
      : undefined;
  if (refused !== undefined)
    return send(
      response,
      400,
      await page(
        "No pod made",
        html`<h1>No pod made</h1>
<p>${refused}</p>`,
      ),
    );
  if (form.get("encrypt") === "on" && !(await podNames()).includes(name)) {
    const words = sixWords();
    waiting.set(name, words);
    return await showWords(response, name, words);
  }
  await podNamed(name);
  redirect(response, podPath(name));
}

const WORDS_AT = "/encrypted-pods";

/** The page that shows the six words and asks for words 2 and 5, never kept by a cache. */
async function showWords(response, name, words, problem) {
  send(
    response,
    problem === undefined ? 200 : 400,
    await page(
      "Your six words",
      sixWordsPage({ pod: name, words, action: WORDS_AT, problem }),
    ),
    { "cache-control": "no-store" },
  );
}

/** Makes the encrypted pod whose six words the person has checked, and goes to it. */
async function newEncryptedPod(request, response) {
  const form = await formOf(request);
  const name = form.get("pod") ?? "";
  const words = waiting.get(name);
  if (words === undefined)
    return send(
      response,
      400,
      await page(
        "No pod made",
        html`<h1>No pod made</h1>
<p>These six words are not waiting any more. Make the pod again.</p>`,
      ),
    );
  const changed = savedLoginChanged(form, name, words);
  if (changed !== undefined)
    return await showWords(response, name, words, changed);
  const asked = words.split(" ");
  if (
    typedWords(form.get("word2") ?? "") !== asked[1] ||
    typedWords(form.get("word5") ?? "") !== asked[4]
  )
    return await showWords(response, name, words, NOT_WORDS);
  waiting.delete(name);
  if ((await podNames()).includes(name))
    return send(
      response,
      400,
      await page(
        "No pod made",
        html`<h1>No pod made</h1>
<p>A pod named ${name} exists already. Make the pod again under another name.</p>`,
      ),
    );
  if (!(await podNamed(name, words)).encrypted)
    throw new Error(`The pod ${name} was made without its words.`);
  redirect(response, podPath(name));
}

/** The page of the pod `name` while it is locked, at the address `next`, which words will go to. */
async function showLocked(response, name, outcome, next, names) {
  send(
    response,
    200,
    await page(
      "Open this pod",
      openPodPage({ pod: name, outcome, action: `${podPath(name)}open`, next }),
      { current: name, names, locked: true },
    ),
    { "cache-control": "no-store" },
  );
}

/** Opens the locked pod `name` with the words posted, then goes to the address asked for, or says why it did not open. */
async function unlock(request, response, name, names) {
  const form = await formOf(request);
  const asked = form.get("next") ?? "";
  const next = asked.startsWith(podPath(name)) ? asked : podPath(name);
  if ((await lockedOutcome(name)) === undefined)
    return redirect(response, next);
  const secret = form.get("password") ?? "";
  if (secret.trim() === "")
    return await showLocked(response, name, "incorrect secret", next, names);
  try {
    await podNamed(name, secret);
  } catch (error) {
    if (!(error instanceof Unopened)) throw error;
    return await showLocked(response, name, error.outcome, next, names);
  }
  redirect(response, next);
}

function send(response, status, html, headers = {}) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  response.end(html);
}

function redirect(response, location, status = 303) {
  response.writeHead(status, { location });
  response.end();
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function formOf(request) {
  return new URLSearchParams((await bodyOf(request)).toString("utf8"));
}

async function findHospital(response, name, text, names) {
  const body = hospitalsPage({
    pod: name,
    rows: hospitals.directory(text),
    text,
    search: `${podPath(name)}hospitals`,
    signIn: (row) => signIn(name, row.fhirBase, "Sign in"),
    world: worldDateAt(`${podPath(name)}hospitals`),
    people,
    back: podPath(name),
  });
  send(
    response,
    200,
    await page("Find a hospital", body, { current: name, names }),
  );
}

/** The files a connection's pull is saved as, or why there are none: the sign-in or the pull failed, or was refused. */
async function filesOf(connection) {
  let pulled;
  try {
    pulled = await connection.pulled;
  } catch (error) {
    if (!(error instanceof ConnectionFailure)) throw error;
    return { failed: `Not connected: ${error.message}.` };
  }
  try {
    return {
      pulled,
      files: pullFiles({ ...pulled, asOf: utcInstant(connection.asOf) }, connection.name),
    };
  } catch (error) {
    return { failed: `Refused: ${error.message}` };
  }
}

/**
 * What a connection's box shows besides its steps: nothing while it signs in and fetches; then why it failed, or what
 * the hospital has, for the button that brings it in.
 */
async function connectionView(name, connection) {
  if (["signing in", "pulling", "bringing in"].includes(connection.step))
    return {};
  const { failed, pulled, files } = await filesOf(connection);
  if (failed !== undefined) return { failed };
  let done;
  try {
    done = await connection.imported;
  } catch (error) {
    return { failed: notBroughtIn(error), retry: true };
  }
  if (connection.failed !== undefined)
    return { failed: connection.failed, retry: true };
  if (done?.refused !== undefined)
    return { failed: `Refused: ${done.refused}` };
  return {
    sources: await (await podNamed(name)).look(files),
    pulled,
    about: patientName(pulled.bundle),
  };
}

const notBroughtIn = (error) => `Not brought in: ${error.message}`;

/**
 * Starts bringing a connection's record into the pod, unless it is under way or done, and goes at once to its box,
 * which says each part of the import and, once the record is in, goes to the pod's page noting it.
 */
function bring(response, name, connection) {
  if (connection.step === "pulled" && connection.imported === undefined) {
    connection.failed = undefined;
    connection.bringing = { part: "loading the adapter" };
    connection.imported = imported(name, connection).finally(() => {
      connection.bringing = undefined;
    });
    connection.imported.catch((error) => {
      connection.imported = undefined;
      connection.failed = notBroughtIn(error);
    });
  }
  redirect(response, `${podPath(name)}?connection=${connection.n}#connection`);
}

/** The import of a connection's pull into the pod, its parts in `connection.bringing`; it throws when there are no files. */
async function imported(name, connection) {
  const { failed, files } = await filesOf(connection);
  if (files === undefined) throw new Error(failed);
  return (await podNamed(name)).import(files, {
    aboutSubject: true,
    onProgress: (part) => {
      connection.bringing = part;
    },
  });
}

/** Where the world's date is shown and changed. */
const WORLD_DATE_AT = "/world-date";

/** The world's date as a page that comes from `back`, a path on this app, shows it, and its link to change it. */
function worldDateAt(back) {
  return {
    asOf: hospitals.worldDate(),
    href: `${WORLD_DATE_AT}?back=${encodeURIComponent(back)}`,
  };
}

/** Where `/world-date` goes back to: `back` when it is a path on this app, else the home page. */
function worldDateBack(back) {
  if (back === null || !back.startsWith("/") || back.startsWith("//"))
    return "/";
  if (/[\\\s]/.test(back)) return "/";
  const url = new URL(back, "http://app.invalid");
  return url.origin === "http://app.invalid"
    ? `${url.pathname}${url.search}`
    : "/";
}

/**
 * The world's date: a page that says what the hospitals answer as of, and the post that sets it. A day or an instant
 * sets it; an empty date, the Today button's, takes it back to every version; anything else answers 400 with the page
 * and a sentence.
 */
async function worldDateRoute(request, response, url) {
  const back = worldDateBack(url.searchParams.get("back"));
  const action = `${WORLD_DATE_AT}?back=${encodeURIComponent(back)}`;
  const shown = (status, problem) =>
    page(
      "The world's date",
      worldDatePage({
        asOf: hospitals.worldDate(),
        action,
        problem,
        done: url.searchParams.has("set") && status === 200,
        back,
      }),
    ).then((body) => send(response, status, body));
  if (request.method !== "POST") return shown(200);
  const text = (await formOf(request)).get("date") ?? "";
  const asOf = worldInstant(text);
  if (text.trim() !== "" && asOf === undefined)
    return shown(
      400,
      `"${text}" is not a date: give a day as YYYY-MM-DD, or an instant with its timezone.`,
    );
  hospitals.setWorldDate(asOf);
  return redirect(
    response,
    `${WORLD_DATE_AT}?set&back=${encodeURIComponent(back)}`,
  );
}

/** A demo hospital's sign-in page, the form posted back to it included. */
async function demoHospitalPage(request, response, url) {
  const body = request.method === "POST" ? await bodyOf(request) : undefined;
  const type = request.headers["content-type"];
  const answer = await hospitals.demo(url, {
    method: request.method,
    headers: type === undefined ? {} : { "content-type": type },
    body,
  });
  const headers = {};
  for (const name of ["content-type", "location"]) {
    const value = answer.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  response.writeHead(answer.status, headers);
  response.end(Buffer.from(await answer.arrayBuffer()));
}

/** The hospitals this app adds to the package's: a folder for each, as the package's own `data/` holds them. */
const HOSPITALS = fileURLToPath(new URL("hospitals/", import.meta.url));
/** The package's hospitals and this app's, or the app stopped with what is wrong with one of the app's. */
async function hospitalsHeld() {
  try {
    return await loadHospitals([DATA_FOLDER, HOSPITALS]);
  } catch (error) {
    if (!(error instanceof HospitalDataError)) throw error;
    stderr.write(`A hospital in hospitals/ cannot be used. ${error.message}\n`);
    exit(1);
  }
}

const demo = await hospitalsHeld();
const people = demoPeople(demo);

/**
 * The model the app was set up with (`npm run model`), or none. A setting the client refuses is said on the console and
 * the app runs without a model.
 */
function modelSet() {
  try {
    return modelFrom();
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    stderr.write(`No model is used: ${error.message}\n`);
    return undefined;
  }
}

/**
 * The world's date the app starts with: `CASCADE_WORLD_DATE`, a day (`YYYY-MM-DD`) or an instant, read once, here; none
 * means the hospitals answer with every version they hold. A value that is neither stops the app, saying so.
 */
function startingDate() {
  const text = env.CASCADE_WORLD_DATE;
  if (text === undefined || text.trim() === "") return undefined;
  const asOf = worldInstant(text);
  if (asOf === undefined) {
    stderr.write(
      `CASCADE_WORLD_DATE is "${text}", which is neither a day as YYYY-MM-DD nor an instant with a timezone.\n`,
    );
    exit(1);
  }
  return asOf;
}

const startedAsOf = startingDate();
const model = modelSet();
/** The tools the chat reaches, over the pods this server holds open. */
const chatting = chatTools(
  podTools(
    { names: podNames, open: podNamed },
    {
      viewOf: trendPath,
      worthOf: (pod) => worthLines(pod, { aboutCodes, variantsOf }),
      keep: false,
    },
  ),
  {
    namesFor: async (pod) => aboutCodes(await changeAnswers(pod)),
  },
);
const packageOf = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [app, runtime] = await Promise.all([
  packageOf("package.json"),
  packageOf("node_modules/cascade-runtime/package.json").catch(() => ({})),
]);
/**
 * What Help, About says: this app, the cascade-runtime it runs on, and that package's README, where its code is; the
 * version unknown and no link when its `package.json` cannot be read.
 */
const about = {
  name: app.name,
  version: app.version,
  runtime: runtime.version ?? "(version unknown)",
  code:
    runtime.repository === undefined
      ? undefined
      : `${runtime.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}/tree/main/${runtime.repository.directory}#readme`,
};
let origin;
/** The origins a browser gives this server's own forms: it answers as `localhost` too. */
let ownOrigins;
let hospitals;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    const { pathname } = url;
    const post = request.method === "POST";
    if (!post && request.method !== "GET")
      return send(
        response,
        405,
        await page("Not allowed", html`<h1>Not allowed</h1>`),
      );
    if (post && !ownOrigins.has(request.headers.origin))
      return send(
        response,
        403,
        await page("Refused", html`<h1>Refused: a form from another site</h1>`),
      );
    if (post && pathname === "/chat")
      return await chatRoute(request, response, { model, tools: chatting });
    if (pathname.startsWith("/demo-hospitals/"))
      return await demoHospitalPage(request, response, url);
    if (pathname === "/world-date")
      return await worldDateRoute(request, response, url);
    if (!post && pathname === "/")
      return await home(response, url.searchParams);
    if (post && pathname === "/pods") return await newPod(request, response);
    if (post && pathname === WORDS_AT)
      return await newEncryptedPod(request, response);
    if (post && pathname === "/delete-all")
      return await deleteEverything(response);
    if (post && pathname === "/reset-all")
      return await resetEverything(response);
    if (post && pathname === "/tables/check") return await checkNow(response);
    const table = /^\/tables\/(?:([^/]+)\/)?$/.exec(pathname);
    if (!post && table !== null)
      return await showTable(
        response,
        table[1] === undefined ? undefined : decodeURIComponent(table[1]),
        url.searchParams,
      );
    if (!post && pathname === "/callback") {
      const back = hospitals.back(url);
      if (back !== undefined) return redirect(response, back);
      return send(
        response,
        400,
        await page(
          "Not waiting",
          html`<h1>No sign-in is waiting for this</h1>`,
        ),
      );
    }
    const at =
      /^\/pods\/([^/]+)\/(?:(hospitals|trend|classes|panel|open)|connections\/(\d+)|entries\/([^/]+))?$/.exec(
        pathname,
      );
    const name = at === null ? undefined : decodeURIComponent(at[1]);
    const names = name === undefined ? undefined : await podNames();
    if (name !== undefined && names.includes(name)) {
      const [, , view, n, entry] = at;
      const outcome = await lockedOutcome(name);
      if (view === "open") {
        if (post) return await unlock(request, response, name, names);
        return redirect(response, podPath(name));
      }
      if (outcome !== undefined)
        return await showLocked(
          response,
          name,
          outcome,
          post ? podPath(name) : `${url.pathname}${url.search}`,
          names,
        );
      const isHospitals = view === "hospitals" ? view : undefined;
      if (entry !== undefined && !post)
        return await showEntry(
          response,
          name,
          decodeURIComponent(entry),
          names,
        );
      if (view === "trend" && !post)
        return await showTrend(response, name, url.searchParams, names);
      if (view === "classes" && !post)
        return await showClasses(response, name, url.searchParams, names);
      if (view === "panel" && !post)
        return await showPanel(response, name, url.searchParams, names);
      if (isHospitals !== undefined && !post)
        return await findHospital(
          response,
          name,
          url.searchParams.get("q") ?? "",
          names,
        );
      if (isHospitals !== undefined) {
        const to = await hospitals.start(
          name,
          (await formOf(request)).get("fhirBase"),
        );
        if (to !== undefined) return redirect(response, to);
        return send(
          response,
          400,
          await page(
            "Unknown",
            html`<h1>That hospital is not in the directory</h1>`,
            { names },
          ),
        );
      }
      const connection =
        n === undefined ? undefined : hospitals.connection(name, n);
      if (post && connection !== undefined)
        return bring(response, name, connection);
      if (!post && n === undefined)
        return await showPod(response, name, url.searchParams, names);
    }
    send(
      response,
      404,
      await page("Not found", html`<h1>Not found</h1>`, { names }),
    );
  } catch (error) {
    send(
      response,
      500,
      await page("Error", html`<pre>${error?.message ?? String(error)}</pre>`, {
        names: [],
      }),
    );
  }
});

server.listen(Number(env.PORT || 3000), "127.0.0.1", () => {
  const { port } = server.address();
  origin = `http://127.0.0.1:${port}`;
  ownOrigins = new Set([origin, `http://localhost:${port}`]);
  hospitals = hospitalsAt(origin, demo, { asOf: startedAsOf });
  stdout.write(`${origin}/\n`);
});

async function stop() {
  server.close();
  await closeAll();
  exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
