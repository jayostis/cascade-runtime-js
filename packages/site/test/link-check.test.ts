import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
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
/** The deployed site the crawl reads, at `/site/`: a path to its text, or to a status. */
const LIVE = new Map<string, string | number>();
before(async () => {
  const attempts = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    asked.push(`${request.method ?? ""} ${path}`);
    const readme = /^\/readmes\/([^/]+\/[^/]+)\/HEAD\/README\.md$/.exec(
      path,
    )?.[1];
    if (path.startsWith("/site/")) {
      const served = LIVE.get(path.slice("/site/".length));
      if (typeof served === "string") response.writeHead(200).end(served);
      else response.writeHead(served ?? 404).end();
    } else if (readme !== undefined) {
      const text = READMES.get(readme);
      response.writeHead(text === undefined ? 404 : text === "503" ? 503 : 200);
      response.end(text === "503" ? undefined : text);
    } else if (path === "/gone" || path.endsWith("/missing.md")) {
      response.writeHead(404).end();
    } else if (path === "/down") {
      response.writeHead(503).end();
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
/** The script over a tree of these files, in which {SHA} is the commit of a checkout of these, and what it said. */
async function check(
  files: Record<string, string>,
  checkout: Record<string, string> = {},
  more: string[] = [],
  uncommitted: Record<string, string> = {},
): Promise<{ code: number; said: string }> {
  const folder = join(SCRATCH, String(counter++));
  mkdirSync(join(folder, "checkout"), { recursive: true });
  write(join(folder, "checkout"), checkout);
  const git = (...args: string[]): string =>
    execFileSync(
      "git",
      [
        "-C",
        join(folder, "checkout"),
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t.test",
        ...args,
      ],
      { encoding: "utf8" },
    ).trim();
  git("init", "--quiet");
  git("add", "-A");
  git("commit", "--quiet", "--allow-empty", "-m", "c");
  const sha = git("rev-parse", "HEAD");
  write(join(folder, "checkout"), uncommitted);
  write(
    join(folder, "tree"),
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [
        path,
        text.replaceAll("{SHA}", sha),
      ]),
    ),
  );
  return run([
    "--tree",
    join(folder, "tree"),
    "--site",
    SITE,
    "--checkout",
    `jayostis/cascade-vocabulary=${join(folder, "checkout")}`,
    ...more,
  ]);
}

function run(args: string[]): Promise<{ code: number; said: string }> {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      ["scripts/link-check.mjs", ...args],
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
  `<!DOCTYPE html><html><head><title>${title}</title><link rel="stylesheet" href="${SITE}site.css"></head><body><h1 id="top-heading">${title}</h1>${body}</body></html>`;

test("a tree whose every link resolves passes: files, folders, anchors, a mailto, an external link that fails once, one that refuses HEAD, one whose host stays down (a warning, not a dead link), an allowlisted host never asked, and a GitHub link into a checkout", async () => {
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
          `<a href="${origin}/down">down</a>`,
          `<a href="https://loinc.org/never-asked-because-allowlisted">loinc</a>`,
          `<a href="https://github.com/jayostis/cascade-vocabulary/blob/main/queries/q.rq">file</a>`,
          `<a href="https://github.com/jayostis/cascade-vocabulary/tree/{SHA}/queries/">folder</a>`,
        ].join(""),
      ),
      "sub/index.html": page(`<a href="page.html">p</a>`),
      "sub/page.html": page(`<p id="there">here</p>`),
    },
    { "queries/q.rq": "SELECT * {}" },
  );
  assert.equal(code, 0, said);
  assert.ok(!asked.some((line) => line.includes("never-asked")), said);
  assert.ok(said.includes(`WARN`) && said.includes(`${origin}/down`), said);
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
  assert.ok(said.includes("not in the checkout"), said);
  assert.ok(said.includes("index.html"), said);
  assert.ok(said.includes("sub/page.html"), said);
  assert.ok(!said.includes("sub/page.html#there"), said);
});

const HUB = SITE;
const tree = (): Record<string, string> => ({
  "site.css": "",
  "index.html": page(
    `<h2 id="repositories">r</h2><table>${["a", "b", "c", "d", "e", "f"]
      .map(
        (name) =>
          `<tr id="repository-${name}"><td><a href="${origin}/${name === "a" ? "someone-else" : "jayostis"}/${name}">${name}</a></td></tr>`,
      )
      .join("")}</table>`,
  ),
  "terms/index.html": page(`<h2 id="foaf:name">n</h2>`),
});

test("each repository's README must have a Docs block whose first link is the hub and whose links all resolve, and the check names the README that does not", async () => {
  READMES.clear();
  READMES.set("jayostis/f", "503");
  READMES.set(
    "someone-else/a",
    `# a\n\n## Docs\n\n- [The hub](${HUB}): home\n- [Terms](${HUB}terms/#foaf:name): terms\n- [Elsewhere](${origin}/ok)\n- [Local](docs/guide.md)\n\n## Other\n\n[ignored](${origin}/gone)`,
  );
  READMES.set("jayostis/b", `# b\n\nno docs block here\n\n[x](${HUB})`);
  READMES.set(
    "jayostis/c",
    `# c\n\n## Docs\n\n- [Terms first](${HUB}terms/)\n- [The hub](${HUB})`,
  );
  READMES.set(
    "jayostis/d",
    `# d\n\n## Docs\n\n- [The hub](${HUB})\n- [Dead](${origin}/gone)\n- [Anchor](${HUB}terms/#nope)\n- [Gone](docs/missing.md)\n\n### More\n\n- [Deeper](deeper/missing.md)\n\n## Other`,
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
    "deeper/missing.md",
    "README e: no README",
    "WARN README f: ",
  ])
    assert.ok(said.includes(named), `${named} is not in:\n${said}`);
  assert.ok(!said.includes("README a"), said);
  assert.ok(!said.includes("FAIL README f"), said);
});

test("the external addresses a check leaves unasked can be saved and asked later on their own, and the second run fails on the dead one naming the page that holds it", async () => {
  const saved = join(SCRATCH, "saved-external.json");
  const files = {
    "index.html": page(
      `<a href="${origin}/gone">dead</a><a href="${origin}/ok">fine</a><a href="sub.html">in</a>`,
    ),
    "sub.html": page(""),
    "site.css": "",
  };
  const first = await check(files, {}, [
    "--no-external",
    "--save-external",
    saved,
  ]);
  assert.equal(first.code, 0, first.said);
  const second = await check({}, {}, ["--only-external", saved]);
  assert.equal(second.code, 1, second.said);
  assert.ok(
    second.said.includes(`index.html: ${origin}/gone`) &&
      !second.said.includes(`${origin}/ok`) &&
      !second.said.includes("sub.html"),
    second.said,
  );
});

test("a GitHub link into a checkout at its HEAD is checked in git: a file that is only on disk, untracked, is not there", async () => {
  const { code, said } = await check(
    {
      "site.css": "",
      "index.html": page(
        [
          `<a href="https://github.com/jayostis/cascade-vocabulary/blob/main/queries/q.rq">tracked</a>`,
          `<a href="https://github.com/jayostis/cascade-vocabulary/blob/main/queries/local.rq">untracked</a>`,
          `<a href="https://github.com/jayostis/cascade-vocabulary/tree/{SHA}/queries/">folder</a>`,
        ].join(""),
      ),
    },
    { "queries/q.rq": "SELECT * {}" },
    [],
    { "queries/local.rq": "SELECT * {}" },
  );
  assert.equal(code, 1, said);
  assert.ok(said.includes("queries/local.rq"), said);
  assert.ok(!said.includes("queries/q.rq"), said);
});

test("an anchor counts ids and the names of anchors, not the name of a meta tag", async () => {
  const { code, said } = await check({
    "site.css": "",
    "index.html": page(
      `<meta name="viewport" content="x"><a name="old-anchor"></a><a href="#old-anchor">fine</a><a href="#viewport">dead</a>`,
    ),
  });
  assert.equal(code, 1, said);
  assert.ok(said.includes("#viewport") && !said.includes("#old-anchor"), said);
});

test("the .txt and .md files a site serves are checked too, their links resolved against their own address: markdown links and bare URLs", async () => {
  const { code, said } = await check({
    "site.css": "",
    "index.html": page(""),
    "llms.txt": `# Hub\n\n- [Fine](index.html): ok\n- [Dead](missing-page.html): gone\n\nSee ${origin}/gone for more.`,
    "docs/AGENTS.md": `[Up](../index.html) [Sibling](nope.md)`,
  });
  assert.equal(code, 1, said);
  for (const dead of ["missing-page.html", `${origin}/gone`, "nope.md"])
    assert.ok(said.includes(dead), `${dead} is not named in:\n${said}`);
  assert.ok(
    !said.includes("-> 404: https://hub.test/cascade/index.html"),
    said,
  );
  assert.ok(said.includes("llms.txt") && said.includes("docs/AGENTS.md"), said);
});

const live = (body: string): string =>
  `<!DOCTYPE html><html><body>${body}</body></html>`;

test("the crawl follows links from the front page to pages of the site, however deep, and fails on a dead link there", async () => {
  LIVE.clear();
  const site = `${origin}/site/`;
  LIVE.set("", live(`<a href="${site}a.html">a</a>`));
  LIVE.set("a.html", live(`<a href="b.html">b</a><a href="notes.txt">n</a>`));
  LIVE.set("b.html", live(`<a href="dead.html">dead</a>`));
  LIVE.set("notes.txt", `[gone](${site}dead-from-text.html)`);
  const { code, said } = await run(["--crawl", "--site", site]);
  assert.equal(code, 1, said);
  assert.ok(said.includes("b.html") && said.includes("dead.html"), said);
  assert.ok(said.includes("dead-from-text.html"), said);
  assert.ok(said.includes("4 pages"), said);
});

test("a page of the live site that answers 5xx is a warning, and 404 is a dead link", async () => {
  LIVE.clear();
  const site = `${origin}/site/`;
  LIVE.set("", live(`<a href="down.html">down</a>`));
  LIVE.set("down.html", 503);
  const down = await run(["--crawl", "--site", site, "--no-external"]);
  assert.equal(down.code, 0, down.said);
  assert.ok(
    down.said.includes("WARN") && down.said.includes("down.html"),
    down.said,
  );
  LIVE.set("", live(`<a href="gone.html">gone</a>`));
  const gone = await run(["--crawl", "--site", site, "--no-external"]);
  assert.equal(gone.code, 1, gone.said);
});
