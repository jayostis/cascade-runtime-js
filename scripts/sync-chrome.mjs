// The website owns the chrome: packages/site/src/chrome.css is a copy of its css/chrome.css on site-docs.
//   node scripts/sync-chrome.mjs           rewrites the copy and its header
//   node scripts/sync-chrome.mjs --check   exits 1 when the website's file differs from the copy
// A file it cannot read (offline, or a repository it has no access to) is reported and exits 0 under --check, so
// such a run never fails a build; GH_TOKEN, when set, is sent with each request.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO = "the-cascade-protocol/cascadeprotocol.org";
const SOURCE = `https://raw.githubusercontent.com/${REPO}/site-docs/css/chrome.css`;
const COMMIT = `https://api.github.com/repos/${REPO}/commits/site-docs`;
const COPY = fileURLToPath(
  new URL("../packages/site/src/chrome.css", import.meta.url),
);
const FIX = "node scripts/sync-chrome.mjs";

const check = process.argv.includes("--check");
const unknown = process.argv.slice(2).filter((arg) => arg !== "--check");
if (unknown.length > 0) {
  process.stderr.write(`sync-chrome: unknown argument ${unknown[0]}\n`);
  process.exit(2);
}

// While the website's repository is private, only a token that can read it gets the file; a run without one reports
// that it could not read it.
const token = process.env.GH_TOKEN ?? "";

async function get(url, accept) {
  const response = await fetch(url, {
    headers: {
      accept,
      "user-agent": "sync-chrome",
      ...(token === "" ? {} : { authorization: `token ${token}` }),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.text()).replaceAll("\r\n", "\n");
}

const header = (sha) =>
  `/* ${REPO}, branch site-docs, css/chrome.css, at ${sha} */\n`;
const body = (text) => text.slice(text.indexOf("\n") + 1);

async function main() {
  let fetched;
  try {
    fetched = await get(SOURCE, "text/plain");
    if (fetched.trim() === "") throw new Error(`${SOURCE} is empty`);
  } catch (error) {
    process.stderr.write(
      `sync-chrome: could not read the website's chrome.css (${error.message})\n`,
    );
    return check ? 0 : 1;
  }
  const same = body(readFileSync(COPY, "utf8")) === fetched;
  if (check) {
    if (same) {
      process.stdout.write("sync-chrome: the copy matches the website\n");
      return 0;
    }
    process.stderr.write(
      `sync-chrome: packages/site/src/chrome.css differs from ${SOURCE}\nRun \`${FIX}\` and commit the result.\n`,
    );
    return 1;
  }
  if (same) {
    process.stdout.write("sync-chrome: the copy already matches the website\n");
    return 0;
  }
  let sha;
  try {
    sha = (await get(COMMIT, "application/vnd.github.sha")).trim();
    if (!/^[0-9a-f]{40}$/.test(sha))
      throw new Error(`${COMMIT} gave no commit`);
  } catch (error) {
    process.stderr.write(
      `sync-chrome: could not read the website's commit (${error.message})\n`,
    );
    return 1;
  }
  writeFileSync(COPY, header(sha) + fetched);
  process.stdout.write(
    `sync-chrome: copied the website's chrome.css at ${sha}\n`,
  );
  return 0;
}

process.exitCode = await main();
