import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import { findRoot } from "@cascade-runtime/runtime/node";
import { shown, watched } from "./shown.js";

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

test("the deployed site serves the quick start of the commit, its release, the front page, the examples, Alex's site and try/", async () => {
  const site = required("PAGES_URL").replace(/\/?$/, "/");
  const commit = required("COMMIT");
  const { packageVersion } = (await import(
    pathToFileURL(
      join(ROOT, "packages", "cascade-runtime", "dist", "pack", "address.js"),
    ).href
  )) as Address;

  const began = Date.now();
  let start: string;
  for (;;) {
    const response = await fetch(
      `${site}start.html?commit=${commit}&at=${Date.now()}`,
      { cache: "no-store" },
    ).catch(() => undefined);
    start = response?.ok === true ? await response.text() : "";
    if (start.includes(`build-${commit}`)) break;
    if (Date.now() - began > DEPLOY)
      assert.fail(
        `${site}start.html did not name build-${commit} within ${DEPLOY / 60_000} minutes; it names ${/build-[0-9a-f]+/.exec(start)?.[0] ?? "no build"}`,
      );
    await sleep(BETWEEN);
  }
  console.log(
    `waited ${Math.round((Date.now() - began) / 1000)}s for the deploy of ${commit}`,
  );

  for (const path of [
    "",
    "start.html",
    "examples.html",
    "alex-rivera/index.html",
  ]) {
    const response = await answered(`${site}${path}?at=${Date.now()}`);
    assert.equal(response.status, 200, `${site}${path}`);
  }

  const address = /https:\/\/[^\s"<>]+\.tgz/.exec(start)?.[0];
  assert.ok(address, "start.html's command names no tarball");
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

  const browser = await chromium.launch();
  try {
    const page = watched(await browser.newPage());
    const opened = await page.goto(`${site}try/index.html?at=${Date.now()}`);
    assert.equal(opened?.status(), 200, `${site}try/index.html`);
    const { active } = await shown(page);
    assert.ok(active.length > 0, `${site}try/ shows no active allergy`);
  } finally {
    await browser.close();
  }
});
