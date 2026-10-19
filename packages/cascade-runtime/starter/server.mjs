// The app: each pod as a person reads it, a way to make a new one, and a box over it that brings a record in from a
// hospital.
// `npm start`, then open the address it prints. What the pages show is in `summary.mjs`; this file answers requests,
// reads the pods, hands the module what it shows, with the addresses of this app, and renders what it gives to HTML.
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import process, { env, exit, stderr, stdout } from "node:process";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { HospitalDataError } from "@the-cascade-protocol/sandbox";
import {
  DEFAULT_ROOTS,
  loadHospitals,
  serveDemo,
} from "@the-cascade-protocol/sandbox/node";
import {
  ConnectionFailure,
  pullFiles,
  Refusal,
  Unopened,
} from "cascade-runtime";
import { render } from "preact-render-to-string";
import { chatRoute, chatTools, entryPath } from "./chat.mjs";
import { hospitalsAt } from "./hospitals.mjs";
import { modelFrom } from "./model-client.mjs";
import { nodeHost } from "./node-host.mjs";
import { maps, podApi } from "./pod-api.mjs";
import { apiRoute } from "./pod-api-http.mjs";
import { KITS, podPath, PODS, trendPath } from "./pods.mjs";
import {
  checkedNote,
  classesPage,
  codePage,
  codesSaid,
  connectionDialog,
  demoPeople,
  didNote,
  entryPage,
  frame,
  hospitalName,
  hospitalsPage,
  html,
  newPodDialog,
  noPods,
  noTables,
  openPodPage,
  pageNumber,
  panelPage,
  patientNames,
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
  trendPage,
  trendTitle,
  variantsSaid,
  worldDatePage,
  utcInstant,
  worldInstant,
} from "./summary.mjs";
import { changeAnswers, podTools, worthLines } from "./pod-tools.mjs";

const told = new Set();

/** Says once on the console, for each kind, that the tables could not say what the pages would name. */
function unsaid(kind, error) {
  if (told.has(kind)) return;
  told.add(kind);
  stderr.write(
    kind === "names"
      ? `Records are shown by their own names: ${error.message}\n`
      : `What ClinVar says is not shown: ${error.message}\n`,
  );
}

const host = nodeHost({ folder: PODS, unsaid });
const api = podApi(host);

/** What `/api/` calls: the same operations, but the three whose effects the form handlers also carry out here do so, until connections move into PodApi. */
const served = {
  ...api,
  async deleteAll(input) {
    hospitals?.forget();
    return await api.deleteAll(input);
  },
  async resetAll(input) {
    hospitals?.forget();
    return await api.resetAll(input);
  },
  async checkTables(input) {
    const answer = await api.checkTables(input);
    lastCheck = checkedNote(answer.checked, answer.held);
    return answer;
  },
};

/** The pods there are, each by the name typed when it was made; by its own name where none is kept. */
async function podTitles() {
  const { pods } = await api.pods({});
  return new Map(pods.map(({ name, title }) => [name, title]));
}

/** Why the pod could not be opened without words: an `Unopened` outcome; nothing when it is open. */
async function lockedOutcome(name) {
  return (await api.pod({ pod: name })).locked;
}

const tablePath = (series) =>
  `/tables/${encodeURIComponent(tableId(series.iri))}/`;

/** For the chat: what the tables say of the codes `answers` hold; nothing when they cannot say. */
function aboutCodes(answers) {
  return host
    .tables()
    .then((kept) => codesSaid(answers, { tables: kept }))
    .catch((error) => {
      unsaid("names", error);
      return undefined;
    });
}

/** For the chat: what the tables say of the variants `answers` hold; nothing when they cannot say. */
async function variantsOf(answers, pod) {
  try {
    return await variantsSaid(answers, { tables: await host.tables(), pod });
  } catch (error) {
    unsaid("variants", error);
    return undefined;
  }
}

/** What the last Check now did, which the page it goes to says. */
let lastCheck;

/**
 * `body` in the frame, with the pods there are and the reference tables, as HTML; `titles` given, it reads no pods.
 * `current` is the pod shown, `table` the reference table's IRI; `note` says what was just done.
 */
async function page(
  title,
  body,
  {
    current,
    table,
    refresh,
    titles,
    note,
    suggestions = [],
    locked = false,
  } = {},
) {
  const known = titles ?? (await podTitles());
  const encrypted =
    locked ||
    (current !== undefined &&
      (await api.pod({ pod: current }).catch(() => undefined))?.encrypted ===
        true);
  const { held } = await api.held({});
  return `<!doctype html>\n${render(
    frame({
      title,
      body,
      pods: [...known.keys()],
      titles: known,
      current,
      href: podPath,
      home: "/",
      dialog: newPodDialog({
        people,
        pods: [...known.keys()],
        action: "/pods",
      }),
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

/** The Not found page, 404, saying `said`: what a read refused. */
async function notFound(response, said, options) {
  send(
    response,
    404,
    await page(
      "Not found",
      html`<h1>Not found</h1>
<p>${said}</p>`,
      options,
    ),
  );
}

/**
 * A reference source or table, by its id, or the first source with none. A source's page searches all its tables,
 * `query`'s `q` for what and `page` for which page, or with `code` shows that code's page; a table's page searches it
 * alone. `checked` says the page tells what the last Check now did.
 */
async function showTable(response, id, query) {
  const text = query.get("q") ?? "";
  const shown = pageNumber(query.get("page"));
  let found;
  try {
    found = await api.table({
      id,
      q: text,
      page: shown,
      code: query.has("code") ? (query.get("code") ?? "") : undefined,
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return notFound(response, error.message);
  }
  const { held, source, series, searched, uses, facts } = found;
  const note = query.has("checked") ? lastCheck : undefined;
  if (source === undefined)
    return send(
      response,
      200,
      await page("Reference tables", noTables(), { note }),
    );
  const titles = await podTitles();
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
      titles,
      ...searchedHere,
      series,
      codeHref,
      searched,
      uses,
      pods: [...titles.keys()],
      href: podPath,
    });
  } else if (facts !== undefined) {
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
      searched,
      codeHref,
      tableHref: tablePath,
    });
  send(
    response,
    200,
    await page(title, body, { titles, table: source.iri, note }),
  );
}

/** Check now: reads every feed past any cache; the plaintext pods held open close when it kept a version, to open with it. An encrypted pod stays open, so it stays unlocked and an import into it goes on; it reads the new tables when next opened. */
async function checkNow(response) {
  await served.checkTables({});
  redirect(response, "/tables/?checked");
}

/** File, Delete all data: every pod removed, the reference tables kept, then the home page says how many. */
async function deleteEverything(response) {
  hospitals?.forget();
  const { deleted } = await api.deleteAll({});
  redirect(response, `/?deleted=${deleted.length}`);
}

/** File, Reset all data: the kits' pods loaded again, then the first pod's page says which are back. */
async function resetEverything(response) {
  hospitals?.forget();
  await api.resetAll({});
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
  const titles = await podTitles();
  if (titles.size > 0)
    return redirect(response, podPath([...titles.keys()][0]), 302);
  send(
    response,
    200,
    await page("No pods yet", noPods(), { titles, note: didNote(query, KITS) }),
  );
}

/**
 * The questions an empty chat offers on a page of the pod `name`, none with no model set. What the caller already has of
 * the pod's `answers`, what the tables say of them (`about`) and `changes` is used; the rest is read.
 */
async function suggested(name, known = {}) {
  if (model === undefined) return [];
  const given =
    known.answers === undefined
      ? await api.answers({ pod: name, last: true })
      : known;
  const { about, said } =
    "said" in known ? known : maps(await api.said({ pod: name }));
  return suggestedQuestions(given.answers, {
    changes: known.changes ?? given.changes,
    about,
    said,
  });
}

/**
 * The pod as a person reads it. `query`'s `from` is the number of a connection, and the page notes the record it
 * brought in when its import did; its `connection` is the number of one whose box the page holds, refreshing itself
 * by the connection's own address while it signs in, fetches and brings the record in. Once the record is in, the
 * box's address goes to the note.
 */
async function showPod(response, name, query, titles) {
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
  const { answers, changes, unheld } = await api.answers({
    pod: name,
    last: shown?.step === "bringing in",
  });
  const { about, said, held } = maps(await api.said({ pod: name }));
  const from = query.get("from");
  const noted = from === null ? undefined : hospitals.connection(name, from);
  const broughtIn = await noted?.imported?.catch(() => undefined);
  const box =
    shown === undefined
      ? undefined
      : connectionDialog({
          titles,
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
    titles,
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
    unheld,
    about: about ?? new Map(),
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
    await page(personName(name, titles), body, {
      current: name,
      titles,
      note: didNote(query, KITS),
      refresh: ["signing in", "pulling", "bringing in"].includes(shown?.step)
        ? `${podPath(name)}connections/${shown.n}`
        : undefined,
      suggestions: await suggested(name, { answers, about, changes, said }),
    }),
  );
}

/**
 * The entry of the pod whose address part is `id`: what it is, where it came from and what else is known, from the
 * answers the pod's page last showed when they hold it, else the pod's answers now. An entry the pod does not hold is
 * 404.
 */
async function showEntry(response, name, id, titles) {
  let found;
  try {
    found = maps(await api.said({ pod: name, entry: id }));
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
  }
  const { entry, panels = [], held = [] } = found ?? {};
  const sources = sourcesOf(held);
  const body = entryPage({
    titles,
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
      titles,
      suggestions: await suggested(
        name,
        found && { about: found.about, said: found.said },
      ),
    }),
  );
}

/**
 * The trend of the test `query`'s `test` names, the medication `medication` names marked: the pod's results of one
 * test over time. With no `test` it is the strongest change's, else the pod's first. A pod with no test result, a test
 * it holds no result of and a medication it lacks are each 404.
 */
async function showTrend(response, name, query, titles) {
  let found;
  try {
    found = maps(
      await api.trend({
        pod: name,
        test: query.get("test") || undefined,
        medication: query.get("medication") || undefined,
      }),
    );
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return notFound(response, error.message, { current: name, titles });
  }
  const { labs, series, timeline, test, medication, about } = found;
  const body = trendPage({
    titles,
    pod: name,
    back: podPath(name),
    labs,
    series,
    timeline,
    test,
    medication,
    trendHref: (trend) => trendPath(name, trend),
    about,
    ask: model !== undefined,
  });
  send(
    response,
    200,
    await page(trendTitle(series, about), body, {
      current: name,
      titles,
      suggestions: await suggested(name),
    }),
  );
}

const classesPath = (name) => `${podPath(name)}classes`;

/**
 * The pod's active medicines by the class the tables give them, or with `query`'s `class`, the medicines in that class
 * alone: `pod.medicationClasses()` names the classes, the tables their names. With no tables to name them the classes
 * are shown by their codes.
 */
async function showClasses(response, name, query, titles) {
  const {
    rows,
    medications,
    classes: about,
    elsewhere,
    held,
  } = maps(await api.classes({ pod: name }));
  const sources = sourcesOf(held);
  const body = classesPage({
    titles,
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
    await page("Medicines by class", body, { current: name, titles }),
  );
}

const panelPath = (name, code) =>
  `${podPath(name)}panel?${new URLSearchParams({ panel: code })}`;

/**
 * The pod's results in the LOINC panel `query`'s `panel` names, the code a person picked from a lab result's page:
 * `pod.panelResults(panel)` finds them, the tables name them. A panel is a code, so no panel is a 404.
 */
async function showPanel(response, name, query, titles) {
  let found;
  try {
    found = maps(
      await api.panel({ pod: name, panel: query.get("panel") ?? undefined }),
    );
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return notFound(response, error.message, { titles });
  }
  const { panel, rows, labs, panelAbout: about, held } = found;
  const sources = sourcesOf(held);
  const body = panelPage({
    titles,
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
        titles,
      },
    ),
  );
}

/** The page that says no pod was made, 400, and `why`. */
async function noPodMade(response, why) {
  send(
    response,
    400,
    await page(
      "No pod made",
      html`<h1>No pod made</h1>
<p>${why}</p>`,
    ),
  );
}

/** Makes an empty pod named after the person given, unless it exists, and goes to it; or shows its six words. */
async function newPod(request, response) {
  const form = await formOf(request);
  let made;
  try {
    made = await api.makePod({
      person: form.get("person") ?? "",
      encrypt: form.get("encrypt") === "on",
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return await noPodMade(response, error.message);
  }
  if (made.waiting) return await showWords(response, made.pod);
  redirect(response, podPath(made.pod));
}

const WORDS_AT = "/encrypted-pods";

/** The page that shows the six words waiting for the pod `name` and asks for words 2 and 5, never kept by a cache. */
async function showWords(response, name, problem) {
  const { person, words } = await api.waitingWords({ pod: name });
  send(
    response,
    problem === undefined ? 200 : 400,
    await page(
      "Your six words",
      sixWordsPage({
        pod: name,
        titles: new Map([[name, person]]),
        words,
        action: WORDS_AT,
        problem,
      }),
    ),
    { "cache-control": "no-store" },
  );
}

/** Makes the encrypted pod whose six words the person has checked, and goes to it. */
async function newEncryptedPod(request, response) {
  const form = await formOf(request);
  const name = form.get("pod") ?? "";
  try {
    await api.confirmWords({
      pod: name,
      ...Object.fromEntries(
        ["word2", "word5", "password", "username"].flatMap((field) =>
          form.has(field) ? [[field, form.get(field)]] : [],
        ),
      ),
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    const waiting = await api.waitingWords({ pod: name }).then(
      () => true,
      () => false,
    );
    if (waiting) return await showWords(response, name, error.message);
    return await noPodMade(response, error.message);
  }
  redirect(response, podPath(name));
}

/** The page of the pod `name` while it is locked, at the address `next`, which words will go to. */
async function showLocked(response, name, outcome, next, titles) {
  send(
    response,
    200,
    await page(
      "Open this pod",
      openPodPage({
        pod: name,
        titles,
        outcome,
        action: `${podPath(name)}open`,
        next,
      }),
      { current: name, titles, locked: true },
    ),
    { "cache-control": "no-store" },
  );
}

/** Opens the locked pod `name` with the words posted, then goes to the address asked for, or says why it did not open. */
async function unlock(request, response, name, titles) {
  const form = await formOf(request);
  const asked = form.get("next") ?? "";
  const next = asked.startsWith(podPath(name)) ? asked : podPath(name);
  try {
    await api.unlock({ pod: name, secret: form.get("password") ?? "" });
  } catch (error) {
    if (!(error instanceof Unopened)) throw error;
    return await showLocked(response, name, error.outcome, next, titles);
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

async function findHospital(response, name, text, titles) {
  const body = hospitalsPage({
    titles,
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
    await page("Find a hospital", body, { current: name, titles }),
  );
}

/** The files a connection's pull is saved as, or why there are none: the sign-in or the pull failed, or was refused. */
async function filesOf(connection) {
  let pulled;
  try {
    pulled = await connection.pulled;
  } catch (error) {
    if (!(error instanceof ConnectionFailure)) throw error;
    return { failed: `${error.message}.`, failure: error.kind };
  }
  try {
    return {
      pulled,
      files: pullFiles(
        { ...pulled, asOf: utcInstant(connection.asOf) },
        connection.name,
      ),
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
  const { failed, failure, pulled, files } = await filesOf(connection);
  if (failed !== undefined)
    return {
      failed,
      failure,
      signInAgain: (label) => signIn(name, connection.row.fhirBase, label),
    };
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
    sources: await (await api.podFor(name)).look(files),
    pulled,
    about: patientName(pulled.bundle),
    aboutNames: patientNames(pulled.bundle),
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
  redirect(response, boxOf(name, connection));
}

/** The pod's page with the connection's box open. */
const boxOf = (name, connection) =>
  `${podPath(name)}?connection=${connection.n}#connection`;

/** The import of a connection's pull into the pod, its parts in `connection.bringing`; it throws when there are no files. */
async function imported(name, connection) {
  const { failed, files } = await filesOf(connection);
  if (files === undefined) throw new Error(failed);
  return (await api.podFor(name)).import(files, {
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
 * sets it and goes back to the page it came from; an empty date, the Today button's, takes it back to every version; anything else answers 400 with the page
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
        back,
      }),
    ).then((body) => send(response, status, body));
  if (request.method !== "POST") return shown(200);
  try {
    await api.setWorldDate({ date: (await formOf(request)).get("date") ?? "" });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return shown(400, error.message);
  }
  return redirect(response, back);
}

/** The hospitals this app adds to the package's: a folder for each, holding its `hospital.json`. */
const HOSPITALS = fileURLToPath(new URL("hospitals/", import.meta.url));
/** The people this app adds to the package's: a folder for each, its `person.json` and each hospital's record of them. */
const PEOPLE = fileURLToPath(new URL("people/", import.meta.url));
/** The package's hospitals and people and this app's, or the app stopped with what is wrong with one of the app's. */
async function hospitalsHeld() {
  try {
    return await loadHospitals({
      hospitals: [...DEFAULT_ROOTS.hospitals, HOSPITALS],
      people: [...DEFAULT_ROOTS.people, PEOPLE],
    });
  } catch (error) {
    if (!(error instanceof HospitalDataError)) throw error;
    stderr.write(
      `A hospital in hospitals/ or a person in people/ cannot be used. ${error.message}\n`,
    );
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
    { names: () => host.pods.names(), open: (name) => api.podFor(name) },
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
/** The `Host` a request to this server names: a page of another name that rebinds to this address names its own. */
let ownHosts;
let hospitals;

const server = createServer(async (request, response) => {
  try {
    if (!ownHosts.has(request.headers.host))
      return send(
        response,
        403,
        await page(
          "Refused",
          html`<h1>Refused: not this server's address</h1>`,
        ),
      );
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
    if (post && pathname.startsWith("/api/"))
      return await apiRoute(served, request, response, {
        origins: ownOrigins,
      });
    if (post && pathname === "/chat")
      return await chatRoute(request, response, { model, tools: chatting });
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
    const titles = name === undefined ? undefined : await podTitles();
    if (name !== undefined && titles.has(name)) {
      const [, , view, n, entry] = at;
      const outcome = await lockedOutcome(name);
      if (view === "open") {
        if (post) return await unlock(request, response, name, titles);
        return redirect(response, podPath(name));
      }
      if (outcome !== undefined)
        return await showLocked(
          response,
          name,
          outcome,
          post ? podPath(name) : `${url.pathname}${url.search}`,
          titles,
        );
      const isHospitals = view === "hospitals" ? view : undefined;
      if (entry !== undefined && !post)
        return await showEntry(
          response,
          name,
          decodeURIComponent(entry),
          titles,
        );
      if (view === "trend" && !post)
        return await showTrend(response, name, url.searchParams, titles);
      if (view === "classes" && !post)
        return await showClasses(response, name, url.searchParams, titles);
      if (view === "panel" && !post)
        return await showPanel(response, name, url.searchParams, titles);
      if (isHospitals !== undefined && !post)
        return await findHospital(
          response,
          name,
          url.searchParams.get("q") ?? "",
          titles,
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
            { titles },
          ),
        );
      }
      const connection =
        n === undefined ? undefined : hospitals.connection(name, n);
      if (post && connection !== undefined)
        return bring(response, name, connection);
      if (!post && n !== undefined)
        return redirect(
          response,
          connection === undefined ? podPath(name) : boxOf(name, connection),
        );
      if (!post && n === undefined)
        return await showPod(response, name, url.searchParams, titles);
    }
    send(
      response,
      404,
      await page("Not found", html`<h1>Not found</h1>`, { titles }),
    );
  } catch (error) {
    send(
      response,
      500,
      await page("Error", html`<pre>${error?.message ?? String(error)}</pre>`, {
        titles: new Map(),
      }),
    );
  }
});

/** The demo hospitals are served on a loopback port of their own and reached over it, as an outside tool would. */
const listener = await serveDemo(demo, { asOf: startedAsOf });

server.listen(Number(env.PORT || 3000), "127.0.0.1", () => {
  const { port } = server.address();
  origin = `http://127.0.0.1:${port}`;
  ownOrigins = new Set([origin, `http://localhost:${port}`]);
  ownHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  hospitals = hospitalsAt(origin, demo, { asOf: startedAsOf, listener });
  host.world = {
    get: () => hospitals.worldDate(),
    set: (asOf) => hospitals.setWorldDate(asOf),
  };
  stdout.write(`${origin}/\n`);
  stdout.write(`The demo hospitals are listening at ${listener.origin}/\n`);
});

async function stop() {
  await listener.close();
  server.close();
  hospitals?.forget();
  await api.close();
  exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
