import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import {
  connect,
  DEMO_PLAN,
  openPod,
  type Pod,
  pull,
  pullFiles,
  type Row,
} from "cascade-runtime";
import { demoFetch } from "@cascade-runtime/demo-hospital";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import { findRoot } from "@cascade-runtime/runtime/node";
import { type Served, servePages } from "../src/node/serve.js";
import { watched } from "./shown.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const PAGES = join(ROOT, "build", "pages");
const NORTH = "cascade-north";
const A_NORTH = "pt-1001";

let served: Served;
let browser: Browser;

before(async () => {
  if (!existsSync(join(PAGES, "connect", "index.html")))
    throw new Error(
      `${PAGES} holds no connect/; run npm run build:package and npm run build:pages first`,
    );
  served = await servePages(PAGES);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await served?.close();
});

/** A table as the page shows it: one column per field, sorted, the pod's own address left out of each value. */
function shownRows(pod: Pod, rows: readonly Row[]): string[][] {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  return rows.map((row) =>
    columns.map((column) => {
      const value = row[column] ?? "";
      return value.startsWith(pod.address)
        ? value.slice(pod.address.length)
        : value;
    }),
  );
}

const sorted = (rows: string[][]): string[][] =>
  [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

/** What Node pulls of patient A at North and shows after importing it, signing in with no page. */
async function expected(): Promise<{
  pulled: string[];
  allergies: string[][];
  medications: string[][];
}> {
  const hospitals = await loadHospitals();
  const north = hospitals.get(NORTH);
  assert.ok(north);
  const fetch = demoFetch([{ ...north, autoApprove: A_NORTH }]);
  const connection = await connect(
    { name: north.hospital.name, vendor: "demo", fhirBase: north.hospital.fhirBase },
    {
      clientId: "cascade-runtime-demo",
      redirectUri: "http://127.0.0.1/connect/signed-in.html",
      scopes: ["launch/patient", "patient/*.read"],
    },
    {
      fetch,
      signIn: async (authorize) =>
        new URL(
          (await fetch(authorize, { redirect: "manual" })).headers.get(
            "Location",
          ) ?? "",
        ),
    },
  );
  const record = await pull(connection, DEMO_PLAN);
  const pod = await openPod();
  try {
    const imported = await pod.import(pullFiles(record, NORTH), {
      aboutSubject: true,
    });
    assert.equal(imported.refused, undefined);
    return {
      pulled: record.bundle.entry
        .map(({ resource }) => {
          const { resourceType, id } = resource as {
            resourceType: string;
            id: string;
          };
          return `${resourceType}/${id}`;
        })
        .sort(),
      allergies: sorted(shownRows(pod, await pod.ask("pod/My active allergies"))),
      medications: sorted(
        shownRows(pod, await pod.ask("pod/My active medications")),
      ),
    };
  } finally {
    await pod.close();
  }
}

/** What the page says once its step is done, `ready` or `error`. */
async function settled(page: Page): Promise<{ state: string; status: string }> {
  await page.waitForSelector(
    'body[data-state="ready"], body[data-state="error"]',
    { timeout: 120_000 },
  );
  return {
    state: (await page.getAttribute("body", "data-state")) ?? "",
    status: (await page.textContent("#status")) ?? "",
  };
}

async function cells(page: Page, table: string): Promise<string[][]> {
  return page.$$eval(`${table} tbody tr`, (rows) =>
    rows.map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? ""),
    ),
  );
}

test("connect/ signs in to North in a popup through the page's own service worker, pulls patient A and imports the pull as Node does", async () => {
  const want = await expected();
  const page = watched(await browser.newPage());
  const said: string[] = [];
  page.on("console", (message) => said.push(message.text()));
  const secrets = new Set<string>();
  page.on("request", (request) => {
    const bearer = /^Bearer (.+)$/.exec(request.headers().authorization ?? "");
    if (bearer?.[1]) secrets.add(bearer[1]);
  });
  const signIn = async (): Promise<Page> => {
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.click(`button.sign-in[data-id="${NORTH}"]`),
    ]);
    popup.on("framenavigated", (frame) => {
      const code = new URL(frame.url()).searchParams.get("code");
      if (code) secrets.add(code);
    });
    await popup.waitForSelector('button[value="allow"]');
    return popup;
  };

  await page.goto(`${served.url}connect/index.html`);
  assert.equal((await settled(page)).state, "ready");
  assert.match(
    (await page.evaluate(
      () => navigator.serviceWorker.controller?.scriptURL,
    )) ?? "",
    /\/connect\/demo-hospital-worker\.js$/,
  );

  const cancelled = await signIn();
  await cancelled.click('button[value="cancel"]');
  assert.match((await settled(page)).status, /\(cancelled\)/);
  assert.ok(cancelled.isClosed());

  const closed = await signIn();
  await closed.close();
  assert.match((await settled(page)).status, /\(cancelled\)/);

  const allowed = await signIn();
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = `data:text/html,<script>parent.postMessage({ type: "cascade-runtime:signed-in", url: "${location.origin}/connect/signed-in.html?code=forged&state=forged" }, "*")</script>`;
    document.body.append(frame);
  });
  await allowed.check(`input[name="patient"][value="${A_NORTH}"]`);
  await allowed.click('button[value="allow"]');
  const done = await settled(page);
  assert.equal(done.state, "ready", done.status);

  assert.deepEqual(
    (await page.$$eval("#pulled li", (items) =>
      items.map((item) => item.textContent ?? ""),
    )).sort(),
    want.pulled,
  );
  assert.deepEqual(sorted(await cells(page, "#allergies")), want.allergies);
  assert.deepEqual(sorted(await cells(page, "#medications")), want.medications);
  assert.ok(want.allergies.length > 0);

  assert.ok(secrets.size >= 2, "the test saw no token or no code");
  const shown = await page.content();
  for (const secret of secrets) {
    assert.ok(!shown.includes(secret), "the page shows a token or a code");
    assert.ok(
      !said.some((line) => line.includes(secret)),
      "the console shows a token or a code",
    );
  }
});
