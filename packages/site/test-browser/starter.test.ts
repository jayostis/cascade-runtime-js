// The starter's chat in Chromium, against a copy of the starter and a stub model on loopback: no real model, key or
// network. The copy makes its own pods, so nothing under the repository is written.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";
import { findRoot } from "@cascade-runtime/runtime/node";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const KEY = "sk-test-key-that-must-not-leave";
const ASKS = "open Ines Calloway's pod";

type Stub = { url: string; stopped: () => number; close: () => Promise<void> };

/** An OpenAI-compatible model that opens the pod a question names, answers "Done." after a tool result, and tells a long story for as long as it is listened to. */
async function stubModel(): Promise<Stub> {
  let stopped = 0;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const { messages } = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages: { role: string; content?: string }[];
      };
      const last = messages.at(-1)!;
      const send = (delta: object, finish: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      response.writeHead(200, { "content-type": "text/event-stream" });
      const named = /open (.+?)'s pod/i.exec(last.content ?? "")?.[1];
      if (last.role === "tool") {
        send({ content: "Done." });
        send({}, "stop");
        response.end("data: [DONE]\n\n");
      } else if (named !== undefined) {
        const pod = named.toLowerCase().replace(/\s+/g, "-");
        send({
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: {
                name: "open_pod",
                arguments: JSON.stringify({ pod }),
              },
            },
          ],
        });
        send({}, "tool_calls");
        response.end("data: [DONE]\n\n");
      } else {
        response.on("close", () => {
          if (!response.writableFinished) stopped += 1;
        });
        const talk = setInterval(
          () => send({ content: "Once upon a time. " }),
          30,
        );
        response.on("close", () => clearInterval(talk));
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    stopped: () => stopped,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

type Started = {
  origin: string;
  folder: string;
  stop: (keep?: boolean) => Promise<void>;
};

/**
 * A copy of the starter in a folder of its own, listening on a port the system picks; `env` is the model's settings.
 * Given the `folder` of an earlier copy that `stop(true)` kept, it starts again in it, with its pods.
 */
async function startStarter(
  env: Record<string, string>,
  again?: string,
): Promise<Started> {
  const folder = again ?? (await mkdtemp(join(tmpdir(), "t273-")));
  if (again === undefined) {
    await cp(join(ROOT, "packages", "cascade-runtime", "starter"), folder, {
      recursive: true,
      filter: (from) => !/[\\/](node_modules|pods|\.env)$/.test(from),
    });
    await symlink(
      join(ROOT, "node_modules"),
      join(folder, "node_modules"),
      "junction",
    );
  }
  const settings: Record<string, string | undefined> = {
    ...process.env,
    PORT: "0",
    CASCADE_MODEL_PROVIDER: undefined,
    CASCADE_MODEL_URL: undefined,
    CASCADE_MODEL_NAME: undefined,
    CASCADE_MODEL_KEY: undefined,
    ...env,
  };
  const child: ChildProcess = spawn("node", ["server.mjs"], {
    cwd: folder,
    env: settings,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let said = "";
  child.stderr!.on("data", (chunk: Buffer) => (said += chunk));
  const origin = await new Promise<string>((found, failed) => {
    child.stdout!.on("data", (chunk: Buffer) => {
      const at = /http:\/\/127\.0\.0\.1:\d+/.exec(chunk.toString());
      if (at) found(at[0]);
    });
    child.on("exit", () => failed(new Error(`the starter stopped: ${said}`)));
  });
  return {
    origin,
    folder,
    async stop(keep = false) {
      const exited = new Promise((done) => child.on("exit", done));
      child.kill();
      await exited;
      if (keep) return;
      await unlink(join(folder, "node_modules"));
      await rm(folder, { recursive: true, force: true });
    },
  };
}

const post = (origin: string, path: string, body: object) =>
  fetch(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

let stub: Stub;
let browser: Browser;
let modelled: Started;
let bare: Started;

before(async () => {
  stub = await stubModel();
  modelled = await startStarter({
    CASCADE_MODEL_PROVIDER: "other",
    CASCADE_MODEL_URL: stub.url,
    CASCADE_MODEL_NAME: "stub-1",
    CASCADE_MODEL_KEY: KEY,
  });
  bare = await startStarter({});
  for (const person of ["Ada Lovelace", "Ines Calloway"]) {
    const made = await fetch(modelled.origin + "/pods", {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: modelled.origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ person }),
    });
    assert.equal(made.status, 303, person);
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await modelled?.stop();
  await bare?.stop();
  await stub?.close();
});

test("asking to open another pod moves the app there, and the question and the chat stay in the strip", async () => {
  const page = await browser.newPage();
  await page.goto(`${modelled.origin}/pods/ada-lovelace/`);
  await page.getByLabel("Ask a question").fill(ASKS);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL(`${modelled.origin}/pods/ines-calloway/`);
  assert.equal(await page.locator(".chat-log .you").textContent(), ASKS);
  assert.equal(await page.locator(".chat-log .model").textContent(), "Done.");
  assert.equal(
    await page.locator(".chat-recent li button").textContent(),
    ASKS,
  );
  await page.close();
});

test("Stop ends the call to the model, not just the spinner", async () => {
  const page = await browser.newPage();
  await page.goto(`${modelled.origin}/pods/ada-lovelace/`);
  await page.getByLabel("Ask a question").fill("tell me a long story");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator(".chat-log .model", { hasText: "Once upon" }).waitFor();
  await page.getByRole("button", { name: "Stop" }).click();
  await page.locator(".chat-log .stopped").waitFor();
  for (let waited = 0; stub.stopped() === 0 && waited < 5000; waited += 50)
    await new Promise((done) => setTimeout(done, 50));
  assert.equal(stub.stopped(), 1);
  await page.close();
});

test("with no model set the strip says to run npm run model and has no form; with one, no page and no event holds its key or address", async () => {
  const page = await browser.newPage();
  await page.goto(`${bare.origin}/`);
  assert.match(
    (await page.locator(".chat").textContent()) ?? "",
    /npm run model/,
  );
  assert.equal(await page.locator(".chat-form").count(), 0);
  await page.close();

  const shown = [
    await (await fetch(`${modelled.origin}/`)).text(),
    await (await fetch(`${modelled.origin}/pods/ada-lovelace/`)).text(),
    await (
      await post(modelled.origin, "/chat", {
        pod: "",
        page: "/",
        messages: [{ role: "user", content: ASKS }],
      })
    ).text(),
  ].join("\n");
  assert.match(shown, /"type":"tool"/);
  assert.equal(shown.includes(KEY), false);
  assert.equal(shown.includes(stub.url), false);
});

test("after Allow at a demo hospital the connection's box moves on by itself, to Bring it in, and from bringing it in to the pod's page", async () => {
  const made = await fetch(bare.origin + "/pods", {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: bare.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ person: "Ines Calloway" }),
  });
  assert.equal(made.status, 303);
  const page = await browser.newPage();
  await page.goto(`${bare.origin}/pods/ines-calloway/`);
  await page
    .getByRole("button", { name: /^Sign in at / })
    .first()
    .click();
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(/\?connection=\d+#connection$/);
  const bring = page.getByRole("button", { name: /^Bring it into / });
  await bring.waitFor({ timeout: 30_000 });
  await bring.click();
  await page
    .locator("main .note", { hasText: /^Brought in the record from / })
    .waitFor({ timeout: 60_000 });
  await page.close();
  for (const [path, status, to] of [
    ["/pods/ines-calloway/connections/999", 303, "/pods/ines-calloway/"],
    ["/pods/nobody-here/connections/1", 404, null],
  ]) {
    const gone = await fetch(bare.origin + path, { redirect: "manual" });
    assert.equal(gone.status, status);
    assert.equal(gone.headers.get("location"), to);
  }
});

test("a finding the model's tool found is drawn as a card with the app's sentence, its numbers and row links, and Open the trend goes to the trend", async () => {
  const view = "/pods/ines-calloway/trend?test=18262-6&medication=617310";
  const finding = {
    key: "start:617310:18262-6",
    kind: "after start",
    direction: "down",
    said: "LDL was lower after atorvastatin started.",
    unit: "mg/dL",
    test: { code: "18262-6", notation: "18262-6", name: "LDL" },
    medication: { name: "atorvastatin", date: "2024-03-01" },
    before: { count: 2, mean: 160, min: 150, max: 170 },
    after: { count: 1, mean: 95, min: 95, max: 95 },
    view,
    rows: [
      {
        entry: "lab-1",
        performed: "2024-01-10T00:00:00Z",
        value: "150",
        unit: "mg/dL",
        side: "before",
      },
      {
        entry: "lab-2",
        performed: "2024-06-10T00:00:00Z",
        value: "95",
        unit: "mg/dL",
        side: "after",
      },
    ],
  };
  const events = [
    { type: "start" },
    {
      type: "tool",
      id: "c1",
      name: "find_changes",
      ok: true,
      findings: [finding],
    },
    { type: "delta", text: "Here it is." },
    { type: "done", stop: "end" },
  ];
  const page = await browser.newPage();
  await page.route("**/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    }),
  );
  await page.goto(`${modelled.origin}/pods/ines-calloway/`);
  await page.getByLabel("Ask a question").fill("find anything interesting");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.locator(".chat-log .card");
  await card.waitFor();
  const said = (await card.textContent()) ?? "";
  assert.match(said, /LDL was lower after atorvastatin started\./);
  assert.match(said, /mean 160 mg\/dL over 2 results/);
  assert.match(said, /mean 95 mg\/dL over 1 result\b/);
  assert.deepEqual(
    await card
      .locator("li a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
    ["/pods/ines-calloway/entries/lab-1", "/pods/ines-calloway/entries/lab-2"],
  );
  await card.getByRole("button", { name: "Open the trend" }).click();
  await page.waitForURL(`${modelled.origin}${view}`);

  await page.goto(`${modelled.origin}/pods/ines-calloway/`);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button id="asker" data-ask='{"kind":"entry","id":"x"}' data-ask-label="Lisinopril">Ask about this</button>`,
    );
  });
  const sent = page.waitForRequest("**/chat");
  await page.locator("#asker").click();
  const body = (await sent).postDataJSON();
  assert.deepEqual(body.context, { kind: "entry", id: "x" });
  assert.deepEqual(body.messages, [
    { role: "user", content: "What is this, and where did it come from?" },
  ]);
  assert.equal(
    await page.locator(".chat-about").textContent(),
    "About: Lisinopril",
  );
  assert.equal(await page.locator(".chat-chips").isHidden(), true);
  assert.equal(
    await page.locator(".chat-log .you").textContent(),
    "What is this, and where did it come from?",
  );
  await page.locator(".chat-log .model").waitFor();
  assert.match(
    (await page.locator(".chat-log .model").textContent()) ?? "",
    /^Here it is\./,
  );

  await page.goto(`${modelled.origin}/pods/ines-calloway/`);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button id="asker" data-ask='{"kind":"entry","id":"y"}' data-ask-label="Aspirin">Ask about this</button>`,
    );
  });
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/chat")) requests += 1;
  });
  await page.locator("#asker").dblclick();
  await page.locator(".chat-log .model").waitFor();
  await page.locator(".chat-send:not([hidden])").waitFor();
  assert.equal(requests, 1);
  await page.close();
});

/** A page with the chat strip open on a long answer to "say a lot" about a long label, in a window of this size. */
const openOnLongAnswer = async (width: number, height: number) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route("**/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        [
          { type: "start" },
          { type: "delta", text: "A long answer. ".repeat(400) },
          { type: "done", stop: "end" },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    }),
  );
  await page.goto(`${modelled.origin}/pods/ines-calloway/`);
  const label = "A long label about one finding of the pod. ".repeat(6);
  await page.evaluate((text) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button id="asker" data-ask='{"kind":"finding","key":"x"}' data-ask-label="${text}">Ask about this</button>`,
    );
  }, label);
  await page.locator("#asker").click();
  await page.locator(".chat-send:not([hidden])").waitFor();
  return { page, label };
};

test("the question box stays in view with the page at its top, in a short window and a phone-sized one", async () => {
  for (const [width, height] of [
    [375, 667],
    [844, 390],
  ] as const) {
    const { page } = await openOnLongAnswer(width, height);
    await page.evaluate(() => window.scrollTo(0, 0));
    const input = (await page.locator(".chat-form input").boundingBox())!;
    assert.ok(
      input.y >= 0 && input.y + input.height <= height,
      `at ${width}x${height} the question box is ${input.y}+${input.height}`,
    );
    await page.close();
  }
});

test("on a phone the About line is clamped to one line, the page scrolls its end above the open strip, and a long answer opens at its question", async () => {
  const { page, label } = await openOnLongAnswer(390, 600);

  const box = async (selector: string) =>
    (await page.locator(selector).boundingBox())!;
  const log = await box(".chat-log");
  const lines = await page
    .locator(".chat-about")
    .evaluate(
      (element) =>
        element.getBoundingClientRect().height /
        parseFloat(getComputedStyle(element).lineHeight),
    );
  assert.ok(lines <= 1.05, `the About line is ${lines} lines`);
  assert.equal(
    await page.locator(".chat-about").getAttribute("title"),
    `About: ${label}`,
  );
  const question = await box(".chat-log .you");
  assert.ok(
    question.y >= log.y - 1 &&
      question.y + question.height <= log.y + log.height,
    `question ${question.y}+${question.height}, log ${log.y}+${log.height}`,
  );

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const strip = await box(".chat");
  const last = await page.evaluate(
    () => document.querySelector("main")!.getBoundingClientRect().bottom,
  );
  assert.ok(
    last <= strip.y + 1,
    `the page ends at ${last}, the strip starts at ${strip.y}`,
  );

  await page.reload();
  const reopened = await box(".chat-log .you");
  const room = await box(".chat-log");
  assert.ok(
    reopened.y >= room.y - 1 &&
      reopened.y + reopened.height <= room.y + room.height,
    `after a reload the question is ${reopened.y}+${reopened.height}, the log ${room.y}+${room.height}`,
  );
  await page.close();
});

test("an open chat leaves the page's own content in view, and the strip folds to its bar and stays folded in the tab", async () => {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 850 },
  });
  await page.route("**/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        [
          { type: "start" },
          { type: "delta", text: "A long answer. ".repeat(400) },
          { type: "done", stop: "end" },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    }),
  );
  await page.goto(`${modelled.origin}/pods/ines-calloway/`);
  await page.getByLabel("Ask a question").fill("say a lot");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator(".chat-log .model").waitFor();
  const strip = page.locator(".chat");
  const height = async () => (await strip.boundingBox())!.height;
  assert.ok((await height()) < 850 / 2, `the strip is ${await height()} px`);
  assert.ok(
    await page
      .locator(".chat-log")
      .evaluate((log) => log.scrollHeight > log.clientHeight),
    "the log scrolls inside the strip",
  );

  await page.getByRole("button", { name: "Hide chat" }).click();
  assert.equal(await page.locator(".chat-form").isVisible(), false);
  const bar = await height();
  assert.ok(bar < 100, `the bar is ${bar} px`);
  await page.reload();
  assert.equal(await page.locator(".chat-form").isVisible(), false);
  await page.getByRole("button", { name: "Show chat" }).click();
  assert.equal(await page.locator(".chat-form").isVisible(), true);
  await page.getByRole("button", { name: "Hide chat" }).click();
  await page.locator(".chat-recent summary").click();
  await page.locator(".chat-recent li button").first().click();
  assert.equal(await page.locator(".chat-form").isVisible(), true);
  await page.close();
});

/** Every file under `folder`, by path relative to it. */
async function filesUnder(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile())
      found.push(join(entry.parentPath, entry.name).slice(folder.length + 1));
  return found;
}

test("an encrypted pod: six words checked, nothing plaintext on disk, no chat saved, and after a restart only the words open it", async () => {
  let sealed = await startStarter({
    CASCADE_MODEL_PROVIDER: "other",
    CASCADE_MODEL_URL: stub.url,
    CASCADE_MODEL_NAME: "stub-1",
    CASCADE_MODEL_KEY: KEY,
  });
  const folder = sealed.folder;
  try {
    const page = await browser.newPage();
    await page.goto(`${sealed.origin}/#new-pod`);
    await page.getByLabel("Encrypt this pod with six words").check();
    await page.getByLabel("A person's name").fill("Grace Hopper");
    await page.getByRole("button", { name: "Make the pod" }).click();
    const words = await page.locator(".words li").allTextContents();
    assert.equal(words.length, 6);

    const confirm = page.locator("form", {
      has: page.locator('input[name="word2"]'),
    });
    const signUp = await confirm.evaluate((form) => {
      const named = (field: string) =>
        form.querySelector<HTMLInputElement>(`input[name="${field}"]`)!;
      return ["username", "password"].map((field) => {
        const input = named(field);
        return {
          type: input.type,
          autocomplete: input.autocomplete,
          value: input.value,
          hidden:
            input.readOnly ||
            input.closest("[aria-hidden]") !== null ||
            input.offsetParent === null,
        };
      });
    });
    assert.deepEqual(signUp, [
      {
        type: "text",
        autocomplete: "username",
        value: "grace-hopper",
        hidden: false,
      },
      {
        type: "password",
        autocomplete: "new-password",
        value: words.join(" "),
        hidden: false,
      },
    ]);
    assert.equal(
      page.url().includes(words[0]!),
      false,
      "the words are never in the address",
    );

    assert.equal(
      await page
        .getByRole("button", { name: "Copy words" })
        .getAttribute("type"),
      "button",
    );

    await page.getByLabel("Password").fill("a suggested password");
    await page.getByLabel("Word 2").fill(words[1]!);
    await page.getByLabel("Word 5").fill(words[4]!);
    await page.getByRole("button", { name: "Make the encrypted pod" }).click();
    assert.match(
      (await page.locator("main").textContent()) ?? "",
      /must hold the six words above/,
    );
    assert.equal(
      await page.getByLabel("Password").inputValue(),
      words.join(" "),
      "the field is reset to the words",
    );
    assert.equal(
      (await readdir(join(folder, "pods"))).includes("grace-hopper"),
      false,
      "a changed password field makes nothing",
    );
    await page.getByLabel("Pod", { exact: true }).fill("someone-else");
    await page.getByLabel("Word 2").fill(words[1]!);
    await page.getByLabel("Word 5").fill(words[4]!);
    await page.getByRole("button", { name: "Make the encrypted pod" }).click();
    assert.match(
      (await page.locator("main").textContent()) ?? "",
      /Pod field must keep the pod's name/,
    );
    assert.equal(
      (await readdir(join(folder, "pods"))).includes("grace-hopper"),
      false,
      "a changed name makes nothing",
    );

    await page.getByLabel("Word 2").fill("not-a-word");
    await page.getByLabel("Word 5").fill(words[4]!);
    await page.getByRole("button", { name: "Make the encrypted pod" }).click();
    assert.match(
      (await page.locator("main").textContent()) ?? "",
      /Those aren't words 2 and 5/,
    );
    assert.equal(
      (await readdir(join(folder, "pods"))).includes("grace-hopper"),
      false,
      "a wrong check makes nothing",
    );

    await page.getByLabel("Word 2").fill(` ${words[1]!.toUpperCase()} `);
    await page.getByLabel("Word 5").fill(words[4]!);
    await page.getByRole("button", { name: "Make the encrypted pod" }).click();
    await page.waitForURL(`${sealed.origin}/pods/grace-hopper/`);

    await page.getByLabel("Ask a question").fill("tell me a long story");
    await page.getByRole("button", { name: "Send" }).click();
    await page.locator(".chat-log .model", { hasText: "Once upon" }).waitFor();
    await page.getByRole("button", { name: "Stop" }).click();
    const kept = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cascade.chats") ?? "[]"),
    );
    assert.deepEqual(
      kept.filter((chat: { pod: string }) => chat.pod === "grace-hopper"),
      [],
    );
    await page.close();

    const racing = await browser.newPage();
    await racing.goto(`${sealed.origin}/#new-pod`);
    await racing.getByLabel("Encrypt this pod with six words").check();
    await racing.getByLabel("A person's name").fill("Alan Turing");
    await racing.getByRole("button", { name: "Make the pod" }).click();
    const racingWords = await racing.locator(".words li").allTextContents();
    const plain = await browser.newPage();
    await plain.goto(`${sealed.origin}/#new-pod`);
    await plain.getByLabel("A person's name").fill("Alan Turing");
    await plain.getByRole("button", { name: "Make the pod" }).click();
    await plain.waitForURL(`${sealed.origin}/pods/alan-turing/`);
    await racing.getByLabel("Word 2").fill(racingWords[1]!);
    await racing.getByLabel("Word 5").fill(racingWords[4]!);
    await racing
      .getByRole("button", { name: "Make the encrypted pod" })
      .click();
    assert.match(
      (await racing.locator("main").textContent()) ?? "",
      /A pod named alan-turing exists already/,
    );
    assert.equal(await racing.url(), `${sealed.origin}/encrypted-pods`);
    await racing.close();
    await plain.close();

    await sealed.stop(true);
    const answersFolder = join(folder, "pods", ".answers", "grace-hopper");
    const sealedFolders = [join(folder, "pods", "grace-hopper")];
    if (existsSync(answersFolder)) sealedFolders.push(answersFolder);
    for (const sealedFolder of sealedFolders) {
      const files = await filesUnder(sealedFolder);
      assert.ok(files.length > 0, `${sealedFolder} holds files`);
      for (const file of files) {
        if (file.replaceAll("\\", "/") === "settings/encryption.json") continue;
        const text = await readFile(join(sealedFolder, file), "latin1");
        assert.ok(text.length > 0, file);
        for (const readable of ["@prefix", "Grace", '"title"', '"rows"'])
          assert.equal(text.includes(readable), false, `${file}: ${readable}`);
        assert.throws(() => JSON.parse(text), `${file} parses as JSON`);
      }
    }

    sealed = await startStarter({}, folder);
    const again = await browser.newPage();
    await again.goto(`${sealed.origin}/pods/grace-hopper/`);
    await again
      .getByLabel("Your six words")
      .fill("one two three four five six");
    await again.getByRole("button", { name: "Open this pod" }).click();
    assert.match(
      (await again.locator("main").textContent()) ?? "",
      /don't open this pod/,
    );
    await again.getByLabel("Your six words").fill(words.join(" "));
    await again.getByRole("button", { name: "Open this pod" }).click();
    await again.waitForURL(`${sealed.origin}/pods/grace-hopper/`);
    assert.equal(await again.getByLabel("Your six words").count(), 0);
    assert.match(
      (await again.locator("main").textContent()) ?? "",
      /Grace Hopper/,
    );
    await again.close();
  } finally {
    await sealed.stop();
  }
});
