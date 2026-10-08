// The app: each pod as a person reads it, a way to make a new one, and a box over it that brings a record in from a
// hospital.
// `npm start`, then open the address it prints. What the pages show is in `summary.mjs`; this file answers requests,
// reads the pods, and hands the module what it shows, with the addresses of this app.
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import process, { env, exit, stdout } from "node:process";
import { URL, URLSearchParams } from "node:url";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import { ConnectionFailure, openPod, pullFiles } from "cascade-runtime";
import { hospitalsAt } from "./hospitals.mjs";
import {
  deleteAll,
  KITS,
  podFolder,
  podNames,
  POD_NAME,
  resetAll,
} from "./pods.mjs";
import {
  connectionDialog,
  demoPeople,
  didNote,
  escaped,
  frame,
  hospitalName,
  hospitalsPage,
  newPodDialog,
  noPods,
  patientName,
  personName,
  podPage,
  postButton,
  QUESTIONS,
  slug,
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

const podPath = (name) => `/pods/${encodeURIComponent(name)}/`;

/** `body` in the frame, with the pods there are; `names` given, it reads none. `note` says what was just done. */
async function page(title, body, { current, refresh, names, note } = {}) {
  const pods = names ?? (await podNames());
  return frame({
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
  });
}

/** What the File menu just did, from the page's address: `?deleted=<n>` or `?reset`. */
function didOf(query) {
  const deleted = query.get("deleted");
  if (deleted !== null && /^\d+$/.test(deleted))
    return didNote({ deleted: Number(deleted) });
  if (query.has("reset")) return didNote({ reset: KITS });
  return undefined;
}

/** Closes every pod the server holds open, so that their folders can go. */
async function closeAll() {
  const pods = [...open.values()];
  open.clear();
  await Promise.allSettled(pods.map(async (pod) => (await pod).close()));
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
  return postButton(`${podPath(name)}hospitals`, { fhirBase }, escaped(label));
}

async function home(response, query) {
  const names = await podNames();
  if (names.length > 0) return redirect(response, podPath(names[0]), 302);
  send(
    response,
    200,
    await page("No pods yet", noPods(), { names, note: didOf(query) }),
  );
}

/**
 * The pod as a person reads it. `query`'s `from` is the number of a connection, and the page notes the record it
 * brought in when its import did; its `connection` is the number of one whose box the page holds, refreshing itself
 * while it signs in and fetches.
 */
async function showPod(response, name, query, names) {
  const pod = await podNamed(name);
  const answers = {};
  for (const question of QUESTIONS) answers[question] = await pod.ask(question);
  const from = query.get("from");
  const noted = from === null ? undefined : hospitals.connection(name, from);
  const imported = await noted?.imported?.catch(() => undefined);
  const found = query.has("connection")
    ? hospitals.connection(name, query.get("connection"))
    : undefined;
  // As it is now, so that the box and whether the page refreshes agree on its step.
  const shown = found === undefined ? undefined : { ...found };
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
      imported === undefined || imported.refused !== undefined
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
  });
  send(
    response,
    200,
    await page(personName(name), body, {
      current: name,
      names,
      note: didOf(query),
      refresh: shown?.step === "signing in" || shown?.step === "pulling",
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
        `<h1>No pod made</h1>\n<p>${escaped(refused)}</p>`,
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
  if (connection.step === "signing in" || connection.step === "pulling")
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

/** Brings a connection's record into the pod, and goes back to it: noting the record, or with the box saying why not. */
async function bring(response, name, connection) {
  const box = `${podPath(name)}?connection=${connection.n}#connection`;
  if (connection.step !== "pulled") return redirect(response, box);
  const { files } = await filesOf(connection);
  if (files === undefined) return redirect(response, box);
  if (connection.imported === undefined) {
    connection.failed = undefined;
    connection.imported = (await podNamed(name)).import(files, {
      aboutSubject: true,
    });
  }
  let done;
  try {
    done = await connection.imported;
  } catch (error) {
    connection.imported = undefined;
    connection.failed = notBroughtIn(error);
    return redirect(response, box);
  }
  if (done.refused !== undefined) return redirect(response, box);
  redirect(response, `${podPath(name)}?from=${connection.n}`);
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
  packageOf("node_modules/cascade-runtime/package.json"),
]);
/** What Help, About says: this app, the cascade-runtime it runs on, and that package's README, where its code is. */
const about = {
  name: app.name,
  version: app.version,
  runtime: runtime.version,
  code: `${runtime.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}/tree/main/${runtime.repository.directory}#readme`,
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
        await page("Not allowed", "<h1>Not allowed</h1>"),
      );
    if (post && !ownOrigins.has(request.headers.origin))
      return send(
        response,
        403,
        await page("Refused", "<h1>Refused: a form from another site</h1>"),
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
    if (!post && pathname === "/callback") {
      const back = hospitals.back(url);
      if (back !== undefined) return redirect(response, back);
      return send(
        response,
        400,
        await page("Not waiting", "<h1>No sign-in is waiting for this</h1>"),
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
            "<h1>That hospital is not in the directory</h1>",
            { names },
          ),
        );
      }
      const connection =
        n === undefined ? undefined : hospitals.connection(name, n);
      if (post && connection !== undefined)
        return await bring(response, name, connection);
      if (!post && n === undefined)
        return await showPod(response, name, url.searchParams, names);
    }
    send(
      response,
      404,
      await page("Not found", "<h1>Not found</h1>", { names }),
    );
  } catch (error) {
    send(
      response,
      500,
      await page("Error", `<pre>${escaped(error.message)}</pre>`, {
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
  await Promise.allSettled(
    [...open.values()].map(async (pod) => (await pod).close()),
  );
  exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
