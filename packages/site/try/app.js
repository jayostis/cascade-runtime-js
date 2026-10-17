// The starter's view, in the browser: pods kept in this browser's own storage, each shown as a person reads it, a way
// to make one or load a published one, and a sign-in at a test hospital that brings a record in. The view is the
// starter's `summary.mjs`, served beside it as `summary.js`; this file routes, reads the pods, and hands the view the addresses of this page.
// What the page shows is `state`; `redraw()` renders it into one root, in place, so a box, a menu, a table's sort and
// filter and a scroll stay as they were. A pod's page is drawn from its kept answers; once it is, the engine loads in
// the background, and `data-engine` on the body says when it is ready.
// It is one page: its own links and forms change the address with `history.pushState` and `route()` draws what it
// names; a `#…` link is the browser's, which opens and closes the boxes. Each pod opened stays open.
import { render as renderInto } from "preact";
import {
  appTables,
  changesIn,
  changeTools,
  checkInput,
  checkTables,
  connect,
  ConnectionFailure,
  deletePod,
  DEMO_PLAN,
  labSeriesIn,
  openPod,
  popupSignIn,
  pull,
  pullFiles,
  Refusal,
  searchDirectory,
  sixWords,
  TEST_DIRECTORY,
  timelineIn,
  toolRegistry,
  typedWords,
  Unopened,
  warm,
} from "cascade-runtime";
import {
  hospitalId,
  setWorldDate,
  useDemoHospitals,
  worldDate,
} from "./demo-hospitals.js";
import {
  checkedNote,
  classedElsewhere,
  classesPage,
  classesSaid,
  closing,
  codePage,
  copyWords,
  codesSaid,
  connectionDialog,
  didNote,
  doing,
  entryId,
  entryOf,
  entryPage,
  HISTORY,
  hospitalName,
  hospitalsPage,
  html,
  joinedBy,
  LABS,
  layout,
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
  QUESTIONS,
  sixWordsPage,
  slug,
  sourcePage,
  sourcesOf,
  STYLE,
  tableId,
  tablePage,
  trendInput,
  trendPage,
  trendTitle,
  savedLoginChanged,
  variantsSaid,
  withMechanism,
  utcInstant,
  worldInstant,
} from "./summary.js";

const DATABASE = "cascade-pod:";
const ANSWERS = "cascade-answers:";
const BOX = "connection";
const REGISTRATION = {
  clientId: "cascade-runtime-demo",
  redirectUri: new URL("signed-in.html", location.href).href,
  scopes: ["launch/patient", "patient/*.read"],
};
const SAMPLES = (document.body.dataset.samples ?? "")
  .split(" ")
  .filter(Boolean);
/** What the File menu's items do, through the `submit` listener, and what Help, About says. */
const MENU = {
  deleteAll: "delete-all",
  resetAll: "reset-all",
  about: {
    name: "Cascade try",
    version: document.body.dataset.version ?? "",
    runtime: document.body.dataset.runtime ?? "",
    code: "../",
  },
};

const podHref = (name) => `?pod=${encodeURIComponent(name)}`;
const tableHref = (series) =>
  `?table=${encodeURIComponent(tableId(series.iri))}`;
const CHECK = "check-tables";

const WORKER = new URL("demo-hospital-worker.js", location.href);
const hospitalsReady = useDemoHospitals(WORKER);
hospitalsReady.catch(() => undefined);
const WORLD_DATE = "world-date";

/**
 * What the page shows: the pods here and the demo people; the pod shown, by name; `page`, the pod's page as its
 * `answers`, what the tables say of their codes (`about`, once the engine is ready) and the hospital a record was just
 * brought in `from`, or another page's `title` and `body`; the
 * `connection` under way or done, with its row, step, requests answered, once pulled the files to import, and what its
 * box says (`said`); what the File menu just did (`note`), as the address said when the page opened; what the page
 * is doing (`doing`), in `data-state` on the body, and while it is busy, what it says it is doing (`saying`); the
 * reference tables this browser holds (`tables`), read once the engine is ready, and the one shown (`table`), by IRI.
 */
const state = {
  pods: [],
  people: [],
  world: undefined,
  tables: [],
  tablesRead: undefined,
  table: undefined,
  current: undefined,
  page: undefined,
  connection: undefined,
  note: undefined,
  doing: "opening",
  saying: undefined,
};
/** Each pod opened, by name, kept open until every pod is deleted. */
const open = new Map();
/** The pod shown, open. */
let pod;
/** The address's query, as `route()` last drew it. */
let routed;

const root = document.createElement("div");
const line = document.createElement("div");
const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);

/** The names of the databases here whose name starts with `prefix`, without it. */
async function databases(prefix) {
  return (await indexedDB.databases())
    .map(({ name }) => name ?? "")
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();
}

const podsHere = () => databases(DATABASE);

/** The pod named `name`, opened with `options` the first time it is asked for, and kept open. */
function podNamed(name, options) {
  if (!open.has(name)) {
    const opening = openPod(name, options);
    opening.catch(() => open.delete(name));
    open.set(name, opening);
  }
  return open.get(name);
}

/** The demo people, as the view's `demoPeople` gave them when the site was built; none, when they cannot be read. */
async function demoPeople() {
  try {
    const answer = await fetch("demo-people.json");
    return answer.ok ? await answer.json() : [];
  } catch {
    return [];
  }
}

/** Replaces the address with `href`, which `route()` then takes as drawn. */
function replaceAddress(href) {
  history.replaceState(null, "", href);
  routed = location.search;
}

/** Closes the box open by the address's hash, as its close link does, so that what an action shows is not hidden behind it. */
function closeDialog() {
  if (location.hash === "") return;
  location.replace("#");
  replaceAddress(location.pathname + location.search);
}

const personOf = (name) =>
  state.people.find((each) => slug(each.name) === name);

const signInButton = (fhirBase, label) =>
  postButton("sign-in", { fhirBase }, label, undefined, "Signing in…");

/** An entry's address: the pod's, with the entry's part of its IRI. */
const entryHref = (pod, entry) =>
  `${podHref(pod)}&entry=${encodeURIComponent(entryId(entry))}`;

/** The address of a pod's trend of a test, a medication marked: the pod's, with `trend` and the test and medication. */
const trendHref = (pod, { test, medication }) =>
  `${podHref(pod)}&trend&${new URLSearchParams({
    test,
    ...(medication === undefined ? {} : { medication }),
  })}`;

/** The address of a pod's medicines by class, one class alone when `picked` is its code. */
const classesHref = (pod, picked) =>
  `${podHref(pod)}&classes${picked === undefined ? "" : `&${new URLSearchParams({ class: picked })}`}`;

/** The address of a pod's results in the LOINC panel with the code `panel`. */
const panelHref = (pod, panel) =>
  `${podHref(pod)}&${new URLSearchParams({ panel })}`;

/** The pages the model context offers as tools: the views of the page shown, and the changes of the pod shown. */
const registry = toolRegistry(document.modelContext);
/** The tools of the pod shown, and the controller whose signal ends them. */
let podTools;

/** Registers the change tools of `shown` while it is the pod shown; none when `shown` is undefined. */
function offerTools(shown) {
  if (podTools?.pod === shown) return;
  podTools?.controller.abort();
  podTools = undefined;
  if (shown === undefined) return;
  const controller = new AbortController();
  for (const tool of changeTools(shown))
    registry.register(tool, { signal: controller.signal });
  podTools = { pod: shown, controller };
}

/**
 * Registers `view`, a view of the page shown, as a tool that goes to its address; gives back what takes it away. The
 * tool's input is checked by the view's own schema.
 */
function register(view) {
  const controller = new AbortController();
  registry.register(
    {
      ...view,
      async execute(input) {
        checkInput(view.inputSchema, input);
        const href = trendHref(state.current, input);
        await busy(() => go(href), opening(href));
        return href;
      },
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}

/** The entry `state.page` names, as the pod's answers and what the tables say of its codes give it. */
function entryShown() {
  const { answers, about, said, entry, panels, joined } = state.page;
  const { current } = state;
  const found = entryOf(answers, entry, {
    about,
    said,
    held: state.tables,
    joined,
  });
  const sources = sourcesOf(state.tables);
  return {
    title: found?.name ?? "Not found",
    body: entryPage({
      entry: found,
      pod: current,
      back: podHref(current),
      codeHref: (series, notation) =>
        `${tableHref(sources.find((each) => each.series.includes(series)))}&${new URLSearchParams({ code: notation })}`,
      tableHref,
      panels,
      panelHref: (code) => panelHref(current, code),
    }),
  };
}

/** The page `state.page` names: its title and its body, the pod's page with the connection's box over it. */
function pageShown() {
  const { answers, about, said, from, title, body, entry } = state.page;
  if (answers === undefined) return { title, body };
  if (entry !== undefined) return entryShown();
  const { current, connection } = state;
  return {
    title: personName(current),
    body: podPage(answers, {
      pod: current,
      person: personOf(current),
      from,
      connection:
        connection &&
        connectionDialog({
          id: BOX,
          pod: current,
          hospital: connection.row.name,
          back: podHref(current),
          connection,
          bring: "bring",
          pulledAsOf: connection.asOf,
          ...connection.said,
        }),
      signIn: (hospital) =>
        signInButton(
          hospital.fhirBase,
          `Sign in at ${hospitalName(hospital.name)}`,
        ),
      findHospital: `${podHref(current)}&hospitals`,
      world: { asOf: state.world, action: WORLD_DATE },
      entryHref: (entry) => entryHref(current, entry),
      unheld: pod?.opened?.unheld,
      about,
      held: state.tables,
      said,
      changes: (state.page.changes ??= changesIn(
        answers[HISTORY] ?? [],
        answers[LABS] ?? [],
        { limit: 20 },
      )),
      trendHref: (trend) => trendHref(current, trend),
      classesHref: classesHref(current),
      register,
    }),
  };
}

/** Renders `state` into the page's root, changing only what changed. */
function redraw() {
  const { pods, people, current, note } = state;
  const { title, body } = pageShown();
  const samples = SAMPLES.filter((name) => !pods.includes(name));
  document.title = `${title} · Cascade`;
  if (!root.isConnected) document.body.replaceChildren(root, line);
  renderInto(
    layout({
      body,
      pods,
      current,
      href: podHref,
      home: "../",
      menu: MENU,
      note,
      tables: {
        series: sourcesOf(state.tables),
        current: state.table,
        href: tableHref,
        check: CHECK,
        loading: state.tablesRead === undefined,
        failed: state.tablesRead === "failed",
      },
      dialog: newPodDialog({
        people,
        pods,
        action: "make",
        more:
          samples.length === 0
            ? undefined
            : {
                said: "Or open a sample pod, already filled with records from several places.",
                choices: samples.map((name) => ({
                  label: `Load ${personName(name)}`,
                  note: "A copy of a published example pod",
                  action: "load",
                  fields: { pod: name },
                  doing: `Loading ${personName(name)}'s pod…`,
                })),
              },
      }),
    }),
    root,
  );
  showDoing();
}

/**
 * `state.doing` in `data-state` on the body; while the page is busy, every button off and the line saying what it is
 * doing, drawn in a root of its own so that it shows before the page is drawn again.
 */
function showDoing() {
  const busy = state.doing === "busy";
  document.body.dataset.state = state.doing;
  for (const button of document.querySelectorAll("button"))
    button.disabled = busy;
  if (!line.isConnected) document.body.append(line);
  renderInto(doing(busy ? state.saying : undefined), line);
}

/** Shows `body` titled `title`; `doing` is what the page says it is doing. */
function render(title, body, doing = "ready") {
  state.page = { title, body };
  state.doing = doing;
  redraw();
}

/** Every question's rows from the pod shown, by question. */
async function answered() {
  const answers = Object.fromEntries(
    await Promise.all(
      QUESTIONS.map(async (question) => [question, await pod.ask(question)]),
    ),
  );
  return withMechanism(
    answers,
    changesIn(answers[HISTORY] ?? [], answers[LABS] ?? [], { limit: 20 }),
    (question) => pod.ask(question),
  );
}

/** What the tables say of the codes `answers` hold; nothing before the engine is ready, or when they cannot say. */
async function aboutCodes(answers) {
  if (document.body.dataset.engine !== "ready") return undefined;
  try {
    return await codesSaid(answers, { tables: await appTables() });
  } catch {
    return undefined;
  }
}

/** What the tables say of the variants `answers` hold; nothing before the engine is ready, or when they cannot say. */
async function variantsOf(answers) {
  if (document.body.dataset.engine !== "ready") return undefined;
  try {
    return await variantsSaid(answers, { tables: await appTables(), pod });
  } catch {
    return undefined;
  }
}

/** The pod's page; `from` names the hospital a record was just brought in from. */
async function showPod(from) {
  const answers = await answered();
  state.page = {
    answers,
    about: await aboutCodes(answers),
    said: await variantsOf(answers),
    from,
  };
  state.doing = "ready";
  redraw();
  reopenBox();
}

/**
 * Opens the box the address's hash names once the page is drawn: the browser matches `:target` when it goes to an
 * address, not for an element drawn after, as when Back returns to the pod's page from an entry opened from its box.
 */
function reopenBox() {
  const { hash } = location;
  if (hash.length > 1 && document.getElementById(hash.slice(1)))
    location.replace(hash);
}

/** The entry whose address part is `id`, from the pod's answers; one the pod does not hold says so. */
async function showEntry(id) {
  const answers = await answered();
  const [about, said] = await Promise.all([
    aboutCodes(answers),
    variantsOf(answers),
  ]);
  const shown = { answers, entry: id, about, said };
  state.page = shown;
  state.doing = "ready";
  redraw();
  shown.panels = await panelsShown(shown);
  shown.joined = await joinedShown(shown);
  if (
    state.page === shown &&
    (shown.panels !== undefined || shown.joined !== undefined)
  )
    redraw();
}

/** The table versions whose rows joined the entry `shown`; nothing before the engine is ready. */
async function joinedShown({ entry }) {
  if (entry === undefined || document.body.dataset.engine !== "ready")
    return undefined;
  try {
    return await joinedBy(pod);
  } catch {
    return undefined;
  }
}

/** The LOINC panels the entry `shown` is in; nothing before the engine is ready, or when the tables cannot say. */
async function panelsShown({ answers, entry, about, said }) {
  if (entry === undefined || document.body.dataset.engine !== "ready")
    return undefined;
  try {
    const held = state.tables;
    return await panelsOf(entryOf(answers, entry, { about, said, held }), {
      tables: await appTables(),
      held,
    });
  } catch {
    return undefined;
  }
}

/**
 * The pod's results in the LOINC panel with the code `panel`. They come from the engine and the tables, so the page
 * waits for both.
 */
async function showPanel(panel) {
  const { current } = state;
  const [rows, labs] = await Promise.all([
    pod.panelResults(panel),
    pod.ask(LABS),
  ]);
  const tables = await appTables();
  const [about] = await Promise.all([
    panelSaid(panel, rows, { tables }).catch(() => undefined),
    readTables(),
  ]);
  const sources = sourcesOf(state.tables);
  render(
    `Your results in ${about?.get(panel)?.name?.label ?? "a panel"}`,
    panelPage({
      pod: current,
      back: podHref(current),
      panel,
      rows,
      labs,
      about,
      held: state.tables,
      entryHref: (entry) => entryHref(current, entry),
      codeHref: (series, notation) =>
        `${tableHref(sources.find((each) => each.series.includes(series)))}&${new URLSearchParams({ code: notation })}`,
    }),
  );
}

/**
 * The trend of the test `query`'s `test` names, the medication `medication` names marked; with no test, the strongest
 * change's, else the pod's first. A test the pod holds no result of says so.
 */
async function showTrend(query) {
  const [medications, labs] = await Promise.all([
    pod.ask(HISTORY),
    pod.ask(LABS),
  ]);
  const input = trendInput(
    { changes: changesIn(medications, labs, { limit: 20 }), labs },
    {
      test: query.get("test") ?? undefined,
      medication: query.get("medication") ?? undefined,
    },
  );
  let series;
  try {
    series = input === undefined ? undefined : labSeriesIn(labs, input.test);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
  }
  const { current } = state;
  const about = await aboutCodes({ [HISTORY]: medications, [LABS]: labs });
  render(
    series === undefined ? "Not found" : trendTitle(series, about),
    trendPage({
      pod: current,
      back: podHref(current),
      labs,
      series,
      timeline: timelineIn(medications),
      test: input?.test,
      medication: input?.medication,
      trendHref: (trend) => trendHref(current, trend),
      about,
      register,
    }),
  );
}

/**
 * The pod's active medicines by the class the tables give them, or with `picked` that class alone. The classes come
 * from the engine and the tables, so the page waits for both.
 */
async function showClasses(picked) {
  const { current } = state;
  const [rows, medications] = await Promise.all([
    pod.medicationClasses(),
    pod.ask(MEDICATIONS),
  ]);
  const tables = await appTables();
  const [about, elsewhere] = await Promise.all([
    classesSaid(rows, { tables }).catch(() => undefined),
    classedElsewhere(rows, medications, { tables }).catch(() => undefined),
    readTables(),
  ]);
  const sources = sourcesOf(state.tables);
  render(
    "Medicines by class",
    classesPage({
      pod: current,
      back: podHref(current),
      rows,
      medications,
      about,
      elsewhere,
      held: state.tables,
      picked,
      classHref: (code) => classesHref(current, code),
      allHref: classesHref(current),
      entryHref: (entry) => entryHref(current, entry),
      codeHref: (series, notation) =>
        `${tableHref(sources.find((each) => each.series.includes(series)))}&${new URLSearchParams({ code: notation })}`,
    }),
  );
}

function showHospitals(text) {
  const { current, people } = state;
  render(
    "Find a hospital",
    hospitalsPage({
      pod: current,
      rows: searchDirectory(TEST_DIRECTORY, text),
      text,
      search: `${podHref(current)}&hospitals`,
      signIn: (row) => signInButton(row.fhirBase, "Sign in"),
      world: { asOf: state.world, action: WORLD_DATE },
      people,
      back: podHref(current),
    }),
  );
}

/** Reads the reference tables this browser holds into `state.tables`, and notes whether the read answered. */
async function readTables() {
  try {
    state.tables = await (await appTables()).held();
    state.tablesRead = "read";
  } catch (error) {
    state.tablesRead = "failed";
    throw error;
  }
}

/**
 * The reference source or table `id` names, or the first source with none. A source's page searches all its tables
 * for `text`, page `shown` of what it finds, or with `code` shows that code's page; a table's page searches it alone.
 */
async function showTable(id, text, shown, code) {
  const tables = await appTables();
  await readTables();
  state.current = undefined;
  const sources = sourcesOf(state.tables);
  const series =
    id === "" || code !== null
      ? undefined
      : state.tables.find((each) => tableId(each.iri) === id);
  const source =
    series !== undefined
      ? sources.find((each) => each.series.includes(series))
      : id === ""
        ? sources[0]
        : sources.find((each) => tableId(each.iri) === id);
  const notFound = (said) =>
    render(
      "Not found",
      html`<h1>Not found</h1>
<p>${said}</p>`,
    );
  if (source === undefined)
    return id === ""
      ? render("Reference tables", noTables())
      : notFound(`This browser holds no reference table ${id}.`);
  state.table = source.iri;
  const at = series ?? source;
  const searchedHere = {
    text,
    search: tableHref(at),
    page: shown,
    pageHref: (page) =>
      `${tableHref(at)}&${new URLSearchParams({ q: text, page })}`,
    now: Date.now(),
  };
  const codeHref = (written) =>
    `${tableHref(source)}&${new URLSearchParams({ code: written })}`;
  if (series !== undefined)
    return render(
      series.label,
      tablePage({
        ...searchedHere,
        series,
        codeHref,
        searched: await tables.search(series.iri, text, shown),
        uses: await tables.uses(),
        pods: state.pods,
        href: podHref,
      }),
    );
  const all = source.series.map(({ iri }) => iri);
  if (code !== null) {
    const found = await tables.codeNamed(
      [...new Set([...all, ...state.tables.map(({ iri }) => iri)])],
      code,
    );
    if (found === undefined)
      return notFound(`${source.label} holds no code ${code}.`);
    const facts = await tables.facts(found, all);
    return render(
      `${facts.notation} ${facts.about?.name?.label ?? ""}`.trim(),
      codePage({
        source,
        held: state.tables,
        facts,
        codeHref,
        back: tableHref(source),
      }),
    );
  }
  render(
    source.label,
    sourcePage({
      ...searchedHere,
      source,
      searched: await tables.search(all, text, shown),
      codeHref,
      tableHref,
    }),
  );
}

/** Check now: reads every feed past any cache, opens the plaintext pods again with what it kept, and says what it did; an encrypted pod stays open and unlocked, and reads the new tables when next opened. */
async function checkNow() {
  const checked = await checkTables();
  if (checked.some(({ kept }) => kept.length > 0)) {
    for (const [name, opening] of [...open]) {
      const each = await opening.catch(() => undefined);
      if (each?.encrypted) continue;
      open.delete(name);
      if (each === pod) pod = undefined;
      await each?.close().catch(() => undefined);
    }
  }
  await readTables();
  const note = checkedNote(checked, state.tables);
  await go("?table=");
  state.note = note;
  redraw();
}

/** Draws the page the address names: a pod's page, its hospitals, or no pod; the samples copied in on a first visit. */
async function route() {
  routed = location.search;
  const query = new URLSearchParams(location.search);
  state.connection = undefined;
  state.note = didNote(query, SAMPLES);
  if (state.note !== undefined) {
    const rest = new URLSearchParams(query);
    rest.delete("deleted");
    rest.delete("reset");
    replaceAddress(String(rest) === "" ? location.pathname : `?${rest}`);
  }
  state.table = undefined;
  if (query.has("table")) {
    offerTools(undefined);
    return showTable(
      query.get("table") ?? "",
      query.get("q") ?? "",
      pageNumber(query.get("page")),
      query.get("code"),
    );
  }
  const asked = query.get("pod");
  state.current = asked ?? undefined;
  if (asked === null && state.pods.length === 0) {
    offerTools(undefined);
    if (!query.has("deleted") && !deletedAll()) await firstVisit();
    if (state.pods.length === 0) return render("No pods yet", noPods());
  }
  if (asked !== null && !state.pods.includes(asked)) {
    offerTools(undefined);
    state.current = undefined;
    return render(
      "Not found",
      html`<h1>Not found</h1>
<p>This browser keeps no pod named ${asked}.</p>`,
    );
  }
  state.current = asked ?? state.pods[0];
  if (asked === null) replaceAddress(podHref(state.current));
  try {
    pod = await podNamed(state.current);
  } catch (error) {
    if (!(error instanceof Unopened)) throw error;
    pod = undefined;
    offerTools(undefined);
    return showLocked(error.outcome);
  }
  offerTools(pod);
  if (query.has("hospitals")) return showHospitals(query.get("q") ?? "");
  if (query.has("entry")) return showEntry(query.get("entry") ?? "");
  if (query.has("trend")) return showTrend(query);
  if (query.has("classes")) return showClasses(query.get("class") ?? undefined);
  if (query.has("panel")) return showPanel(query.get("panel") ?? "");
  await showPod();
}

/**
 * Goes to `href`, an address of this page, without leaving it: a box open by the hash is closed first, unless `keep`
 * and the address is another, so that the history entry left still names the box and Back opens it again. The address
 * shown already is drawn again in place of its entry in the history, not after it.
 */
function go(href, keep = false) {
  const same = new URL(href, location.href).search === location.search;
  if (!keep || same) closeDialog();
  if (same) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  return route();
}

/**
 * Shows the connection in its box over the pod's page, saying `said`, and opens the box by its hash if it is not open.
 * Once Back or Forward has moved the address under the step, the box is not opened: the page follows the address
 * when the step ends.
 */
function showConnection(said, doing) {
  state.connection.said = said;
  state.doing = doing;
  redraw();
  if (location.hash === `#${BOX}` || location.search !== routed) return;
  replaceAddress(podHref(state.current));
  location.replace(`#${BOX}`);
}

/** Signs in at the hospital in `popup`, opened in the click, fetches the record, and shows what it has. */
async function signIn(fhirBase, popup) {
  const row = TEST_DIRECTORY.find((each) => each.fhirBase === fhirBase);
  if (row === undefined) {
    popup?.close();
    throw new Error("That hospital is not in the directory.");
  }
  const shown = { row, step: "signing in", asOf: state.world, requests: 0 };
  state.connection = shown;
  const answers = await answered();
  state.page = {
    answers,
    about: await aboutCodes(answers),
    said: await variantsOf(answers),
  };
  const now = (said = {}, doing = "busy") => {
    if (state.connection === shown) showConnection(said, doing);
  };
  now();
  const failed = (said) => {
    shown.step = "failed";
    return now({ failed: said }, "ready");
  };
  const demo = row.vendor === "demo";
  try {
    if (demo) await hospitalsReady;
  } catch (error) {
    popup?.close();
    return failed(error.message);
  }
  try {
    const signedIn = await connect(row, REGISTRATION, {
      signIn: popupSignIn({ popup }),
      fetch: async (url, init) => {
        const answer = await globalThis.fetch(url, init);
        shown.requests += 1;
        return answer;
      },
    });
    shown.step = "pulling";
    now();
    const pulled = await pull(signedIn, DEMO_PLAN);
    shown.files = pullFiles(
      { ...pulled, asOf: demo ? utcInstant(shown.asOf) : undefined },
      `${demo ? hospitalId({ hospital: row }) : row.vendor}-${Date.now()}`,
    );
    shown.step = "pulled";
    now(
      {
        sources: await pod.look(shown.files),
        pulled,
        about: patientName(pulled.bundle),
      },
      "ready",
    );
  } catch (error) {
    if (!(error instanceof ConnectionFailure)) throw error;
    failed(`Not connected: ${error.message}.`);
  } finally {
    popup?.close();
  }
}

/**
 * Sets the date the demo hospitals answer as of to `text`, a day or an instant, or with none back to everything they
 * hold, and draws the box again. The next sign-in answers as of it.
 */
async function changeWorld(text) {
  const asOf = worldInstant(text);
  if (text.trim() !== "" && asOf === undefined)
    throw new Error(`"${text}" is not a date.`);
  await hospitalsReady;
  await setWorldDate(WORKER, asOf);
  state.world = asOf;
  const search = new URLSearchParams(location.search);
  if (search.has("hospitals")) showHospitals(search.get("q") ?? "");
  else redraw();
}

/**
 * Brings the pulled record into the pod, its box saying each part as it begins, and goes back to the pod, noting
 * where the record came from.
 */
async function bring() {
  const shown = state.connection;
  if (shown?.files === undefined) return showPod();
  shown.step = "bringing in";
  shown.bringing = undefined;
  let done;
  showConnection({}, "busy");
  try {
    done = await pod.import(shown.files, {
      aboutSubject: true,
      onProgress: (part) => {
        shown.bringing = part;
      },
    });
  } catch (error) {
    shown.step = "failed";
    return showConnection(
      { failed: `Not brought in: ${error.message}`, retry: true },
      "error",
    );
  }
  if (done.refused !== undefined) {
    shown.step = "failed";
    return showConnection({ failed: `Refused: ${done.refused}` }, "ready");
  }
  state.connection = undefined;
  if (location.hash === `#${BOX}`) closeDialog();
  await showPod(shown.row.name);
}

/** In this browser's storage while Delete all data is the last thing done, so that a later visit copies no sample in. */
const DELETED_ALL = "cascade-try:deleted-all";

/** Whether Delete all data was the last thing done; false when storage cannot be read. */
function deletedAll() {
  try {
    return globalThis.localStorage.getItem(DELETED_ALL) !== null;
  } catch {
    return false;
  }
}

/** Notes, or with `false` forgets, that Delete all data was the last thing done; nothing when storage cannot be written. */
function markDeletedAll(deleted) {
  try {
    if (deleted) globalThis.localStorage.setItem(DELETED_ALL, "1");
    else globalThis.localStorage.removeItem(DELETED_ALL);
  } catch {
    // Without storage, a later visit copies the samples, as a first one does.
  }
}

/** The encrypted pod being made, `{ name, person, words }`, until its words are checked. Kept in memory only. */
let making;

/** The six-words page for the pod being made, saying `problem` when the last check failed. */
function showWords(problem) {
  closeDialog();
  state.current = undefined;
  return render(
    "Your six words",
    sixWordsPage({
      pod: making.name,
      words: making.words,
      action: "confirm-words",
      problem,
    }),
  );
}

/** The page of the encrypted pod shown while it is locked; `outcome` is how it last failed to open. */
function showLocked(outcome) {
  return render(
    "Open this pod",
    openPodPage({
      pod: state.current,
      outcome,
      action: "unlock",
      next: location.search,
    }),
  );
}

/** Offers the words to the browser's password manager, where it has an API for it; never relied on. */
function offerToSave(name, words) {
  try {
    const { PasswordCredential } = globalThis;
    if (PasswordCredential === undefined) return;
    globalThis.navigator.credentials
      .store(new PasswordCredential({ id: name, name, password: words }))
      .catch(() => undefined);
  } catch {
    // The offer is a courtesy.
  }
}

/** Makes the encrypted pod whose words were checked, and goes to it; else shows the page again, saying why not. */
async function confirmWords(fields) {
  if (making === undefined) {
    closeDialog();
    return render(
      "No pod made",
      html`<h1>No pod made</h1>
<p>These six words are not waiting any more. Make the pod again.</p>`,
    );
  }
  const changed = savedLoginChanged(fields, making.name, making.words);
  if (changed !== undefined) return showWords(changed);
  const asked = making.words.split(" ");
  if (
    typedWords(String(fields.get("word2") ?? "")) !== asked[1] ||
    typedWords(String(fields.get("word5") ?? "")) !== asked[4]
  )
    return showWords(NOT_WORDS);
  const { name, person, words } = making;
  if ((await podsHere()).includes(name)) {
    making = undefined;
    closeDialog();
    return render(
      "No pod made",
      html`<h1>No pod made</h1>
<p>A pod named ${name} exists already. Make the pod again under another name.</p>`,
    );
  }
  if (!(await podNamed(name, { title: person, secret: words })).encrypted)
    throw new Error(`The pod ${name} was made without its words.`);
  making = undefined;
  offerToSave(name, words);
  state.pods = await podsHere();
  return go(podHref(name));
}

/** Opens the locked pod shown with the words typed, and draws it; else says why it did not open. */
async function unlock(fields) {
  const secret = String(fields.get("password") ?? "");
  if (secret.trim() === "") return showLocked("incorrect secret");
  try {
    pod = await podNamed(state.current, { secret });
  } catch (error) {
    if (!(error instanceof Unopened)) throw error;
    return showLocked(error.outcome);
  }
  return go(location.search);
}

/** Makes an empty pod named after the person, unless it exists or is a sample's, which it loads, and goes to it; with `encrypt`, asks for words first. */
async function make(person, encrypt = false) {
  markDeletedAll(false);
  const name = slug(person);
  if (SAMPLES.includes(name)) return load(name);
  if (encrypt && name !== "" && !state.pods.includes(name)) {
    making = { name, person: person.trim(), words: sixWords() };
    return showWords();
  }
  if (name === "") {
    closeDialog();
    return render(
      "No pod made",
      html`<h1>No pod made</h1>
<p>Give a name with at least one letter from a to z, or a digit.</p>`,
    );
  }
  if (!state.pods.includes(name))
    await podNamed(name, { title: person.trim() });
  state.pods = await podsHere();
  return go(podHref(name));
}

/** Copies the published example pod into this browser, and keeps it open. */
async function copy(name) {
  await podNamed(name, { from: `../${name}/pod/` });
}

/** Copies the published example pod into this browser, unless it is here already, and goes to it. */
async function load(name) {
  if (!SAMPLES.includes(name)) throw new Error(`No sample pod ${name}.`);
  markDeletedAll(false);
  if (!state.pods.includes(name)) await copy(name);
  state.pods = await podsHere();
  return go(podHref(name));
}

/**
 * Closes every pod open and deletes every pod and its answers, saying so when another tab keeps one open; gives the
 * names of the pods there were.
 */
async function deleteAll() {
  const opened = [...open.values()];
  open.clear();
  pod = undefined;
  making = undefined;
  await Promise.allSettled(opened.map(async (each) => (await each).close()));
  const names = await podsHere();
  const all = new Set([...names, ...(await databases(ANSWERS))]);
  const waiting = window.setTimeout(() => {
    state.saying = "Waiting for the pods to close in your other tabs…";
    showDoing();
  }, 2000);
  const deleted = await Promise.allSettled([...all].map(deletePod));
  window.clearTimeout(waiting);
  state.pods = await podsHere();
  const failed = deleted.find(({ status }) => status === "rejected");
  if (failed !== undefined) throw failed.reason;
  return names;
}

/** File, Delete all data: then the page says how many went, and no visit copies a sample in until a pod is made again. */
async function deleteEverything() {
  const names = await deleteAll();
  markDeletedAll(true);
  return go(`?deleted=${names.length}`);
}

/** File, Reset all data: every pod deleted and every sample copied again, then the first sample's page says so. */
async function resetEverything() {
  markDeletedAll(false);
  await deleteAll();
  await Promise.all(SAMPLES.map(copy));
  state.pods = await podsHere();
  return go(SAMPLES.length === 0 ? "?reset" : `${podHref(SAMPLES[0])}&reset`);
}

/**
 * A browser with no pod starts with a copy of every sample; one that fails and leaves nothing behind stays a "Load"
 * choice in the new-pod box. One that leaves its database behind, or none copying because the runtime fails, throws.
 */
async function firstVisit() {
  const copies = await Promise.allSettled(SAMPLES.map(copy));
  state.pods = await podsHere();
  const left = SAMPLES.findIndex(
    (name, at) => copies[at].status === "rejected" && state.pods.includes(name),
  );
  if (left !== -1) throw copies[left].reason;
  if (state.pods.length === 0) await (await openPod()).close();
}

/**
 * Runs the step with the page busy, saying `saying`; while the page is busy, another step does not start. Back or
 * Forward pressed meanwhile moves the address, and the page follows it once the step ends. Anything the step did not
 * expect, it shows.
 */
async function busy(step, saying = "Working…") {
  if (state.doing === "busy") return;
  state.doing = "busy";
  state.saying = saying;
  showDoing();
  try {
    await step();
    if (location.search !== routed) await route();
  } catch (error) {
    closeDialog();
    render(
      "Something went wrong",
      html`<h1>Something went wrong</h1>
<p>${error?.message ?? String(error)}</p>`,
      "error",
    );
  }
  if (state.doing === "busy") {
    state.doing = "ready";
    showDoing();
  }
}

/** What the page says while it goes to the address in `query`. */
function opening(query) {
  const name = new URLSearchParams(query).get("pod");
  return name === null ? "Opening…" : `Opening ${personName(name)}'s pod…`;
}

closing(document);
copyWords(document);
document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (link === null || link === undefined || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
    return;
  const href = link.getAttribute("href") ?? "";
  const to = new URL(href, location.href);
  if (href.startsWith("#") || to.pathname !== location.pathname) return;
  event.preventDefault();
  busy(() => go(to.search, true), opening(to.search));
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  event.preventDefault();
  if (state.doing === "busy") return;
  const action = form.getAttribute("action") ?? "";
  const fields = new FormData(form);
  const saying = form.dataset.doing;
  if (form.method === "get") {
    const to = new URL(action, location.href);
    for (const [key, value] of fields) to.searchParams.set(key, String(value));
    busy(() => go(to.search), saying);
  } else if (action === "sign-in") {
    const popup = window.open(
      "",
      "cascade-sign-in",
      "popup,width=520,height=720",
    );
    busy(() => signIn(String(fields.get("fhirBase")), popup), saying);
  } else if (action === WORLD_DATE)
    busy(() => changeWorld(String(fields.get("date") ?? "")), saying);
  else if (action === "bring") busy(bring, saying);
  else if (action === "load")
    busy(() => load(String(fields.get("pod"))), saying);
  else if (action === "make")
    busy(
      () =>
        make(
          String(fields.get("person") ?? ""),
          document.getElementById("encrypt-pod")?.checked === true,
        ),
      saying,
    );
  else if (action === "confirm-words") busy(() => confirmWords(fields), saying);
  else if (action === "unlock") busy(() => unlock(fields), saying);
  else if (action === MENU.deleteAll) busy(deleteEverything, saying);
  else if (action === MENU.resetAll) busy(resetEverything, saying);
  else if (action === CHECK) busy(checkNow, saying);
});
window.addEventListener("popstate", () => {
  if (location.search !== routed) busy(route, opening(location.search));
});

busy(async () => {
  [state.pods, state.people, state.world] = await Promise.all([
    podsHere(),
    demoPeople(),
    worldDate(WORKER).catch(() => undefined),
  ]);
  await route();
}, "Opening…").then(() =>
  warm().then(
    async () => {
      document.body.dataset.engine = "ready";
      await readTables().catch(() => undefined);
      // Each page is named from its own answers, until the page shown is one that was named. What ClinVar says of a
      // variant is what a person waits for and needs none of the names, so it is drawn as soon as it is known.
      for (
        let shown = state.page;
        shown?.answers !== undefined && shown.about === undefined;
        shown = state.page
      ) {
        shown.said = await variantsOf(shown.answers);
        if (state.page === shown) redraw();
        shown.about = (await aboutCodes(shown.answers)) ?? new Map();
        shown.panels = await panelsShown(shown);
        shown.joined = await joinedShown(shown);
      }
      if (state.page !== undefined) redraw();
      document.body.dataset.tables = "ready";
    },
    () => {
      state.tablesRead ??= "failed";
      if (state.page !== undefined) redraw();
    },
  ),
);
