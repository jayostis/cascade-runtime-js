// The app: each pod as a person reads it, a way to make a new one, and pages that bring a record in from a hospital.
// `npm start`, then open the address it prints. What the pages show is in `summary.mjs`; this file answers requests,
// reads the pods, and hands the module what it shows, with the addresses of this app.
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import process, { env, exit, stdout } from "node:process";
import { URL, URLSearchParams } from "node:url";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import { ConnectionFailure, openPod, pullFiles } from "cascade-runtime";
import { hospitalsAt } from "./hospitals.mjs";
import { podFolder, podNames, POD_NAME } from "./pods.mjs";
import {
  connectionPage,
  demoPeople,
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

/** `body` in the frame, with the pods there are; `names` given, it reads none. */
async function page(title, body, { current, refresh, names } = {}) {
  const pods = names ?? (await podNames());
  return frame({
    title,
    body,
    pods,
    current,
    href: podPath,
    home: "/",
    dialog: newPodDialog({ people, pods, action: "/pods" }),
    refresh,
  });
}

/** A button that starts signing the pod's person in to the hospital at `fhirBase`. */
function signIn(name, fhirBase, label) {
  return postButton(`${podPath(name)}hospitals`, { fhirBase }, escaped(label));
}

async function home(response) {
  const names = await podNames();
  if (names.length > 0) return redirect(response, podPath(names[0]), 302);
  send(response, 200, await page("No pods yet", noPods(), { names }));
}

/** The pod as a person reads it; `from` is the number of the connection a record was just brought in through. */
async function showPod(response, name, from) {
  const pod = await podNamed(name);
  const answers = {};
  for (const question of QUESTIONS) answers[question] = await pod.ask(question);
  const connection =
    from === null ? undefined : hospitals.connection(name, from);
  const body = podPage(answers, {
    pod: name,
    person: people.find((each) => slug(each.name) === name),
    from: connection?.row.name,
    signIn: (hospital) =>
      signIn(
        name,
        hospital.fhirBase,
        `Sign in at ${hospitalName(hospital.name)}`,
      ),
    findHospital: `${podPath(name)}hospitals`,
  });
  send(response, 200, await page(personName(name), body, { current: name }));
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

async function findHospital(response, name, text) {
  const body = hospitalsPage({
    pod: name,
    rows: hospitals.directory(text),
    text,
    search: `${podPath(name)}hospitals`,
    signIn: (row) => signIn(name, row.fhirBase, "Sign in"),
    people,
    back: podPath(name),
  });
  send(response, 200, await page("Find a hospital", body, { current: name }));
}

/**
 * A connection: its steps while it signs in and fetches, the page refreshing itself; then why it failed, or what the
 * hospital has and a button to bring it in; after the import, back to the pod.
 */
async function showConnection(response, name, connection, importing) {
  const shown = async (status, view) =>
    send(
      response,
      status,
      await page(
        hospitalName(connection.row.name),
        connectionPage({
          pod: name,
          hospital: connection.row.name,
          back: podPath(name),
          connection,
          bring: `${podPath(name)}connections/${connection.n}`,
          ...view,
        }),
        { current: name, refresh: view.refresh },
      ),
    );
  if (connection.step === "signing in" || connection.step === "pulling")
    return shown(200, { refresh: true });
  let pulled;
  try {
    pulled = await connection.pulled;
  } catch (error) {
    if (!(error instanceof ConnectionFailure)) throw error;
    return shown(200, { failed: `Not connected: ${error.message}.` });
  }
  const pod = await podNamed(name);
  let files;
  try {
    files = pullFiles(pulled, connection.name);
  } catch (error) {
    return shown(200, { failed: `Refused: ${error.message}` });
  }
  if (importing && connection.imported === undefined) {
    connection.imported = pod.import(files, { aboutSubject: true });
    connection.imported.catch(() => (connection.imported = undefined));
  }
  if (connection.imported !== undefined) {
    let done;
    try {
      done = await connection.imported;
    } catch (error) {
      return shown(500, {
        failed: `Not brought in: ${error.message}`,
        retry: true,
      });
    }
    if (done.refused !== undefined)
      return shown(200, { failed: `Refused: ${done.refused}` });
    return redirect(response, `${podPath(name)}?from=${connection.n}`);
  }
  return shown(200, {
    sources: await pod.look(files),
    pulled,
    about: patientName(pulled.bundle),
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
    if (!post && pathname === "/") return await home(response);
    if (post && pathname === "/pods") return await newPod(request, response);
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
    if (name !== undefined && (await podNames()).includes(name)) {
      const [, , isHospitals, n] = at;
      if (isHospitals !== undefined && !post)
        return await findHospital(
          response,
          name,
          url.searchParams.get("q") ?? "",
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
          ),
        );
      }
      if (n !== undefined) {
        const connection = hospitals.connection(name, n);
        if (connection !== undefined)
          return await showConnection(response, name, connection, post);
      }
      if (!post && n === undefined)
        return await showPod(response, name, url.searchParams.get("from"));
    }
    send(response, 404, await page("Not found", "<h1>Not found</h1>"));
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
