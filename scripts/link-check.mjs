// Checks every href and src of the hub's pages, and each repository's README Docs block.
//
//   node scripts/link-check.mjs --tree <folder> --site <url> [options]    the built tree, as served at <url>
//   node scripts/link-check.mjs --crawl --site <url> [options]            the deployed site, from its front page
//
//   --checkout <owner/repo>=<folder>  a GitHub blob/tree link into this repository is checked in the folder, at the
//                                     commit it names when the folder is at that commit; repeatable
//   --no-external                     leave every address outside the site and the checkouts unasked
//   --readmes                         also read the README of each repository the front page lists
//   --readmes-from <url>              where READMEs are read: <url><repository>/<ref>/README.md
//   --readme-ref <repository>=<ref>   read that repository's README at this ref, not HEAD; repeatable
//
// Exits 1 when a link does not resolve, naming it and the page it is on.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

/** Hosts asked nothing, each with why: a host that refuses automated requests answers a dead link and a live one alike. */
const ALLOWED = new Map([
  ["loinc.org", "403 to bots"],
  ["snomed.info", "refuses automated requests"],
]);

/** Addresses known dead and not ours to fix here, each with the issue that tracks it; an entry goes when its issue closes. */
const KNOWN_DEAD = new Map([]);

const HUB = "https://jayostis.github.io/cascade-runtime-js/";
const RAW = "https://raw.githubusercontent.com/jayostis/";
const BACKOFF = Number(process.env["LINK_CHECK_BACKOFF_MS"] ?? 1000);
const ATTEMPTS = 4;
const TIMEOUT = 20_000;
const HEADERS = { "user-agent": "cascade-link-check (+" + HUB + ")" };
const SKIPPED = /^(?:mailto|tel|data|javascript|blob):/i;
/** Errors that say the address is gone or its host cannot be trusted, as opposed to a host that is slow or down. */
const GONE = new Set([
  "ENOTFOUND",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const HTML = /(?:\/|\.html?)$/;

function options(argv) {
  const found = { checkout: [], ref: new Map(), readmesFrom: RAW, site: HUB };
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    const value = () => {
      at += 1;
      if (argv[at] === undefined) throw new Error(`${flag} needs a value`);
      return argv[at];
    };
    if (flag === "--tree") found.tree = value();
    else if (flag === "--site") found.site = value();
    else if (flag === "--crawl") found.crawl = true;
    else if (flag === "--checkout") found.checkout.push(value());
    else if (flag === "--no-external") found.noExternal = true;
    else if (flag === "--readmes") found.readmes = true;
    else if (flag === "--readmes-from") found.readmesFrom = value();
    else if (flag === "--readme-ref") {
      const [name, ref] = value().split("=");
      found.ref.set(name, ref);
    } else throw new Error(`unknown option ${flag}`);
  }
  if ((found.tree === undefined) === (found.crawl === undefined))
    throw new Error("give --tree <folder> or --crawl, one of them");
  found.site = found.site.replace(/\/?$/, "/");
  found.readmesFrom = found.readmesFrom.replace(/\/?$/, "/");
  return found;
}

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const unescaped = (text) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/** The addresses a page's href and src attributes hold, as written. */
const linksOf = (html) =>
  [...html.matchAll(/\s(?:href|src)=(?:"([^"]*)"|'([^']*)')/g)].map(
    ([, a, b]) => unescaped(a ?? b ?? ""),
  );

const idsOf = (html) =>
  new Set(
    [...html.matchAll(/\s(?:id|name)=(?:"([^"]*)"|'([^']*)')/g)].map(
      ([, a, b]) => unescaped(a ?? b ?? ""),
    ),
  );

/** At most `size` of the tasks run at once. */
function limiter(size) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= size || waiting.length === 0) return;
    running += 1;
    waiting.shift()();
  };
  return async (task) => {
    await new Promise((resolve) => {
      waiting.push(resolve);
      next();
    });
    try {
      return await task();
    } finally {
      running -= 1;
      next();
    }
  };
}

/** Each distinct key once: the answer is kept whole, a promise, so concurrent askers share one request. */
function once() {
  const kept = new Map();
  return (key, ask) => {
    if (!kept.has(key)) kept.set(key, ask());
    return kept.get(key);
  };
}

const settings = options(process.argv.slice(2));
const failures = [];
/** Addresses that did not answer, with no word from the host that they are gone: a down host is no dead link. */
const unverified = [];
const fail = (where, link, why) => failures.push({ where, link, why });

const counts = {
  pages: 0,
  internal: 0,
  external: new Set(),
  checkout: 0,
  allowed: new Set(),
  known: new Set(),
};

// ---- the site itself: the built tree, or the deployed pages
const loaded = once();

/** A page or file of the site by its address without a fragment: its status, and for a page its text and ids. */
function load(url) {
  return loaded(url, async () => {
    const path = decoded(url.slice(settings.site.length)).replace(/[?].*$/, "");
    const html = HTML.test(path) || path === "";
    if (settings.tree !== undefined) {
      let file = join(settings.tree, path);
      if (path === "" || path.endsWith("/")) file = join(file, "index.html");
      else if (existsSync(file) && statSync(file).isDirectory())
        file = join(file, "index.html");
      if (!existsSync(file) || !statSync(file).isFile()) return { status: 404 };
      if (!html && !file.endsWith(".html")) return { status: 200 };
      const text = readFileSync(file, "utf8");
      return { status: 200, text, ids: idsOf(text) };
    }
    const response = await ask(url, html ? "GET" : "HEAD");
    if (response.status === undefined || response.status >= 400 || !html)
      return response;
    return { ...response, ids: idsOf(response.text) };
  });
}

const insideSite = (url) => url.startsWith(settings.site);

/** Checks a link that is the site's own: the file is there and, with a fragment, the page holds the id. */
async function checkInternal(url, hash, where, written) {
  counts.internal += 1;
  const found = await load(url);
  if (found.status !== 200)
    return fail(
      where,
      written,
      `${found.status ?? found.error}: ${url} is not on the site`,
    );
  if (hash === "" || hash === "top" || found.ids === undefined) return;
  if (!found.ids.has(decoded(hash)))
    fail(where, written, `no element with id "${hash}" on ${url}`);
}

// ---- the world
const hostLimit = new Map();
const globalLimit = limiter(32);
const asked = once();

/** One request, the status it got or the error that kept it from one; a page's text with it when the method is GET. */
async function ask(url, method = "HEAD") {
  const host = new URL(url).host;
  if (!hostLimit.has(host))
    hostLimit.set(
      host,
      limiter(
        host === new URL(settings.site).host
          ? 16
          : host === "github.com"
            ? 6
            : 4,
      ),
    );
  return hostLimit.get(host)(() =>
    globalLimit(async () => {
      let last;
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        try {
          let response = await fetch(url, {
            method,
            redirect: "follow",
            headers: HEADERS,
            signal: AbortSignal.timeout(TIMEOUT),
          });
          if (method === "HEAD" && response.status >= 400) {
            await response.body?.cancel();
            response = await fetch(url, {
              redirect: "follow",
              headers: HEADERS,
              signal: AbortSignal.timeout(TIMEOUT),
            });
          }
          const text =
            method === "GET"
              ? await response.text()
              : (await response.body?.cancel(), "");
          last = { status: response.status, text };
          if (response.status !== 429 && response.status < 500) return last;
        } catch (error) {
          const cause = error?.cause?.code ?? error?.name ?? String(error);
          last = { error: cause };
          if (cause === "ENOTFOUND") return last;
        }
        if (attempt + 1 < ATTEMPTS) await sleep(BACKOFF * 2 ** attempt);
      }
      return last;
    }),
  );
}

const checkouts = new Map(
  settings.checkout.map((entry) => {
    const [name, folder] = entry.split("=");
    return [name, { folder, head: undefined }];
  }),
);

function headOf(checkout) {
  checkout.head ??= execFileSync(
    "git",
    ["-C", checkout.folder, "rev-parse", "HEAD"],
    {
      encoding: "utf8",
    },
  ).trim();
  return checkout.head;
}

/** A GitHub blob or tree link into a repository a checkout holds: undefined when the checkout cannot say. */
const checked = new Map();
function inCheckout(url) {
  if (!checked.has(url)) checked.set(url, inCheckoutUncached(url));
  return checked.get(url);
}

function inCheckoutUncached(url) {
  const match =
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(blob|tree)\/([^/]+)\/?([^?#]*)/.exec(
      url,
    );
  const checkout = match && checkouts.get(match[1]);
  if (!checkout) return undefined;
  const [, , kind, ref, raw] = match;
  // A branch name may hold a slash, so where the ref ends is known only for a commit and the default branch.
  if (!/^[0-9a-f]{40}$/.test(ref) && !["main", "HEAD"].includes(ref))
    return undefined;
  const path = decoded(raw).replace(/\/$/, "");
  if (/^[0-9a-f]{40}$/.test(ref) && ref !== headOf(checkout)) {
    try {
      execFileSync(
        "git",
        ["-C", checkout.folder, "cat-file", "-e", `${ref}:${path}`],
        {
          stdio: "ignore",
        },
      );
      return true;
    } catch {
      return undefined;
    }
  }
  const target = join(checkout.folder, path);
  return (
    existsSync(target) &&
    (kind === "tree"
      ? statSync(target).isDirectory()
      : statSync(target).isFile())
  );
}

const allowedHost = (host) =>
  [...ALLOWED.keys()].find(
    (name) => host === name || host.endsWith(`.${name}`),
  );

/** Checks an address outside the site: asked once however many pages hold it. */
async function checkExternal(url, where, written) {
  const inside = inCheckout(url);
  if (inside === true) {
    counts.checkout += 1;
    return;
  }
  if (inside === false) {
    counts.checkout += 1;
    return fail(
      where,
      written,
      "not in the checkout of that repository at that commit",
    );
  }
  const host = new URL(url).host;
  const allowed = allowedHost(host);
  if (allowed !== undefined) {
    counts.allowed.add(host);
    return;
  }
  if (KNOWN_DEAD.has(url)) {
    counts.known.add(url);
    return;
  }
  if (settings.noExternal) return;
  counts.external.add(url);
  const { status, error } = await asked(url, () => ask(url));
  if (error === undefined && status < 400) return;
  const down =
    error === undefined ? status === 429 || status >= 500 : !GONE.has(error);
  (down ? unverified : failures).push({
    where,
    link: written,
    why: `${status ?? error}: ${url}`,
  });
}

/** Resolves a link on a page: the site's own, or the world's; undefined for what is not an address to check. */
async function checkLink(written, base, where) {
  if (written === "" || SKIPPED.test(written)) return;
  let url;
  try {
    url = new URL(written, base);
  } catch {
    return fail(where, written, "not an address");
  }
  if (!/^https?:$/.test(url.protocol)) return;
  const hash = url.hash.slice(1);
  url.hash = "";
  const bare = url.href;
  if (insideSite(bare)) return checkInternal(bare, hash, where, written);
  return checkExternal(bare, where, written);
}

// ---- the pages
const pageUrls = [];
const scanned = new Set();

async function scan(url) {
  if (scanned.has(url)) return;
  scanned.add(url);
  const found = await load(url);
  const where = url.slice(settings.site.length) || "index.html";
  if (found.status !== 200 || found.text === undefined) {
    fail(
      where,
      url,
      `${found.status ?? found.error}: a page of the site that is not served`,
    );
    return;
  }
  counts.pages += 1;
  await Promise.all(
    linksOf(found.text).map(async (written) => {
      await checkLink(written, url, where);
      if (settings.crawl) {
        try {
          const target = new URL(written, url);
          target.hash = "";
          if (insideSite(target.href) && HTML.test(target.pathname))
            pageUrls.push(target.href);
        } catch {
          // reported by checkLink
        }
      }
    }),
  );
}

function treePages(folder) {
  return readdirSync(folder, { recursive: true })
    .filter((entry) => entry.endsWith(".html"))
    .map((entry) => settings.site + entry.split("\\").join("/"));
}

async function pages() {
  if (settings.tree !== undefined) {
    await Promise.all(treePages(settings.tree).map(scan));
    return;
  }
  pageUrls.push(settings.site);
  for (let at = 0; at < pageUrls.length;) {
    const batch = pageUrls.slice(at, at + 24);
    at += batch.length;
    await Promise.all(batch.map(scan));
  }
}

// ---- the READMEs
/** The block under a `## Docs` heading, up to the next heading, or undefined. */
function docsBlock(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Docs\s*$/.test(line));
  if (start < 0) return undefined;
  const end = lines.findIndex(
    (line, at) => at > start && /^#{1,6}\s/.test(line),
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The addresses of a block of Markdown in the order they appear: inline links, autolinks, HTML anchors, definitions. */
function markdownLinks(block) {
  return [
    ...block.matchAll(
      /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>|\bhref="([^"]+)"|^\s*\[[^\]]+\]:\s*(\S+)/gm,
    ),
  ]
    .sort((a, b) => a.index - b.index)
    .map(
      ([, inline, auto, anchor, definition]) =>
        inline ?? auto ?? anchor ?? definition,
    );
}

const sameAddress = (a, b) =>
  a
    .replace(/#.*$/, "")
    .replace(/index\.html$/, "")
    .replace(/\/?$/, "/") ===
  b
    .replace(/#.*$/, "")
    .replace(/index\.html$/, "")
    .replace(/\/?$/, "/");

async function repositoriesOnFrontPage() {
  const front = await load(settings.site);
  if (front.text === undefined) return [];
  return [...front.text.matchAll(/<tr id="repository-([^"]+)"/g)].map(
    ([, name]) => name,
  );
}

async function readmes() {
  const names = await repositoriesOnFrontPage();
  if (names.length === 0) {
    fail(
      "index.html",
      "#repository-list",
      "the front page lists no repository",
    );
    return;
  }
  await Promise.all(
    names.map(async (name) => {
      const where = `README ${name}`;
      const base = `${settings.readmesFrom}${name}/${settings.ref.get(name) ?? "HEAD"}/`;
      const readme = await asked(`${base}README.md`, () =>
        ask(`${base}README.md`, "GET"),
      );
      if (readme.status !== 200)
        return fail(where, "", `no README: ${readme.status ?? readme.error}`);
      const block = docsBlock(readme.text);
      if (block === undefined)
        return fail(
          where,
          "",
          "no ## Docs block, which every README opens with a link to the hub",
        );
      const links = markdownLinks(block);
      if (
        links.length === 0 ||
        !sameAddress(new URL(links[0], base).href, settings.site)
      )
        return fail(
          where,
          "",
          `the first link in the Docs block is ${links[0] ?? "missing"}, not the hub ${settings.site}`,
        );
      await Promise.all(
        links.map((written) => checkLink(written, base, where)),
      );
    }),
  );
}

// ---- run
const began = Date.now();
await pages();
if (settings.readmes) await readmes();

const seconds = ((Date.now() - began) / 1000).toFixed(1);
const where =
  settings.tree !== undefined
    ? relative(process.cwd(), settings.tree) || "."
    : settings.site;
const external = settings.noExternal
  ? "not asked"
  : `${counts.external.size} asked`;
const allowed =
  counts.allowed.size === 0
    ? ""
    : `, ${counts.allowed.size} allowlisted host${counts.allowed.size === 1 ? "" : "s"} (${[...counts.allowed].join(", ")}) not asked`;
const rest = `${counts.known.size === 0 ? "" : `, ${counts.known.size} known dead (tracked by an issue)`}${unverified.length === 0 ? "" : `, ${new Set(unverified.map(({ why }) => why)).size} not answering`}`;
process.stdout.write(
  `link-check ${where}: ${counts.pages} pages, ${counts.internal} links to the site, ${counts.checkout} into a checkout, external addresses ${external}${allowed}${rest}, in ${seconds}s\n`,
);

/** Each failure once per link and reason, the first pages that hold it named. */
const grouped = new Map();
for (const { where: page, link, why } of failures) {
  const key = `${why}\n${link}`;
  const entry = grouped.get(key) ?? { link, why, pages: [] };
  entry.pages.push(page);
  grouped.set(key, entry);
}
for (const { link, why, pages: held } of grouped.values()) {
  const named = [...new Set(held)].sort();
  const shown = named.slice(0, 3).join(", ");
  const more = named.length > 3 ? ` and ${named.length - 3} more` : "";
  process.stdout.write(
    `FAIL ${shown}${more}: ${link === "" ? "" : `${link} -> `}${why}\n`,
  );
}
for (const { where: page, link, why } of unverified.slice(0, 20))
  process.stdout
    .write(`WARN ${page}: ${link} -> ${why} (no answer after ${ATTEMPTS} tries; not counted as dead)
`);
if (grouped.size > 0) {
  process.stdout.write(
    `${grouped.size} link${grouped.size === 1 ? "" : "s"} failed\n`,
  );
  process.exitCode = 1;
}
