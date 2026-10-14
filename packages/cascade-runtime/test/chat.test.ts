import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { loadHospital, loadStories } from "@cascade-runtime/demo-hospital/node";
import { openPod, type Pod, pullFiles, Refusal } from "cascade-runtime";
import { pulled } from "./hospitals.js";

type ChatEvent = { type: string; [key: string]: unknown };
type Request = {
  system: string[];
  messages: { role: string; content?: string }[];
  tools: { name: string }[];
  signal: AbortSignal;
};
type Model = {
  provider: string;
  name: string;
  local: boolean;
  turn(request: Request): AsyncIterable<unknown>;
};
type Tools = unknown;

const {
  chatRoute,
  chatTools,
  checkBody,
  EXPLAIN_THE_THING,
  MAX_ROUNDS,
  runChat,
} = (await import(new URL("../../starter/chat.mjs", import.meta.url).href)) as {
  chatRoute: (
    request: unknown,
    response: unknown,
    options: { model: Model | undefined; tools: Tools },
  ) => Promise<void>;
  chatTools: (shared: unknown, options?: unknown) => Tools;
  checkBody: (body: unknown) => unknown;
  EXPLAIN_THE_THING: string;
  MAX_ROUNDS: number;
  runChat: (options: {
    model: Model;
    tools: Tools;
    body: unknown;
    signal: AbortSignal;
    emit: (event: ChatEvent) => void;
  }) => Promise<void>;
};
const { podTools } = (await import(
  new URL("../../starter/pod-tools.mjs", import.meta.url).href
)) as { podTools: (...options: unknown[]) => unknown };
const { changeSaid, entryId, SOURCES } = (await import(
  new URL("../../starter/summary.mjs", import.meta.url).href
)) as {
  changeSaid: (finding: unknown, about: Map<string, unknown>) => string;
  entryId: (entry: string) => string;
  SOURCES: string;
};

const STATIN = "story-statin";
const pods = new Map<string, Pod>();
let tools: Tools;
let shared: unknown;

before(async () => {
  const north = await loadHospital("cascade-north");
  const story = (await loadStories()).find(
    ({ patient }) => patient === STATIN,
  )!;
  const { pull } = await pulled(north, story.patient);
  const statin = await openPod();
  const imported = await statin.import(pullFiles(pull, "north"), {
    aboutSubject: true,
  });
  assert.equal(imported.refused, undefined);
  pods.set(STATIN, statin);
  shared = podTools(
    {
      names: async () => [...pods.keys()],
      open: async (n: string) => pods.get(n),
    },
    {
      viewOf: (pod: string, { test, medication }: Record<string, string>) =>
        `/pods/${pod}/trend?test=${test}&medication=${medication}`,
    },
  );
  tools = chatTools(shared);
});

after(async () => {
  await Promise.all([...pods.values()].map((pod) => pod.close()));
});

const call = (id: string, name: string, input: unknown) => ({
  type: "call",
  id,
  name,
  arguments: typeof input === "string" ? input : JSON.stringify(input),
});
const calling = (...calls: unknown[]) => [
  ...calls,
  { type: "done", stop: "calls" },
];
const reply = (text: string) => [
  { type: "text", text },
  { type: "done", stop: "end" },
];

/** A model over `turns`, one per request, an in-process stand-in for the model client. */
function fakeModel(turns: unknown[][], { local = true } = {}) {
  const requests: Request[] = [];
  const model: Model = {
    provider: "fake",
    name: "fake-1",
    local,
    async *turn(request) {
      requests.push({ ...request, messages: [...request.messages] });
      const events = turns[requests.length - 1];
      assert.ok(events, `no turn ${requests.length} was scripted`);
      for (const event of events) yield event;
    },
  };
  return { model, requests };
}

async function chat(
  model: Model,
  body: Record<string, unknown>,
  using: Tools = tools,
) {
  const events: ChatEvent[] = [];
  await runChat({
    model,
    tools: using,
    body: { pod: STATIN, page: `/pods/${STATIN}/`, ...body },
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });
  return events;
}

const said = (text: string) => ({
  messages: [{ role: "user", content: text }],
});
const toolEvents = (events: ChatEvent[]) =>
  events.filter(({ type }) => type === "tool");

test("a question that calls find_changes runs it: the model sees the compact finding, the events carry the finding with the keys of its rows, the page goes in its own context message, and each finding says itself in the app's own sentence", async () => {
  const { model, requests } = fakeModel([
    calling(call("c1", "find_changes", { pod: STATIN })),
    reply("LDL was lower after the statin started."),
  ]);
  const events = await chat(model, said("find anything interesting"));
  assert.deepEqual(
    events.map(({ type }) => type),
    ["start", "tool", "delta", "done"],
  );

  const [found] = toolEvents(events);
  assert.equal(found!.ok, true);
  const [finding] = found!.findings as {
    key: string;
    said: string;
    view: string;
    before: { count: number };
    after: { count: number };
    rows: { entry: string; value: string; side: string }[];
  }[];
  assert.equal(finding!.key, "start:617310:18262-6");
  assert.match(finding!.said, /^LDL.* was lower after .* started\.$/);
  assert.equal(
    finding!.view,
    `/pods/${STATIN}/trend?test=18262-6&medication=617310`,
  );
  assert.equal(
    finding!.rows.length,
    finding!.before.count + finding!.after.count,
  );
  const lab = await pods.get(STATIN)!.ask("pod/My lab results");
  const entries = new Set(lab.map((row) => entryId(row.entry!)));
  for (const row of finding!.rows) assert.ok(entries.has(row.entry), row.entry);

  const [first, second] = requests;
  assert.deepEqual(first!.messages, said("find anything interesting").messages);
  assert.ok(first!.system.some((part) => part.includes(STATIN)));
  const toolMessage = second!.messages.at(-1) as unknown as {
    role: string;
    content: string;
  };
  assert.equal(toolMessage.role, "tool");
  assert.ok(toolMessage.content.includes(finding!.key));
  assert.ok(!toolMessage.content.includes('"rows"'));
});

test("a finding says itself as the page does: named by what the tables say of its codes", async () => {
  const tool = (
    shared as {
      tools: {
        name: string;
        findings: (...a: unknown[]) => Promise<{
          found: { key: string; medication: { code: string } }[];
        }>;
      }[];
    }
  ).tools.find(({ name }) => name === "find_changes")!;
  const { found: pageFindings } = await tool.findings(
    pods.get(STATIN),
    {},
    STATIN,
  );
  const [whole] = pageFindings;
  const names = new Map([
    [
      whole!.medication.code,
      { name: { label: "atorvastatin 20 MG Oral Tablet" } },
    ],
  ]);
  const { model } = fakeModel([
    calling(call("c1", "find_changes", { pod: STATIN })),
    reply("Done."),
  ]);
  const events = await chat(
    model,
    said("find anything"),
    chatTools(shared, { namesFor: async () => names }),
  );
  const [found] = toolEvents(events);
  const finding = (found!.findings as { said: string; key: string }[]).find(
    ({ key }) => key === whole!.key,
  );
  assert.match(finding!.said, /after atorvastatin 20 MG Oral Tablet started.$/);
  assert.equal(finding!.said, changeSaid(whole, names));
});

test("open_pod, open_trend and open_entry give the address of a page that is there, and for input that names nothing there a tool error that lists what is", async () => {
  const [source] = await pods.get(STATIN)!.ask(SOURCES);
  const entry = source!.entry!;
  const table: [string, Record<string, unknown>, string | RegExp][] = [
    ["open_pod", { pod: STATIN }, `/pods/${STATIN}/`],
    ["open_pod", { pod: "nobody" }, /no pod nobody; the pods are story-statin/],
    [
      "open_trend",
      { pod: STATIN, test: "18262-6", medication: "617310" },
      `/pods/${STATIN}/trend?test=18262-6&medication=617310`,
    ],
    [
      "open_trend",
      { pod: STATIN, test: "18262-6" },
      `/pods/${STATIN}/trend?test=18262-6`,
    ],
    [
      "open_trend",
      { pod: STATIN, test: "0000-0" },
      /the tests it holds are .*18262-6/,
    ],
    [
      "open_trend",
      { pod: STATIN, test: "18262-6", medication: "aspirin" },
      /the medications it holds are .*617310/,
    ],
    [
      "open_entry",
      { pod: STATIN, entry },
      `/pods/${STATIN}/entries/${encodeURIComponent(entryId(entry))}`,
    ],
    ["open_entry", { pod: STATIN, entry: "nothing" }, /holds no entry nothing/],
  ];
  const { model } = fakeModel([
    calling(...table.map(([name, input], at) => call(`c${at}`, name, input))),
    reply("Opened."),
  ]);
  const events = await chat(model, said("show me"));
  const tool = toolEvents(events);
  assert.equal(tool.length, table.length);
  table.forEach(([name, input, expected], at) => {
    const label = `${name} ${JSON.stringify(input)}`;
    if (typeof expected === "string") {
      assert.equal(tool[at]!.ok, true, label);
      assert.equal(tool[at]!.open, expected, label);
    } else {
      assert.equal(tool[at]!.ok, false, label);
      assert.match(tool[at]!.error as string, expected, label);
      assert.equal(tool[at]!.open, undefined, label);
    }
  });
  assert.equal(events.at(-1)!.type, "done");
});

test("a tool call that cannot be run is reported to the model as a tool error, and the loop goes on: arguments that are not JSON, an unknown tool, a pod there is none of, input the schema refuses", async () => {
  const table: [string, string | Record<string, unknown>, RegExp][] = [
    ["list_pods", "{not json", /not JSON/],
    ["list_pods", "[]", /must be an object/],
    [
      "delete_pod",
      { pod: STATIN },
      /there is no tool delete_pod; the tools are/,
    ],
    ["find_changes", {}, /pod is required/],
    ["find_changes", { pod: "nobody" }, /no pod nobody/],
    ["ask", { pod: STATIN, question: "SELECT * WHERE {}" }, /must be one of/],
    ["lab_series", { pod: STATIN, test: "0000-0" }, /no test 0000-0/],
  ];
  const { model, requests } = fakeModel([
    calling(...table.map(([name, input], at) => call(`c${at}`, name, input))),
    reply("Sorry."),
  ]);
  const events = await chat(model, said("break"));
  const tool = toolEvents(events);
  assert.equal(tool.length, table.length);
  table.forEach(([name, , reason], at) => {
    assert.equal(tool[at]!.ok, false, name);
    assert.match(tool[at]!.error as string, reason, name);
  });
  assert.equal(events.at(-1)!.type, "done");
  const fed = requests[1]!.messages.filter(({ role }) => role === "tool");
  assert.equal(fed.length, table.length);
});

test("a round of tool calls past the sixth ends the loop with an error", async () => {
  const rounds = Array.from({ length: MAX_ROUNDS + 1 }, (_, at) =>
    calling(call(`c${at}`, "list_pods", {})),
  );
  const { model, requests } = fakeModel(rounds);
  const events = await chat(model, said("again"));
  assert.equal(toolEvents(events).length, MAX_ROUNDS);
  assert.equal(requests.length, MAX_ROUNDS + 1);
  assert.equal(events.at(-1)!.type, "error");
});

test("the model's refusal and its error end the chat as events of their own", async () => {
  const refused = await chat(
    fakeModel([[{ type: "refused", text: "I cannot help with that." }]]).model,
    said("hello"),
  );
  assert.deepEqual(refused.at(-1), {
    type: "refused",
    text: "I cannot help with that.",
  });
  const failed = await chat(
    fakeModel([
      [
        { type: "text", text: "Well" },
        { type: "error", status: 429, message: "rate limited" },
      ],
    ]).model,
    said("hello"),
  );
  assert.deepEqual(
    failed.map(({ type }) => type),
    ["start", "delta", "error"],
  );
});

test("a body the rules refuse is a Refusal naming what is wrong, and so is a pod there is none of; nothing is emitted", async () => {
  const good = {
    pod: STATIN,
    page: "/",
    messages: [{ role: "user", content: "hello" }],
  };
  const refused: [unknown, RegExp][] = [
    [null, /JSON object/],
    [[], /JSON object/],
    [{ ...good, extra: 1 }, /extra is not a property/],
    [{ ...good, pod: 3 }, /pod must be/],
    [{ ...good, page: "https://elsewhere.test/" }, /page must be an address/],
    [{ ...good, messages: [] }, /at least one message/],
    [{ ...good, messages: "hi" }, /at least one message/],
    [
      { ...good, messages: [{ role: "system", content: "x" }] },
      /messages\[0\]/,
    ],
    [{ ...good, messages: [{ role: "user", content: "" }] }, /messages\[0\]/],
    [
      { ...good, messages: [{ role: "assistant", content: "x" }] },
      /the last message must be the person's/,
    ],
    [
      { ...good, messages: [{ role: "user", content: "x".repeat(100_001) }] },
      /characters in all/,
    ],
    [{ ...good, context: "text" }, /context must be/],
    [{ ...good, context: { about: "x" } }, /context must be/],
    [{ ...good, context: { kind: "person", id: "x" } }, /context must be/],
    [
      { ...good, context: { kind: "finding", key: "x", id: "y" } },
      /context must be/,
    ],
    [{ ...good, context: { kind: "finding" } }, /context must be/],
    [{ ...good, context: { kind: "entry", id: 7 } }, /context must be/],
    [{ ...good, context: { kind: "worth" } }, /context must be/],
    [
      { ...good, context: { kind: "worth", entry: "e1", sentence: "x" } },
      /context must be/,
    ],
    [
      { ...good, context: { kind: "trend", test: "t", medication: 7 } },
      /context must be/,
    ],
    [
      { ...good, context: { kind: "finding", key: "x".repeat(201) } },
      /context must be/,
    ],
    [{ ...good, pod: "x".repeat(201) }, /pod must be/],
    [{ ...good, page: `/${"x".repeat(2000)}` }, /page must be an address/],
    [
      {
        ...good,
        messages: Array.from({ length: 101 }, () => ({
          role: "user",
          content: "x",
        })),
      },
      /at most 100 messages/,
    ],
  ];
  for (const [body, reason] of refused)
    assert.throws(
      () => checkBody(body),
      (error) => error instanceof Refusal && reason.test(error.message),
      JSON.stringify(body),
    );
  assert.doesNotThrow(() => checkBody(good));
  assert.doesNotThrow(() =>
    checkBody({ ...good, context: { kind: "worth", entry: "e1" } }),
  );

  const events: ChatEvent[] = [];
  await assert.rejects(
    runChat({
      model: fakeModel([]).model,
      tools,
      body: { ...good, pod: "nobody" },
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    }),
    /there is no pod nobody/,
  );
  assert.deepEqual(events, []);
});

/** `chatRoute` served on a loopback port, over `model`. */
async function served(model: Model | undefined) {
  const server: Server = createServer((request, response) => {
    void chatRoute(request, response, { model, tools });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/chat`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

const post = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });

test("POST /chat streams the events as NDJSON; a body the rules refuse is 400 with the reason, no model set is 503, and an error of its own is an error event with a fixed message", async (t) => {
  const { model } = fakeModel([
    calling(call("c1", "open_pod", { pod: STATIN })),
    reply("Opened."),
  ]);
  const running = await served(model);
  const ok = await post(running.url, {
    pod: STATIN,
    page: "/",
    ...said("open it"),
  });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type")!, /^application\/x-ndjson/);
  const lines = (await ok.text()).trim().split("\n");
  assert.deepEqual(
    lines.map((line) => (JSON.parse(line) as ChatEvent).type),
    ["start", "tool", "delta", "done"],
  );

  for (const body of ["{not json", { pod: STATIN }]) {
    const refused = await post(running.url, body);
    assert.equal(refused.status, 400);
    assert.ok(((await refused.json()) as { error: string }).error.length > 0);
  }
  const huge = await post(running.url, `{"x":"${"x".repeat(1024 * 1024)}"}`);
  assert.equal(huge.status, 400);
  assert.match(((await huge.json()) as { error: string }).error, /at most/);
  await running.close();

  const none = await served(undefined);
  assert.equal((await post(none.url, {})).status, 503);
  await none.close();

  t.mock.method(console, "error", () => {});
  const broken: Model = {
    provider: "fake",
    name: "fake-1",
    local: true,
    // eslint-disable-next-line require-yield
    async *turn() {
      throw new Error("ENOENT: open 'C:/private/path'");
    },
  };
  const failing = await served(broken);
  const failed = await post(failing.url, {
    pod: STATIN,
    page: "/",
    ...said("hello"),
  });
  const events = (await failed.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ChatEvent);
  assert.equal(events.at(-1)!.type, "error");
  assert.doesNotMatch(JSON.stringify(events), /private/);
  await failing.close();
});

test("a request that closes before the answer ends aborts the call to the model", async () => {
  let aborted!: () => void;
  const sawAbort = new Promise<void>((resolve) => (aborted = resolve));
  const waiting: Model = {
    provider: "fake",
    name: "fake-1",
    local: true,
    async *turn({ signal }) {
      yield { type: "text", text: "Let me" };
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      aborted();
    },
  };
  const running = await served(waiting);
  const stop = new AbortController();
  const response = await post(
    running.url,
    { pod: STATIN, page: "/", ...said("hello") },
    stop.signal,
  );
  const reader = response.body!.getReader();
  await reader.read();
  stop.abort();
  await sawAbort;
  await running.close();
});

test("a chat that began with Ask about this tells the model the thing it asked about and to explain the thing, never the person; a chat with no context is told neither", async () => {
  const context = { kind: "finding", key: "start:617310:18262-6" };
  const { model, requests } = fakeModel([reply("Done."), reply("Done.")]);
  await chat(model, { ...said("tell me about this"), context });
  await chat(model, said("tell me about this"));
  const [asked, plain] = requests.map(({ system }) => system.join("\n"));
  assert.ok(asked!.includes(JSON.stringify(context)));
  assert.ok(asked!.includes(EXPLAIN_THE_THING));
  assert.ok(!plain!.includes(EXPLAIN_THE_THING));
  assert.doesNotMatch(plain!, /asked about this/);
});
