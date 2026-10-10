// The app: each pod as a person reads it, a way to make a new one, and a box over it that brings a record in from a
// hospital.
// `npm start`, then open the address it prints. What the pages show is in `summary.mjs`; this file answers requests,
// reads the pods, hands the module what it shows, with the addresses of this app, and renders what it gives to HTML.
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import process, { env, exit, stderr, stdout } from "node:process";
import { URL, URLSearchParams } from "node:url";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import {
  ConnectionFailure,
  openPod,
  pullFiles,
  tablesBeside,
} from "cascade-runtime";
import { render } from "preact-render-to-string";
import { hospitalsAt } from "./hospitals.mjs";
import {
  deleteAll,
  KITS,
  podFolder,
  podNames,
  POD_NAME,
  PODS,
  resetAll,
} from "./pods.mjs";
import {
  checkedNote,
  codePage,
  codesOf,
  connectionDialog,
  demoPeople,
  didNote,
  frame,
  hospitalName,
  hospitalsPage,
  html,
  newPodDialog,
  noPods,
  noTables,
  pageNumber,
  patientName,
  personName,
  podPage,
  postButton,
  QUESTIONS,
  slug,
  sourcePage,
  sourcesOf,
  tableId,
  tablePage,
} from "./summary.mjs";

/** Names Windows keeps for devices, which no folder may have. */
const DEVICES = /^(con|prn|aux|nul|com\d|lpt\d)$/;

/** Each pod opened on the first request for it, and kept open. */
const open = new Map();

function podNamed(name) {
  if (!open.has(name)) {
    const opening = openPod(podFolder(name));
    opening.catch(() => open.delete(name));
    open.set(name, opening);
  }
  return open.get(name);
}

/** Each pod's answers, by question, as its page last showed them. */
const lastShown = new Map();

async function answered(pod) {
  const answers = {};
  for (const question of QUESTIONS) answers[question] = await pod.ask(question);
  return answers;
}

const podPath = (name) => `/pods/${encodeURIComponent(name)}/`;

/** The reference tables the pods are matched with, kept in `pods/.tables/`. */
const tables = () => tablesBeside(PODS);
const tablePath = (series) =>
  `/tables/${encodeURIComponent(tableId(series.iri))}/`;

let unnamedSaid = false;

/** What the tables say of the codes `answers` hold; nothing when they cannot say, which the console is told once. */
function aboutCodes(answers) {
  return tables()
    .then((kept) => kept.about(codesOf(answers)))
    .catch((error) => {
      if (!unnamedSaid)
        stderr.write(
          `Records are shown by their own names: ${error.message}\n`,
        );
      unnamedSaid = true;
      return undefined;
    });
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
  { current, table, refresh, names, note } = {},
) {
  const pods = names ?? (await podNames());
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

/** Check now: reads every feed past any cache; the pods held open close when it kept a version, to open with it. */
async function checkNow(response) {
  const kept = await tables();
  const checked = await kept.check({ cache: "no-cache" });
  if (checked.some((each) => each.kept.length > 0)) await closePods();
  lastCheck = checkedNote(checked, await kept.held());
  redirect(response, "/tables/?checked");
}

/** Closes every pod the server holds open, to be opened again on the next request for it. */
async function closePods() {
  const pods = [...open.values()];
  open.clear();
  lastShown.clear();
  await Promise.allSettled(pods.map(async (pod) => (await pod).close()));
}

/** Closes every pod the server holds open, so that their folders can go, and forgets every connection to a hospital. */
async function closeAll() {
  hospitals?.forget();
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
      : await answered(await podNamed(name));
  lastShown.set(name, answers);
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
    connection: box,
    unheld: (await podNamed(name)).opened?.unheld,
    about: await aboutCodes(answers),
  });
  send(
    response,
    200,
    await page(personName(name), body, {
      current: name,
      names,
      note: didNote(query, KITS),
      refresh: ["signing in", "pulling", "bringing in"].includes(shown?.step),
    }),
  );
}

/** Makes an empty pod named after the person given, unless it exists, and goes to it. */
async function newPod(request, response) {
  const name = slug((await formOf(request)).get("person") ?? "");
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
  await podNamed(name);
  redirect(response, podPath(name));
}

function send(response, status, html) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
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
    return { pulled, files: pullFiles(pulled, connection.name) };
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

const demo = await loadHospitals();
const people = demoPeople(demo);
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
    if (pathname.startsWith("/demo-hospitals/"))
      return await demoHospitalPage(request, response, url);
    if (!post && pathname === "/")
      return await home(response, url.searchParams);
    if (post && pathname === "/pods") return await newPod(request, response);
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
    const at = /^\/pods\/([^/]+)\/(?:(hospitals)|connections\/(\d+))?$/.exec(
      pathname,
    );
    const name = at === null ? undefined : decodeURIComponent(at[1]);
    const names = name === undefined ? undefined : await podNames();
    if (name !== undefined && names.includes(name)) {
      const [, , isHospitals, n] = at;
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
  hospitals = hospitalsAt(origin, demo);
  stdout.write(`${origin}/\n`);
});

async function stop() {
  server.close();
  await closeAll();
  exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
