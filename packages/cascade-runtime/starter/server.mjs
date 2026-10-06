// The app: a page for each pod, showing three of the vocabulary's questions. `npm start`, then open the address it prints.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import process, { env, exit, stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { openPod } from "cascade-runtime";
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

const notice = readFileSync(
  fileURLToPath(
    new URL("../../PREVIEW.md", import.meta.resolve("cascade-runtime")),
  ),
  "utf8",
)
  .trim()
  .split(/\r?\n/)
  .map((line) => `<p>${escaped(line)}</p>`)
  .join("\n");

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
.notice { border-left: 4px solid #c60; padding: 0 1rem; color: #555; }
table { border-collapse: collapse; margin-bottom: 2rem; }
th, td { border: 1px solid #ccc; padding: 0.3rem 0.6rem; text-align: left; vertical-align: top; }
</style>
</head>
<body>
<div class="notice">${notice}</div>
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
  send(
    response,
    200,
    page(name, `<h1>${escaped(name)}</h1>\n${sections.join("\n")}`),
  );
}

function send(response, status, html) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, "http://127.0.0.1");
    const pod = /^\/pods\/([^/]+)\/$/.exec(pathname);
    if (request.method === "GET" && pathname === "/")
      return await home(response);
    if (request.method === "GET" && pod !== null) {
      const name = decodeURIComponent(pod[1]);
      if ((await podNames()).includes(name))
        return await podPage(response, name);
    }
    send(response, 404, page("Not found", "<h1>Not found</h1>"));
  } catch (error) {
    send(response, 500, page("Error", `<pre>${escaped(error.message)}</pre>`));
  }
});

server.listen(Number(env.PORT || 3000), "127.0.0.1", () => {
  stdout.write(`http://127.0.0.1:${server.address().port}/\n`);
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
