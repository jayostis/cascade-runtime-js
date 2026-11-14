import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const SITE = "https://hub.test/cascade/";
const SCRATCH = mkdtempSync(join(tmpdir(), "link-check-"));
const GITHUB = "https://github.com/jayostis/cascade-vocabulary";

let origin = "";
let close = async (): Promise<void> => {};
const asked: string[] = [];

/** Answers by path: `/gone` is dead, `/flaky` fails its first two requests, `/no-head` refuses HEAD, `/readme/<repo>` is that README. */
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
      response.writeHead(seen <= 2 ? 503 : 200).end();
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

interface Checked {
  readonly code: number;
  readonly said: string;
  /** The commit of the checkout `{SHA}` stood for. */
  readonly sha: string;
}

let counter = 0;
/** The script over a tree of these files, in which {SHA} is the commit of a checkout of these, and what it said. */
async function check(
  files: Record<string, string>,
  checkout: Record<string, string> = {},
  more: string[] = [],
  uncommitted: Record<string, string> = {},
): Promise<Checked> {
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
  return {
    ...(await run([
      "--tree",
      join(folder, "tree"),
      "--site",
      SITE,
      "--checkout",
      `jayostis/cascade-vocabulary=${join(folder, "checkout")}`,
      ...more,
    ])),
    sha,
  };
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

/** A page of the hub that has no link back to the front page. */
const bare = (body: string, title = "A page"): string =>
  `<!DOCTYPE html><html><head><title>${title}</title><link rel="stylesheet" href="${SITE}site.css"></head><body><h1 id="top-heading">${title}</h1>${body}</body></html>`;
const page = (body: string, title = "A page"): string =>
  bare(`<nav><a href="${SITE}">Cascade Protocol reference</a></nav>${body}`, title);

const HUB = SITE;
const tree = (): Record<string, string> => ({
  "site.css": "",
  "index.html": page(
    `<h2 id="repositories">r</h2><table>${["a", "b", "c", "d", "e", "f", "g"]
      .map(
        (name) =>
          `<tr id="repository-${name}"><td><a href="${origin}/${name === "a" ? "someone-else" : "jayostis"}/${name}">${name}</a></td></tr>`,
      )
      .join("")}</table>`,
  ),
  "terms/index.html": page(`<h2 id="foaf:name">n</h2>`),
});

const live = (body: string): string =>
  `<!DOCTYPE html><html><body><a href="${origin}/site/">Cascade Protocol reference</a>${body}</body></html>`;

/** The lines the script asked of the server for `path`, in order. */
const askedOf = (path: string): string[] =>
  asked.filter((line) => line.endsWith(` ${path}`));

/**
 * `node scripts/link-check.mjs` follows every link of a built or published site: to a file, an anchor, another site, or a
 * file of a repository on GitHub. It exits 1 naming each dead link and the page that holds it, so that a change
 * cannot publish one. Each level runs the script once, over its own site, and its tests read what it said.
 */
describe("Checking a site's links · scripts/link-check.mjs", () => {
  describe("with a built site whose every link resolves", () => {
    let result: Checked;

    before(async () => {
      result = await check({
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
          ].join(""),
        ),
        "sub/index.html": page(`<a href="page.html">p</a>`),
        "sub/page.html": page(`<p id="there">here</p>`),
      });
    });

    it("exits 0", () => {
      assert.equal(result.code, 0, result.said);
    });

    it("asks with GET an address that refuses HEAD", () => {
      const asks = askedOf("/no-head");
      assert.ok(asks.includes("HEAD /no-head"), asks.join());
      assert.ok(
        asks.indexOf("GET /no-head") > asks.indexOf("HEAD /no-head"),
        asks.join(),
      );
    });

    it("asks again an address whose host fails at first", () => {
      // It fails its first two requests: HEAD and the GET after it. A third is the retry.
      assert.ok(askedOf("/flaky").length >= 3, askedOf("/flaky").join());
      assert.ok(!result.said.includes("/flaky"), result.said);
    });

    it("warns about a host that stays down, and does not fail", () => {
      assert.ok(result.said.includes("WARN"), result.said);
      assert.ok(result.said.includes(`${origin}/down`), result.said);
    });

    it("never asks a host it is told to skip by name", () => {
      assert.ok(
        result.said.includes("1 allowlisted host (loinc.org) not asked"),
        result.said,
      );
    });
  });

  describe("with dead links", () => {
    let result: Checked;

    before(async () => {
      result = await check({
        "site.css": "body{}",
        "index.html": page(
          [
            `<a href="missing.html">dead file</a>`,
            `<a href="sub/page.html#nowhere">dead anchor</a>`,
            `<a href="#no-such-id">dead same-page anchor</a>`,
            `<a href="${origin}/gone">dead external</a>`,
            `<a href="sub/page.html#there">fine</a>`,
          ].join(""),
        ),
        "sub/page.html": page(`<p id="there">here</p><img src="gone.png">`),
      });
    });

    it("exits 1", () => {
      assert.equal(result.code, 1, result.said);
    });

    it("names each dead file, anchor, image and outside address", () => {
      for (const dead of [
        "missing.html",
        "sub/page.html#nowhere",
        "#no-such-id",
        `${origin}/gone`,
        "gone.png",
      ])
        assert.ok(
          result.said.includes(dead),
          `${dead} is not named in:\n${result.said}`,
        );
    });

    it("names the page that holds each", () => {
      for (const [dead, holder] of [
        ["missing.html", "index.html"],
        ["sub/page.html#nowhere", "index.html"],
        ["#no-such-id", "index.html"],
        [`${origin}/gone`, "index.html"],
        ["gone.png", "sub/page.html"],
      ] as const)
        assert.ok(
          result.said
            .split("\n")
            .some((one) => one.includes(dead) && one.includes(holder)),
          `${dead} is not named with ${holder} in:\n${result.said}`,
        );
    });

    it("leaves a link that resolves unnamed", () => {
      assert.ok(!result.said.includes("sub/page.html#there"), result.said);
    });
  });

  describe("with a GitHub link into a repository given as `--checkout`", () => {
    let result: Checked;

    before(async () => {
      result = await check(
        {
          "site.css": "",
          "index.html": page(
            [
              `<a href="${GITHUB}/blob/main/queries/q.rq">tracked</a>`,
              `<a href="${GITHUB}/tree/{SHA}/queries/">folder</a>`,
              `<a href="${GITHUB}/blob/main/queries/gone.rq">not at that commit</a>`,
              `<a href="${GITHUB}/blob/main/queries/local.rq">untracked</a>`,
            ].join(""),
          ),
        },
        { "queries/q.rq": "SELECT * {}" },
        [],
        { "queries/local.rq": "SELECT * {}" },
      );
    });

    it("accepts a file and a folder the checkout's commit holds", () => {
      assert.ok(!result.said.includes("queries/q.rq"), result.said);
      assert.ok(!result.said.includes(`tree/${result.sha}`), result.said);
    });

    it("names a file the commit lacks as not in the checkout", () => {
      const line = result.said
        .split("\n")
        .find((one) => one.includes("queries/gone.rq"));
      assert.ok(line?.includes("not in the checkout"), result.said);
    });

    it("names a file that is on disk but not in git", () => {
      assert.equal(result.code, 1, result.said);
      assert.ok(result.said.includes("queries/local.rq"), result.said);
    });
  });

  describe("with an anchor", () => {
    let result: Checked;

    before(async () => {
      result = await check({
        "site.css": "",
        "index.html": page(
          `<meta name="viewport" content="x"><a name="old-anchor"></a><a href="#old-anchor">fine</a><a href="#viewport">dead</a>`,
        ),
      });
    });

    it("accepts an `id` and the `name` of an `<a>`", () => {
      assert.ok(!result.said.includes("#old-anchor"), result.said);
    });

    it("names a link to the `name` of a `<meta>` tag as dead", () => {
      assert.equal(result.code, 1, result.said);
      assert.ok(result.said.includes("#viewport"), result.said);
    });
  });

  describe("with a page that links no way back to the front page", () => {
    let result: Checked;
    let failed: string[];

    before(async () => {
      result = await check({
        "site.css": "",
        "index.html": bare(`<a href="a.html">a</a>`),
        "a.html": bare(`<a href="sub/e.html">e</a>`),
        "sub/b.html": bare(`<a href="../index.html">front</a>`),
        "sub/c.html": bare(`<a href="../#top-heading">front</a>`),
        "sub/d.html": bare(`<a href="${SITE}index.html#top-heading">front</a>`),
        "sub/e.html": bare(`<a href="../sub/">not the front</a>`),
        "sub/index.html": bare(`<a href="${SITE}">front</a>`),
        "terms/index.html": bare(""),
        "llms.txt": "a text file needs no link",
      });
      failed = result.said
        .split("\n")
        .filter((line) => line.startsWith("FAIL"));
    });

    it("exits 1, naming every such page on one line", () => {
      assert.equal(result.code, 1, result.said);
      assert.deepEqual(failed, [
        "FAIL a.html, sub/e.html, terms/index.html: links no way back to the front page",
      ]);
    });

    it("accepts a link to the front page as a folder or `index.html`, relative or absolute, with a fragment", () => {
      for (const path of [
        "sub/b.html",
        "sub/c.html",
        "sub/d.html",
        "sub/index.html",
      ])
        assert.ok(!failed.join().includes(path), path);
    });

    it("asks no such link of a text file", () => {
      assert.ok(!failed.join().includes("llms.txt"));
    });
  });

  describe("with the `.txt` and `.md` files a site serves", () => {
    let result: Checked;

    before(async () => {
      result = await check({
        "site.css": "",
        "index.html": page(""),
        "llms.txt": `# Hub\n\n- [Fine](index.html): ok\n- [Dead](missing-page.html): gone\n\nSee ${origin}/gone for more.`,
        "docs/AGENTS.md": `[Up](../index.html) [Sibling](nope.md)\n\nIn a span \`${origin}/in-span/missing.md\` and\n\n\`\`\`\n${origin}/in-fence/missing.md\n\`\`\`\n`,
      });
    });

    it("names a dead Markdown link and a dead bare address, each resolved against its own file", () => {
      assert.equal(result.code, 1, result.said);
      for (const dead of ["missing-page.html", `${origin}/gone`, "nope.md"])
        assert.ok(
          result.said.includes(dead),
          `${dead} is not named in:\n${result.said}`,
        );
      assert.ok(result.said.includes("llms.txt"), result.said);
      assert.ok(result.said.includes("docs/AGENTS.md"), result.said);
      assert.ok(
        !result.said.includes("-> 404: https://hub.test/cascade/index.html"),
        result.said,
      );
    });

    it("skips an address written in a code span or a fenced block", () => {
      assert.ok(!result.said.includes("in-span/missing.md"), result.said);
      assert.ok(!result.said.includes("in-fence/missing.md"), result.said);
    });
  });

  describe("with `--readmes`", () => {
    let result: Checked;

    before(async () => {
      READMES.clear();
      READMES.set("jayostis/f", "503");
      READMES.set(
        "someone-else/a",
        `# a\n\n## Docs\n\n- [The hub](${HUB}): home\n- [Terms](${HUB}terms/#foaf:name): terms\n- [Elsewhere](${origin}/ok)\n- [Local](docs/guide.md)\n\n## Other\n\n[ignored](${origin}/gone)`,
      );
      READMES.set("jayostis/b", `# b\n\nno docs block here\n\n[x](${HUB})`);
      READMES.set(
        "jayostis/g",
        `# g\n\nintro\n\n\`\`\`\n## Docs in a fence\n\`\`\`\n\n## What it is\n\n## Docs\n\n- [The hub](${HUB})`,
      );
      READMES.set(
        "jayostis/c",
        `# c\n\n## Docs\n\n- [Terms first](${HUB}terms/)\n- [The hub](${HUB})`,
      );
      READMES.set(
        "jayostis/d",
        `# d\n\n## Docs\n\n- [The hub](${HUB})\n- [Dead](${origin}/gone)\n- [Anchor](${HUB}terms/#nope)\n- [Gone](docs/missing.md)\n\n### More\n\n- [Deeper](deeper/missing.md)\n\n## Other`,
      );
      result = await check(tree(), {}, [
        "--readmes",
        "--readmes-from",
        `${origin}/readmes/`,
      ]);
    });

    it("accepts a README whose Docs block opens with the front page and whose links resolve", () => {
      // The owner of README a is read from the row's link: `someone-else`. Its link outside the block is dead and is not read.
      assert.equal(result.code, 1, result.said);
      assert.ok(!result.said.includes("README a"), result.said);
    });

    it("names a README with no Docs block", () => {
      assert.ok(result.said.includes("README b: no ## Docs block"));
    });

    it("names a README whose Docs block is not its first `##` section", () => {
      // A `## Docs` inside a fence is no heading.
      assert.ok(
        result.said.includes(
          'README g: the ## Docs block is not the first ## section of the README: "What it is" comes before it',
        ),
        result.said,
      );
    });

    it("names a README whose first Docs link is not the front page", () => {
      assert.ok(
        result.said.includes("README c: the first link in the Docs block is"),
        result.said,
      );
    });

    it("names each dead link of a Docs block, those under its sub-headings too", () => {
      for (const dead of [
        `${origin}/gone`,
        `${HUB}terms/#nope`,
        "docs/missing.md",
        "deeper/missing.md",
      ])
        assert.ok(
          result.said.includes(dead),
          `${dead} is not named in:\n${result.said}`,
        );
    });

    it("names a repository with no README", () => {
      assert.ok(result.said.includes("README e: no README"), result.said);
    });

    it("warns about a README its host fails to serve, and does not fail for it", () => {
      assert.ok(result.said.includes("WARN README f: "), result.said);
      assert.ok(!result.said.includes("FAIL README f"), result.said);
    });
  });

  describe("with `--no-external --save-external`, then `--only-external`", () => {
    let first: Checked;
    let second: Checked;
    let askedBySecond = 0;
    let unaskedByFirst = 0;

    before(async () => {
      const saved = join(SCRATCH, "saved-external.json");
      const before = askedOf("/gone").length + askedOf("/ok").length;
      first = await check(
        {
          "index.html": page(
            `<link rel="preconnect" href="${origin}/preconnected"><link rel="dns-prefetch" href="${origin}/prefetched"><a href="${origin}/gone">dead</a><a href="${origin}/ok">fine</a><a href="sub.html">in</a>`,
          ),
          "sub.html": page(""),
          "site.css": "",
        },
        {},
        ["--no-external", "--save-external", saved],
      );
      unaskedByFirst = askedOf("/gone").length + askedOf("/ok").length - before;
      askedBySecond = askedOf("/gone").length;
      second = await check({}, {}, ["--only-external", saved]);
      askedBySecond = askedOf("/gone").length - askedBySecond;
    });

    it("exits 0 at first, with the addresses of other sites unasked", () => {
      assert.equal(first.code, 0, first.said);
      assert.equal(unaskedByFirst, 0);
    });

    it("exits 1 when they are asked, naming the dead one and the page that held it", () => {
      assert.equal(second.code, 1, second.said);
      assert.ok(askedBySecond > 0, "the second run asked the dead address");
      assert.ok(
        second.said.includes(`index.html: ${origin}/gone`),
        second.said,
      );
      assert.ok(!second.said.includes(`${origin}/ok`), second.said);
      assert.ok(!second.said.includes("sub.html"), second.said);
    });

    it("leaves a preconnect and a dns-prefetch hint unasked, since each names an origin", () => {
      assert.equal(askedOf("/preconnected").length, 0);
      assert.equal(askedOf("/prefetched").length, 0);
      assert.ok(!second.said.includes("/preconnected"), second.said);
    });
  });

  describe("with `--crawl`, over a published site", () => {
    const site = () => `${origin}/site/`;
    let followed: { code: number; said: string };
    let external: { code: number; said: string };
    let down: { code: number; said: string };
    let gone: { code: number; said: string };

    before(async () => {
      LIVE.clear();
      LIVE.set("", live(`<a href="${site()}a.html">a</a>`));
      LIVE.set(
        "a.html",
        live(`<a href="b.html">b</a><a href="notes.txt">n</a>`),
      );
      LIVE.set("b.html", live(`<a href="dead.html">dead</a>`));
      LIVE.set("notes.txt", `[gone](${site()}dead-from-text.html)`);
      followed = await run(["--crawl", "--site", site()]);

      LIVE.clear();
      LIVE.set("", live(`<a href="${origin}/down">elsewhere</a>`));
      external = await run(["--crawl", "--site", site()]);

      LIVE.set("", live(`<a href="down.html">down</a>`));
      LIVE.set("down.html", 503);
      down = await run(["--crawl", "--site", site(), "--no-external"]);

      LIVE.set("", live(`<a href="gone.html">gone</a>`));
      LIVE.delete("down.html");
      gone = await run(["--crawl", "--site", site(), "--no-external"]);
    });

    it("follows links from the front page to every page of the site, and counts them", () => {
      assert.ok(followed.said.includes("4 pages"), followed.said);
    });

    it("names a dead link in a page and in a text file", () => {
      assert.equal(followed.code, 1, followed.said);
      assert.ok(
        followed.said.includes("b.html") && followed.said.includes("dead.html"),
        followed.said,
      );
      assert.ok(followed.said.includes("dead-from-text.html"), followed.said);
    });

    it("names a page of the site that answers 503 or 404", () => {
      assert.equal(down.code, 1, down.said);
      assert.ok(
        down.said.includes("FAIL") && down.said.includes("down.html"),
        down.said,
      );
      assert.equal(gone.code, 1, gone.said);
      assert.ok(gone.said.includes("gone.html"), gone.said);
    });

    it("warns about another site's address that answers 503, and does not fail", () => {
      assert.equal(external.code, 0, external.said);
      assert.ok(external.said.includes("WARN"), external.said);
    });
  });
});
