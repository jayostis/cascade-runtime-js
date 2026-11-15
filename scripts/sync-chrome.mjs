// The website owns the chrome: packages/site/src/chrome.css is a copy of the website's css/chrome.css.
//   node scripts/sync-chrome.mjs                rewrites the copy and its header
//   node scripts/sync-chrome.mjs --check        exits 1 when the website's file differs from the copy
//   node scripts/sync-chrome.mjs --from <url>   reads that address of the file instead
// The address is ${WEBSITE_URL}/css/chrome.css, WEBSITE_URL defaulting to the website's site-docs deployment. An
// address it cannot read (offline) is reported and exits 0 under --check, so such a run never fails a build.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const WEBSITE =
  process.env.WEBSITE_URL || "https://site-docs.cascadeprotocol-org.pages.dev";
const COPY = fileURLToPath(
  new URL("../packages/site/src/chrome.css", import.meta.url),
);
const FIX = "node scripts/sync-chrome.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const fromAt = args.indexOf("--from");
const from = fromAt === -1 ? undefined : args[fromAt + 1];
const unknown = args.filter(
  (arg, at) => arg !== "--check" && arg !== "--from" && at !== fromAt + 1,
);
if (unknown.length > 0 || (fromAt !== -1 && !from)) {
  process.stderr.write(
    `sync-chrome: usage: ${FIX} [--check] [--from <url>]${unknown.length > 0 ? `; unknown argument ${unknown[0]}` : ""}\n`,
  );
  process.exit(2);
}
const SOURCE = from ?? `${WEBSITE.replace(/\/+$/, "")}/css/chrome.css`;

const header = () =>
  `/* ${SOURCE}, copied ${new Date().toISOString().slice(0, 10)} */\n`;
const body = (text) => text.slice(text.indexOf("\n") + 1);

async function main() {
  let fetched;
  try {
    const response = await fetch(SOURCE, {
      headers: { accept: "text/css", "user-agent": "sync-chrome" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`answered ${response.status}`);
    fetched = (await response.text()).replaceAll("\r\n", "\n");
    if (fetched.trim() === "") throw new Error("it is empty");
  } catch (error) {
    process.stderr.write(
      `sync-chrome: could not read ${SOURCE} (${error.message})\n`,
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
  writeFileSync(COPY, header() + fetched);
  process.stdout.write(`sync-chrome: copied ${SOURCE}\n`);
  return 0;
}

process.exitCode = await main();
