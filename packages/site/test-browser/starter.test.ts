// The starter's chat in Chromium, against a copy of the starter and a stub model on loopback: no real model, key or
// network. The copy makes its own pods, so nothing under the repository is written.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { cp, mkdtemp, rm, symlink, unlink } from "node:fs/promises";
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

type Started = { origin: string; stop: () => Promise<void> };

/** A copy of the starter in a folder of its own, listening on a port the system picks; `env` is the model's settings. */
async function startStarter(env: Record<string, string>): Promise<Started> {
  const folder = await mkdtemp(join(tmpdir(), "t273-"));
  await cp(join(ROOT, "packages", "cascade-runtime", "starter"), folder, {
    recursive: true,
    filter: (from) => !/[\\/](node_modules|pods|\.env)$/.test(from),
  });
  await symlink(
    join(ROOT, "node_modules"),
    join(folder, "node_modules"),
    "junction",
  );
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
    async stop() {
      const exited = new Promise((done) => child.on("exit", done));
      child.kill();
      await exited;
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
