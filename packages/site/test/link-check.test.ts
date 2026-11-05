import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const SITE = "https://hub.test/cascade/";
const SCRATCH = mkdtempSync(join(tmpdir(), "link-check-"));

let origin = "";
let close = async (): Promise<void> => {};
const asked: string[] = [];

/** Answers by path: `/gone` is dead, `/flaky` fails once, `/no-head` refuses HEAD, `/readme/<repo>` is that README. */
const READMES = new Map<string, string>();
before(async () => {
  const attempts = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    asked.push(`${request.method ?? ""} ${path}`);
    const readme = /^\/readmes\/([^/]+)\/HEAD\/README\.md$/.exec(path)?.[1];
    if (readme !== undefined) {
      const text = READMES.get(readme);
      response.writeHead(text === undefined ? 404 : 200).end(text);
    } else if (path === "/gone" || path.endsWith("/missing.md")) {
      response.writeHead(404).end();
    } else if (path === "/flaky") {
      const seen = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, seen);
      response.writeHead(seen === 1 ? 503 : 200).end();
    } else if (path === "/no-head" && request.method === "HEAD") {
      response.writeHead(405).end();
    } else {
      response.writeHead(200).end("ok");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
});
after(async () => {
  await close();
  rmSync(SCRATCH, { recursive: true, force: true });
});

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

let counter = 0;
/** The script over a tree of these files and a checkout of these: its exit code and what it said. */
async function check(
  files: Record<string, string>,
  checkout: Record<string, string> = {},
  more: string[] = [],
): Promise<{ code: number; said: string }> {
  const folder = join(SCRATCH, String(counter++));
  write(join(folder, "tree"), files);
  write(join(folder, "checkout"), checkout);
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [
        "scripts/link-check.mjs",
        "--tree",
        join(folder, "tree"),
        "--site",
        SITE,
        "--checkout",
        `jayostis/cascade-vocabulary=${join(folder, "checkout")}`,
        ...more,
      ],
      { cwd: ROOT, env: { ...process.env, LINK_CHECK_BACKOFF_MS: "1" } },
      (error, stdout, stderr) =>
        resolve({
          code: error === null ? 0 : (error.code as number),
          said: stdout + stderr,
        }),
    ),
  );
}

const page = (body: string, title = "A page"): string =>
  `<!DOCTYPE html><html><head><title>${title}</title><link rel="stylesheet" href="site.css"></head><body><h1 id="top-heading">${title}</h1>${body}</body></html>`;

test("a tree whose every link resolves passes: files, folders, anchors, a mailto, an external link that fails once, one that refuses HEAD, an allowlisted host never asked, and a GitHub link into a checkout", async () => {
  const sha = "a".repeat(40);
  const { code, said } = await check(
    {
      "site.css": "body{}",
      "index.html": page(
        [
          `<a href="sub/">folder</a>`,
          `<a href="sub/page.html#there">anchor</a>`,
          `<a href="${SITE}sub/page.html">absolute</a>`,
          `<a href="#top-heading">same page</a>`,
          `<a href="mailto:a@b.test">mail</a>`,
          `<a href="${origin}/flaky">flaky</a>`,
          `<a href="${origin}/no-head">no head</a>`,
          `<a href="https://loinc.org/never-asked-because-allowlisted">loinc</a>`,
          `<a href="https://github.com/jayostis/cascade-vocabulary/blob/main/queries/q.rq">file</a>`,
          `<a href="https://github.com/jayostis/cascade-vocabulary/tree/${sha}/queries/">folder</a>`,
        ].join(""),
      ),
      "sub/index.html": page(`<a href="page.html">p</a>`),
      "sub/page.html": page(`<p id="there">here</p>`),
    },
    { "queries/q.rq": "SELECT * {}" },
  );
  assert.equal(code, 0, said);
  assert.ok(!asked.some((line) => line.includes("never-asked")), said);
});

test("a tree with a dead file, a dead anchor, a dead external link and a GitHub link to a file the checkout lacks fails naming each link and its page, and only those", async () => {
  const { code, said } = await check(
    {
      "site.css": "body{}",
      "index.html": page(
        [
          `<a href="missing.html">dead file</a>`,
          `<a href="sub/page.html#nowhere">dead anchor</a>`,
          `<a href="#no-such-id">dead same-page anchor</a>`,
          `<a href="${origin}/gone">dead external</a>`,
          `<a href="https://github.com/jayostis/cascade-vocabulary/blob/main/queries/gone.rq">dead checkout file</a>`,
          `<a href="sub/page.html#there">fine</a>`,
        ].join(""),
      ),
      "sub/page.html": page(`<p id="there">here</p><img src="gone.png">`),
    },
    { "queries/q.rq": "SELECT * {}" },
  );
  assert.equal(code, 1, said);
  for (const dead of [
    "missing.html",
    "sub/page.html#nowhere",
    "#no-such-id",
    `${origin}/gone`,
    "queries/gone.rq",
    "gone.png",
  ])
    assert.ok(said.includes(dead), `${dead} is not named in:\n${said}`);
  assert.ok(said.includes("index.html"), said);
  assert.ok(said.includes("sub/page.html"), said);
  assert.ok(!said.includes("sub/page.html#there"), said);
});

const HUB = SITE;
const tree = (): Record<string, string> => ({
  "site.css": "",
  "index.html": page(
    `<h2 id="repositories">r</h2><table>${["a", "b", "c", "d", "e"]
      .map(
        (name) =>
          `<tr id="repository-${name}"><td><a href="${origin}/ok">${name}</a></td></tr>`,
      )
      .join("")}</table>`,
  ),
  "terms/index.html": page(`<h2 id="foaf:name">n</h2>`),
});

test("each repository's README must have a Docs block whose first link is the hub and whose links all resolve, and the check names the README that does not", async () => {
  READMES.clear();
  READMES.set(
    "a",
    `# a\n\n## Docs\n\n- [The hub](${HUB}): home\n- [Terms](${HUB}terms/#foaf:name): terms\n- [Elsewhere](${origin}/ok)\n- [Local](docs/guide.md)\n\n## Other\n\n[ignored](${origin}/gone)`,
  );
  READMES.set("b", `# b\n\nno docs block here\n\n[x](${HUB})`);
  READMES.set(
    "c",
    `# c\n\n## Docs\n\n- [Terms first](${HUB}terms/)\n- [The hub](${HUB})`,
  );
  READMES.set(
    "d",
    `# d\n\n## Docs\n\n- [The hub](${HUB})\n- [Dead](${origin}/gone)\n- [Anchor](${HUB}terms/#nope)\n- [Gone](docs/missing.md)`,
  );
  const { code, said } = await check(tree(), {}, [
    "--readmes",
    "--readmes-from",
    `${origin}/readmes/`,
  ]);
  assert.equal(code, 1, said);
  for (const named of [
    "README b: no ## Docs block",
    "README c: the first link in the Docs block is",
    `${origin}/gone`,
    `${HUB}terms/#nope`,
    "docs/missing.md",
    "README e: no README",
  ])
    assert.ok(said.includes(named), `${named} is not in:\n${said}`);
  assert.ok(!said.includes("README a"), said);
});
