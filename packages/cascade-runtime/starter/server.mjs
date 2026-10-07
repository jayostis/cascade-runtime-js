// The app: a page for each pod, showing three of the vocabulary's questions, and pages that bring a record in from a
// hospital. `npm start`, then open the address it prints.
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import process, { env, exit, stdout } from "node:process";
import { URL, URLSearchParams } from "node:url";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import { ConnectionFailure, openPod, pullFiles } from "cascade-runtime";
import { hospitalsAt } from "./hospitals.mjs";
import { NO_POD, podFolder, podNames } from "./pods.mjs";

const QUESTIONS = [
  "pod/My active allergies",
  "entry/What needs review",
  "pod/How many judgments count",
];

function escaped(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaped(title)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
table { border-collapse: collapse; margin-bottom: 2rem; }
th, td { border: 1px solid #ccc; padding: 0.3rem 0.6rem; text-align: left; vertical-align: top; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** A table with a column for every variable any row binds. */
function table(rows) {
  if (rows.length === 0) return "<p>No rows.</p>";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const head = columns.map((column) => `<th>${escaped(column)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td>${escaped(row[column] ?? "")}</td>`).join("")}</tr>`,
    )
    .join("\n");
  return `<table>\n<tr>${head}</tr>\n${body}\n</table>`;
}

async function home(response) {
  const names = await podNames();
  if (names.length === 1) {
    response.writeHead(302, { location: `/pods/${names[0]}/` });
    response.end();
    return;
  }
  const body =
    names.length === 0
      ? `<h1>No pod yet</h1>\n<p>${escaped(NO_POD).replace(/`([^`]*)`/, "<code>$1</code>")}</p>`
      : `<h1>Pods</h1>\n<ul>\n${names.map((name) => `<li><a href="/pods/${escaped(name)}/">${escaped(name)}</a></li>`).join("\n")}\n</ul>`;
  send(response, 200, page("Pods", body));
}

async function podPage(response, name) {
  const pod = await podNamed(name);
  const sections = [];
  for (const question of QUESTIONS)
    sections.push(
      `<h2>${escaped(question)}</h2>\n${table(await pod.ask(question))}`,
    );
  const link = `<p><a href="/pods/${escaped(encodeURIComponent(name))}/hospitals">Bring in a record from a hospital</a></p>`;
  send(
    response,
    200,
    page(name, `<h1>${escaped(name)}</h1>\n${link}\n${sections.join("\n")}`),
  );
}

function send(response, status, html) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function redirect(response, location) {
  response.writeHead(303, { location });
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

/** The directory, searched, each hospital with a button that starts signing in to it. */
function hospitalsPage(response, name, text) {
  const rows = hospitals.directory(text);
  const action = `/pods/${escaped(encodeURIComponent(name))}/hospitals`;
  const list = rows
    .map(
      (row) => `<li>
<form method="post" action="${action}">
<input type="hidden" name="fhirBase" value="${escaped(row.fhirBase)}">
<strong>${escaped(row.name)}</strong>${row.places === undefined ? "" : ` (${escaped(row.places.join("; "))})`}
<button>Sign in</button>
</form>
</li>`,
    )
    .join("\n");
  send(
    response,
    200,
    page(
      "Hospitals",
      `<h1>Bring a record into ${escaped(name)}</h1>
<form method="get" action="${action}"><input name="q" value="${escaped(text)}" aria-label="Search by name or place"> <button>Search</button></form>
${rows.length === 0 ? "<p>No hospital matches.</p>" : `<ul>\n${list}\n</ul>`}
<p><a href="/pods/${escaped(encodeURIComponent(name))}/">Back to ${escaped(name)}</a></p>`,
    ),
  );
}

/** A connection: why it failed, or what its pull holds and a button to bring it in, or what bringing it in did. */
async function connectionPage(response, name, connection, importing) {
  const back = `<p><a href="/pods/${escaped(encodeURIComponent(name))}/">Back to ${escaped(name)}</a></p>`;
  const said = (status, text) =>
    send(
      response,
      status,
      page(
        connection.row.name,
        `<h1>${escaped(connection.row.name)}</h1>\n${text}\n${back}`,
      ),
    );
  let pulled;
  try {
    pulled = await connection.pulled;
  } catch (error) {
    if (!(error instanceof ConnectionFailure)) throw error;
    return said(
      200,
      `<p>Not connected: <code>${escaped(error.kind)}</code>. ${escaped(error.message)}</p>`,
    );
  }
  const pod = await podNamed(name);
  let files;
  try {
    files = pullFiles(pulled, connection.name);
  } catch (error) {
    return said(200, `<p>Refused: ${escaped(error.message)}</p>`);
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
      return said(
        500,
        `<p>Not brought in: ${escaped(error.message)}</p>\n<form method="post"><button>Try again</button></form>`,
      );
    }
    return said(
      200,
      done.refused === undefined
        ? `<p>Brought in: ${done.wrote.length} files written.</p>`
        : `<p>Refused: ${escaped(done.refused)}</p>`,
    );
  }
  const sources = (await pod.look(files))
    .map(
      (source) => `<h2>${escaped(source.name ?? connection.row.name)}</h2>
<p>${source.claimed ? `${escaped(name)} already holds records from here.` : `${escaped(name)} holds no records from here yet.`}</p>
${table(Object.entries(source.records).map(([kind, count]) => ({ kind, count })))}`,
    )
    .join("\n");
  const notes = [
    pulled.missing.length === 0
      ? ""
      : `<p>Referred to, but not served: ${escaped(pulled.missing.join(", "))}</p>`,
    pulled.denied.length === 0
      ? ""
      : `<p>Not allowed to read: ${escaped(pulled.denied.map(({ type, category }) => (category === undefined ? type : `${type} (${category})`)).join(", "))}</p>`,
  ].join("");
  send(
    response,
    200,
    page(
      connection.row.name,
      `<h1>${escaped(connection.row.name)}</h1>
${sources}
${notes}
<form method="post"><button>Bring this record in as ${escaped(name)}'s</button></form>
${back}`,
    ),
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

const demo = await loadHospitals();
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
      return send(response, 405, page("Not allowed", "<h1>Not allowed</h1>"));
    if (post && !ownOrigins.has(request.headers.origin))
      return send(
        response,
        403,
        page("Refused", "<h1>Refused: a form from another site</h1>"),
      );
    if (pathname.startsWith("/demo-hospitals/"))
      return await demoHospitalPage(request, response, url);
    if (!post && pathname === "/") return await home(response);
    if (!post && pathname === "/callback") {
      const back = hospitals.back(url);
      if (back !== undefined) return redirect(response, back);
      return send(
        response,
        400,
        page("Not waiting", "<h1>No sign-in is waiting for this</h1>"),
      );
    }
    const at = /^\/pods\/([^/]+)\/(?:(hospitals)|connections\/(\d+))?$/.exec(
      pathname,
    );
    const name = at === null ? undefined : decodeURIComponent(at[1]);
    if (name !== undefined && (await podNames()).includes(name)) {
      if (at[2] !== undefined && !post)
        return hospitalsPage(response, name, url.searchParams.get("q") ?? "");
      if (at[2] !== undefined) {
        const to = await hospitals.start(
          name,
          (await formOf(request)).get("fhirBase"),
        );
        if (to !== undefined) return redirect(response, to);
        return send(
          response,
          400,
          page("Unknown", "<h1>That hospital is not in the directory</h1>"),
        );
      }
      if (at[3] !== undefined) {
        const connection = hospitals.connection(name, at[3]);
        if (connection !== undefined)
          return await connectionPage(response, name, connection, post);
      }
      if (!post && at[2] === undefined && at[3] === undefined)
        return await podPage(response, name);
    }
    send(response, 404, page("Not found", "<h1>Not found</h1>"));
  } catch (error) {
    send(response, 500, page("Error", `<pre>${escaped(error.message)}</pre>`));
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
