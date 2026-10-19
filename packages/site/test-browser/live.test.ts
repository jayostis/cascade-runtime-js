import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import { findRoot } from "@cascade-runtime/runtime/node";
import { STARTER_TRY } from "../src/front-page.js";

type Address = typeof import("../../cascade-runtime/pack/address.js");

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
/** Pages' deploy, and the ten minutes it caches a page for. */
const DEPLOY = 15 * 60_000;
const BETWEEN = 20_000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`set ${name} to run the live check`);
  return value;
}

/** The file at the path in a tar archive, by the ustar header of each entry. */
function fromTar(tar: Uint8Array, wanted: string): Uint8Array | undefined {
  const field = (at: number, length: number): string =>
    new TextDecoder()
      .decode(tar.subarray(at, at + length))
      .replace(/\0[\s\S]*$/, "");
  for (let at = 0; at + 512 <= tar.length;) {
    const name = field(at, 100);
    if (name === "") return undefined;
    const prefix = field(at + 345, 155);
    const size = parseInt(field(at + 124, 12).trim() || "0", 8);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (path === wanted) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

async function answered(url: string): Promise<Response> {
  try {
    return await fetch(url, { redirect: "follow" });
  } catch (error) {
    assert.fail(`${url} did not answer: ${String(error)}`);
  }
}

test("the deployed site of the commit serves its release, the front page, the quick start with the starter kit's command, the examples, Alex's site, and try/'s old page, which sends a visitor on to the starter kit's", async () => {
  const site = required("PAGES_URL").replace(/\/?$/, "/");
  const commit = required("COMMIT");
  const { packageVersion, tarballAddress } = (await import(
    pathToFileURL(
      join(ROOT, "packages", "cascade-runtime", "dist", "pack", "address.js"),
    ).href
  )) as Address;

  const began = Date.now();
  for (;;) {
    const response = await fetch(
      `${site}examples.html?commit=${commit}&at=${Date.now()}`,
      { cache: "no-store" },
    ).catch(() => undefined);
    const examples = response?.ok === true ? await response.text() : "";
    if (examples.includes(`/tree/${commit}/`)) break;
    if (Date.now() - began > DEPLOY)
      assert.fail(
        `${site}examples.html did not name ${commit} within ${DEPLOY / 60_000} minutes`,
      );
    await sleep(BETWEEN);
  }
  console.log(
    `waited ${Math.round((Date.now() - began) / 1000)}s for the deploy of ${commit}`,
  );

  const front = await answered(`${site}?at=${Date.now()}`);
  assert.equal(front.status, 200, site);
  assert.ok(
    (await front.text()).includes(`href="start.html"`),
    `${site} is not the front page that leads to start.html`,
  );
  for (const path of [
    "start.html",
    "examples.html",
    "alex-rivera/index.html",
  ]) {
    const response = await answered(`${site}${path}?at=${Date.now()}`);
    assert.equal(response.status, 200, `${site}${path}`);
  }

  const address = tarballAddress(commit);
  const tarball = await answered(address);
  assert.equal(tarball.status, 200, address);
  const manifest = fromTar(
    gunzipSync(new Uint8Array(await tarball.arrayBuffer())),
    "package/package.json",
  );
  assert.ok(manifest, `${address} holds no package/package.json`);
  const { version } = JSON.parse(new TextDecoder().decode(manifest)) as {
    version?: string;
  };
  assert.equal(version, packageVersion(commit), address);

  const start = await (
    await answered(`${site}start.html?at=${Date.now()}`)
  ).text();
  const command =
    /https:\/\/github\.com\/jayostis\/cascade-starter-kit\/releases\/download\/build-[0-9a-f]{40}\/create-cascade-app-[^\s"<>]+\.tgz/.exec(
      start,
    )?.[0];
  assert.ok(
    command,
    "start.html's command names no release of the starter kit",
  );
  assert.equal((await answered(command)).status, 200, command);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const asked = "?pod=alex-rivera#records";
    await page.goto(`${site}try/index.html${asked}`);
    await page.waitForURL(`${STARTER_TRY}${asked}`, {
      timeout: 30_000,
      waitUntil: "commit",
    });
  } finally {
    await browser.close();
  }
});
