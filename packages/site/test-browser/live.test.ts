import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
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

const CONFIGURED =
  (process.env["PAGES_URL"] ?? "") !== "" &&
  (process.env["COMMIT"] ?? "") !== "";

/**
 * After a merge, Pages serves the new site some minutes later. This waits until the examples page names the commit, then
 * checks that what the quick start tells a newcomer to run is really there. It needs the network and a finished deploy,
 * so it is no case of `npm test`.
 */
describe("The deployed site of a commit · npm run test:live", () => {
  describe("given the site Pages deployed for the commit", () => {
    const skip = CONFIGURED ? false : "PAGES_URL and COMMIT are not both set";
    let site: string;
    let commit: string;
    let address: Address;
    let deployed = false;

    /** Asks for the examples page every twenty seconds until it names the commit, for fifteen minutes at most. */
    before(async () => {
      if (!CONFIGURED) return;
      site = required("PAGES_URL").replace(/\/?$/, "/");
      commit = required("COMMIT");
      address = (await import(
        pathToFileURL(
          join(
            ROOT,
            "packages",
            "cascade-runtime",
            "dist",
            "pack",
            "address.js",
          ),
        ).href
      )) as Address;
      const began = Date.now();
      while (!deployed && Date.now() - began <= DEPLOY) {
        const response = await fetch(
          `${site}examples.html?commit=${commit}&at=${Date.now()}`,
          { cache: "no-store" },
        ).catch(() => undefined);
        const examples = response?.ok === true ? await response.text() : "";
        deployed = examples.includes(`/tree/${commit}/`);
        if (!deployed) await sleep(BETWEEN);
      }
      console.log(
        `waited ${Math.round((Date.now() - began) / 1000)}s for the deploy of ${commit}`,
      );
    });

    it(
      "names the commit on the examples page within fifteen minutes",
      { skip },
      () => {
        assert.ok(
          deployed,
          `${site}examples.html did not name ${commit} within ${DEPLOY / 60_000} minutes`,
        );
      },
    );

    it(
      "serves the front page, which links the quick start",
      { skip },
      async () => {
        const front = await answered(`${site}?at=${Date.now()}`);
        assert.equal(front.status, 200, site);
        assert.ok(
          (await front.text()).includes(`href="start.html"`),
          `${site} is not the front page that leads to start.html`,
        );
      },
    );

    it(
      "serves the quick start, the examples page and Alex's site",
      { skip },
      async () => {
        for (const path of [
          "start.html",
          "examples.html",
          "alex-rivera/index.html",
        ]) {
          const response = await answered(`${site}${path}?at=${Date.now()}`);
          assert.equal(response.status, 200, `${site}${path}`);
        }
      },
    );

    it(
      "serves the runtime's release for the commit, at the version the commit gives",
      { skip },
      async () => {
        const where = address.tarballAddress(commit);
        const tarball = await answered(where);
        assert.equal(tarball.status, 200, where);
        const manifest = fromTar(
          gunzipSync(new Uint8Array(await tarball.arrayBuffer())),
          "package/package.json",
        );
        assert.ok(manifest, `${where} holds no package/package.json`);
        const { version } = JSON.parse(new TextDecoder().decode(manifest)) as {
          version?: string;
        };
        assert.equal(version, address.packageVersion(commit), where);
      },
    );

    it(
      "serves the starter kit's release that the quick start's command names",
      { skip },
      async () => {
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
      },
    );

    it(
      "sends a visitor of try/'s old page on to the starter kit's, in a browser",
      { skip },
      async () => {
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage();
          await page.goto(
            `${site}try/index.html?at=${Date.now()}&pod=alex-rivera#records`,
          );
          await page.waitForURL((url) => url.href.startsWith(STARTER_TRY), {
            timeout: 30_000,
            waitUntil: "commit",
          });
        } finally {
          await browser.close();
        }
      },
    );
  });

  describe("given no `PAGES_URL` or `COMMIT`", () => {
    it(
      "fails, saying which to set",
      { skip: CONFIGURED ? "PAGES_URL and COMMIT are both set" : false },
      () => {
        required("PAGES_URL");
        required("COMMIT");
      },
    );
  });
});
