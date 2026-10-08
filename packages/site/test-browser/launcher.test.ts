// try/ against the SMART Health IT launcher, a server this project did not write, over the network: run by
// `npm run test:launcher`, nightly, never by a pull request. Its patients are shared and edited by anyone, so this
// asserts which patient came back and that the record came in, never what it holds.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { TEST_DIRECTORY } from "cascade-runtime";
import { findRoot } from "@cascade-runtime/runtime/node";
import { type Served, servePages } from "../src/node/serve.js";
import { settled, tiles, watched } from "./shown.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const PAGES = join(ROOT, "build", "pages");
const LAUNCHER = "https://launch.smarthealthit.org";
const POD = "Launcher Patient";

let served: Served;
let browser: Browser;

before(async () => {
  if (!existsSync(join(PAGES, "try", "index.html")))
    throw new Error(
      `${PAGES} holds no try/; run npm run build:package and npm run build:pages first`,
    );
  served = await servePages(PAGES);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await served?.close();
});

/** Clicks the launcher's Sign in on the Find a hospital page; gives the popup once it shows the launcher's login. */
async function signIn(page: Page, name: string): Promise<Page> {
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.click(`.card:has(h2:text-is(${JSON.stringify(name)})) button`),
  ]);
  await popup.waitForSelector("select");
  assert.equal(new URL(popup.url()).origin, LAUNCHER);
  return popup;
}

/** Logs in on the launcher's page as its first patient, as a person picks one; gives the patient's ID and name. */
async function login(popup: Page): Promise<{ id: string; name: string }> {
  const [id = ""] = await popup.selectOption("select", { index: 1 });
  const name = await popup.$eval(
    "select",
    (select) =>
      (select as HTMLSelectElement).selectedOptions[0]?.textContent ?? "",
  );
  await popup.click("button.btn-success");
  await popup.waitForSelector("button.approve");
  return { id, name };
}

test("a new pod's person signs in at the SMART launcher in a popup, on its own pages, and brings the patient they chose into the pod", async () => {
  const row = TEST_DIRECTORY.find(({ vendor }) => vendor === "smart-launcher");
  assert.ok(row);
  const context = await browser.newContext();
  try {
    const page = watched(await context.newPage());
    const patients: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().endsWith("/auth/token")) return;
      const body = (await response.json().catch(() => ({}))) as {
        patient?: string;
      };
      if (body.patient) patients.push(body.patient);
    });
    await page.goto(`${served.url}try/index.html`);
    await settled(page);
    await page.click('a[href="#new-pod"]');
    await page.fill('#new-pod input[name="person"]', POD);
    await page.click('#new-pod button:has-text("Make the pod")');
    await settled(page);
    assert.equal(await page.textContent("main h1"), POD);
    await page.click('a:has-text("Find a hospital")');
    await settled(page);
    assert.deepEqual(
      await page.$$eval(".card h2", (found) =>
        found.map((each) => each.textContent ?? ""),
      ),
      TEST_DIRECTORY.map(({ name }) => name.replace(/ Demo Hospital$/, "")),
    );

    const denied = await signIn(page, row.name);
    await login(denied);
    await denied.click("button.deny");
    await settled(page);
    assert.match(
      (await page.textContent("#connection .card p")) ?? "",
      /^Not connected: /,
    );
    await page.goto(page.url().split("#")[0] ?? "");
    await settled(page);
    await page.click('a:has-text("Find a hospital")');
    await settled(page);

    const popup = await signIn(page, row.name);
    const chosen = await login(popup);
    await popup.click("button.approve");
    await settled(page);
    assert.ok(await page.isVisible("#connection"), "the box is not open");
    assert.deepEqual(patients.slice(-1), [chosen.id]);
    const about = /^This record is (.+)'s\./.exec(
      (await page.textContent("#connection .note")) ?? "",
    )?.[1];
    assert.ok(about, "the box names no patient");
    assert.ok(
      chosen.name.includes(about.split(" ").at(-1) ?? ""),
      `the launcher's ${chosen.name} is not the record's ${about}`,
    );

    const began = Date.now();
    await page.click("#connection button:has-text('Bring it into')");
    await settled(page, 300_000);
    console.log(`# brought in ${about}'s record in ${Date.now() - began} ms`);
    assert.equal(
      await page.textContent("main .note"),
      `Brought in the record from ${row.name}.`,
    );
    assert.ok((await tiles(page)).size > 0, "the pod's page shows no record");
  } finally {
    await context.close();
  }
});
