import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { after, before, test } from "node:test";
import { Refusal } from "cascade-runtime";

interface Event {
  type: string;
  [field: string]: unknown;
}
interface Model {
  provider: string;
  name: string;
  local: boolean;
  turn(input: {
    system: string[];
    messages: object[];
    tools: object[];
    signal?: AbortSignal;
  }): AsyncIterable<Event>;
}
interface Settings {
  provider: string;
  url?: string;
  name?: string;
  key?: string;
}
interface Terminal {
  out(text: string): void;
  err(text: string): void;
  ask(question: string): Promise<string>;
  secret(question: string): Promise<string>;
}

const { modelClient, modelFrom } = (await import(
  new URL("../../starter/model-client.mjs", import.meta.url).href
)) as {
  modelClient(settings: Settings): Model;
  modelFrom(env: Record<string, string>): Model | undefined;
};
const { check, flow, save, remove } = (await import(
  new URL("../../starter/model.mjs", import.meta.url).href
)) as {
  save(folder: string, values: Record<string, string>): Promise<void>;
  remove(folder: string): Promise<boolean>;
  check(model: Model): Promise<{ ok: boolean; reason?: string }>;
  flow(args: string[], terminal: Terminal, folder: string): Promise<number>;
};

const KEY = "sk-TESTSECRET-1234";

/** What a stub server answers: a status and either a JSON body or the server-sent events of a stream. */
type Reply = {
  status?: number;
  json?: object;
  events?: [string, object][];
  stall?: boolean;
};

/** A loopback stub of a provider's API: answers every request with what `reply` says and keeps each request's body. */
async function stub(reply: () => Reply): Promise<{
  url: string;
  bodies: Record<string, unknown>[];
  headers: Record<string, unknown>[];
  server: Server;
}> {
  const bodies: Record<string, unknown>[] = [];
  const headers: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      bodies.push(JSON.parse(text) as Record<string, unknown>);
      headers.push(request.headers);
      const { status = 200, json, events, stall } = reply();
      if (json) {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(json));
        return;
      }
      response.writeHead(status, { "content-type": "text/event-stream" });
      for (const [name, data] of events ?? [])
        response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      if (!stall) response.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, bodies, headers, server };
}

const delta = (
  fields: object,
  finish: string | null = null,
): [string, object] => [
  "message",
  { choices: [{ index: 0, delta: fields, finish_reason: finish }] },
];

const openai = {
  call: (withId = true): Reply => ({
    events: [
      delta({
        tool_calls: [
          {
            index: 0,
            ...(withId ? { id: "c1" } : {}),
            type: "function",
            function: { name: "note_word", arguments: "" },
          },
        ],
      }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"wo' } }] }),
      delta({
        tool_calls: [{ index: 0, function: { arguments: 'rd":"ready"}' } }],
      }),
      delta({}, "tool_calls"),
    ],
  }),
  badCall: (): Reply => ({
    events: [
      delta({
        tool_calls: [
          {
            index: 0,
            id: "c1",
            type: "function",
            function: { name: "note_word", arguments: '{"word":3}' },
          },
        ],
      }),
      delta({}, "tool_calls"),
    ],
  }),
  text: (): Reply => ({
    events: [
      delta({ content: "Hel" }),
      delta({ content: "lo" }),
      delta({}, "stop"),
    ],
  }),
  length: (): Reply => ({
    events: [delta({ content: "Hel" }), delta({}, "length")],
  }),
  refusal: (): Reply => ({
    events: [delta({ refusal: "No." }), delta({}, "stop")],
  }),
  unauthorized: (): Reply => ({
    status: 401,
    json: { error: { message: `Incorrect API key provided: ${KEY}` } },
  }),
};

const sse = (type: string, fields: object): [string, object] => [
  type,
  { type, ...fields },
];

const anthropic = {
  call: (word: string | number = "ready"): Reply => ({
    events: [
      sse("message_start", {
        message: {
          id: "m1",
          type: "message",
          role: "assistant",
          content: [],
          model: "stub",
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
      sse("content_block_start", {
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tu1",
          name: "note_word",
          input: {},
        },
      }),
      sse("content_block_delta", {
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: `{"word":`,
        },
      }),
      sse("content_block_delta", {
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: `${JSON.stringify(word)}}`,
        },
      }),
      sse("content_block_stop", { index: 0 }),
      sse("message_delta", {
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 5 },
      }),
      sse("message_stop", {}),
    ],
  }),
  text: (stop = "end_turn"): Reply => ({
    events: [
      sse("message_start", {
        message: {
          id: "m1",
          type: "message",
          role: "assistant",
          content: [],
          model: "stub",
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
      sse("content_block_start", {
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      sse("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      sse("content_block_stop", { index: 0 }),
      sse("message_delta", {
        delta: { stop_reason: stop, stop_sequence: null },
        usage: { output_tokens: 5 },
      }),
      sse("message_stop", {}),
    ],
  }),
  unauthorized: (): Reply => ({
    status: 401,
    json: {
      type: "error",
      error: {
        type: "authentication_error",
        message: `invalid x-api-key ${KEY}`,
      },
    },
  }),
};

/** Every event of one turn. */
async function events(model: Model, signal?: AbortSignal): Promise<Event[]> {
  const seen: Event[] = [];
  for await (const event of model.turn({
    system: ["rules", "context"],
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    signal,
  }))
    seen.push(event);
  return seen;
}

const stubs: Server[] = [];
let folder: string;

async function serving(reply: () => Reply) {
  const made = await stub(reply);
  stubs.push(made.server);
  return made;
}

before(async () => {
  folder = await mkdtemp(join(tmpdir(), "model-"));
});

after(async () => {
  for (const server of stubs) server.close();
  await rm(folder, { recursive: true, force: true });
});

test("an OpenAI-compatible turn streams text, assembles a call from its fragments and says why it stopped", async () => {
  const cases: [string, () => Reply, Event[]][] = [
    [
      "a call",
      openai.call,
      [
        {
          type: "call",
          id: "c1",
          name: "note_word",
          arguments: '{"word":"ready"}',
        },
        { type: "done", stop: "calls" },
      ],
    ],
    [
      "a call the server gave no ID",
      () => openai.call(false),
      [
        {
          type: "call",
          id: "call_0",
          name: "note_word",
          arguments: '{"word":"ready"}',
        },
        { type: "done", stop: "calls" },
      ],
    ],
    [
      "text",
      openai.text,
      [
        { type: "text", text: "Hel" },
        { type: "text", text: "lo" },
        { type: "done", stop: "end" },
      ],
    ],
    [
      "a cut-off answer",
      openai.length,
      [
        { type: "text", text: "Hel" },
        { type: "done", stop: "length" },
      ],
    ],
    [
      "two calls the server gave no index, the first with Gemini's thought signature",
      () => ({
        events: [
          delta({
            tool_calls: [
              {
                id: "a",
                type: "function",
                function: { name: "one", arguments: "{}" },
                extra_content: { google: { thought_signature: "sig" } },
              },
              {
                id: "b",
                type: "function",
                function: { name: "two", arguments: '{"x":1}' },
              },
            ],
          }),
          delta({}, "tool_calls"),
        ],
      }),
      [
        {
          type: "call",
          id: "a",
          name: "one",
          arguments: "{}",
          extra: { google: { thought_signature: "sig" } },
        },
        { type: "call", id: "b", name: "two", arguments: '{"x":1}' },
        { type: "done", stop: "calls" },
      ],
    ],
    ["a refusal", openai.refusal, [{ type: "refused", text: "No." }]],
    [
      "a bad key, which the provider echoes back",
      openai.unauthorized,
      [{ type: "error", status: 401, message: "" }],
    ],
  ];
  for (const [what, reply, expected] of cases) {
    const { url } = await serving(reply);
    const model = modelClient({
      provider: "groq",
      url: `${url}/v1`,
      name: "m",
      key: KEY,
    });
    const seen = await events(model);
    if (expected[0]!.type === "error") {
      assert.equal(seen.length, 1, what);
      assert.equal(seen[0]!.status, 401, what);
      assert.ok(
        !String(seen[0]!.message).includes(KEY),
        "the error shows the key",
      );
      assert.match(String(seen[0]!.message), /Incorrect API key/, what);
    } else assert.deepEqual(seen, expected, what);
  }
});

test("no server at the address is an error event, and an aborted turn ends with no event", async () => {
  const { url, server } = await serving(openai.text);
  const address = `${url}/v1`;
  await new Promise((done) => server.close(done));
  const down = modelClient({ provider: "local", url: address, name: "m" });
  const [error, ...rest] = await events(down);
  assert.equal(error!.type, "error");
  assert.match(String(error!.message), /ECONNREFUSED|onnection/);
  assert.deepEqual(rest, []);

  const live = await serving(openai.text);
  const model = modelClient({
    provider: "local",
    url: `${live.url}/v1`,
    name: "m",
  });
  assert.deepEqual(await events(model, AbortSignal.abort()), []);

  const cut = (full: Reply): Reply => ({
    events: full.events!.slice(0, -1),
    stall: true,
  });
  for (const [provider, reply, path] of [
    ["local", cut(openai.call()), "/v1"],
    ["anthropic", cut(anthropic.call()), ""],
  ] as const) {
    const stalled = await serving(() => reply);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 400);
    const model = modelClient({
      provider,
      url: `${stalled.url}${path}`,
      name: "m",
      key: KEY,
    });
    assert.deepEqual(
      await events(model, controller.signal),
      [],
      `${provider}: an abort in mid-stream ends the turn with no event`,
    );
  }
});

test("an OpenAI-compatible request carries the system parts as one message, the tools, the calls and their results; only a model on this computer or another address is told not to think", async () => {
  const messages = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "",
      calls: [
        { id: "c1", name: "list_pods", arguments: "{}" },
        {
          id: "c2",
          name: "list_pods",
          arguments: "{}",
          extra: { google: { thought_signature: "sig" } },
        },
      ],
    },
    { role: "tool", id: "c1", content: "[]" },
    { role: "tool", id: "c2", content: "[]" },
  ];
  const tools = [
    {
      name: "list_pods",
      description: "Lists.",
      inputSchema: { type: "object" },
    },
  ];
  const sent = new Map<string, Record<string, unknown>>();
  for (const provider of ["groq", "local", "other"]) {
    const { url, bodies } = await serving(openai.text);
    const model = modelClient({
      provider,
      url: `${url}/v1`,
      name: "m",
      key: KEY,
    });
    for await (const event of model.turn({
      system: ["rules", "context"],
      messages,
      tools,
    }))
      void event;
    sent.set(provider, bodies[0]!);
  }
  const groq = sent.get("groq")!;
  assert.equal(groq.model, "m");
  assert.deepEqual(groq.messages, [
    { role: "system", content: "rules\n\ncontext" },
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "list_pods", arguments: "{}" },
        },
        {
          id: "c2",
          type: "function",
          function: { name: "list_pods", arguments: "{}" },
          extra_content: { google: { thought_signature: "sig" } },
        },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "[]" },
    { role: "tool", tool_call_id: "c2", content: "[]" },
  ]);
  assert.deepEqual(groq.tools, [
    {
      type: "function",
      function: {
        name: "list_pods",
        description: "Lists.",
        parameters: { type: "object" },
      },
    },
  ]);
  const thinking = (provider: string) =>
    (sent.get(provider)!.chat_template_kwargs as object | undefined) ?? null;
  assert.equal(thinking("groq"), null);
  assert.deepEqual(thinking("local"), { enable_thinking: false });
  assert.deepEqual(thinking("other"), { enable_thinking: false });
});

test("an Anthropic turn streams text, assembles a call, and reports a refusal and an error", async () => {
  const cases: [string, () => Reply, Event[]][] = [
    [
      "a call",
      anthropic.call,
      [
        {
          type: "call",
          id: "tu1",
          name: "note_word",
          arguments: '{"word":"ready"}',
        },
        { type: "done", stop: "calls" },
      ],
    ],
    [
      "text",
      anthropic.text,
      [
        { type: "text", text: "Hello" },
        { type: "done", stop: "end" },
      ],
    ],
    [
      "a cut-off answer",
      () => anthropic.text("max_tokens"),
      [
        { type: "text", text: "Hello" },
        { type: "done", stop: "length" },
      ],
    ],
    [
      "a refusal",
      () => anthropic.text("refusal"),
      [
        { type: "text", text: "Hello" },
        { type: "refused", text: "The model declined to answer." },
      ],
    ],
  ];
  for (const [what, reply, expected] of cases) {
    const { url } = await serving(reply);
    const model = modelClient({
      provider: "anthropic",
      url,
      name: "m",
      key: KEY,
    });
    assert.deepEqual(await events(model), expected, what);
  }
  const { url } = await serving(anthropic.unauthorized);
  const [error, ...rest] = await events(
    modelClient({ provider: "anthropic", url, name: "m", key: KEY }),
  );
  assert.equal(error!.status, 401);
  assert.ok(!String(error!.message).includes(KEY), "the error shows the key");
  assert.deepEqual(rest, []);
});

test("an Anthropic request carries system text blocks, the tools, and consecutive tool results as one user message", async () => {
  const { url, bodies, headers } = await serving(anthropic.text);
  const model = modelClient({
    provider: "anthropic",
    url,
    name: "m",
    key: KEY,
  });
  process.env.ANTHROPIC_AUTH_TOKEN = "OTHER-CREDENTIAL";
  for await (const event of model.turn({
    system: ["rules", "context"],
    messages: [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "Looking.",
        calls: [
          { id: "a", name: "list_pods", arguments: "{}" },
          { id: "b", name: "list_pods", arguments: '{"x":1}' },
        ],
      },
      { role: "tool", id: "a", content: "[]" },
      { role: "tool", id: "b", content: "boom", isError: true },
    ],
    tools: [
      {
        name: "list_pods",
        description: "Lists.",
        inputSchema: { type: "object" },
      },
    ],
  }))
    void event;
  const body = bodies[0]!;
  assert.deepEqual(body.system, [
    { type: "text", text: "rules" },
    { type: "text", text: "context" },
  ]);
  assert.deepEqual(body.tools, [
    {
      name: "list_pods",
      description: "Lists.",
      input_schema: { type: "object" },
    },
  ]);
  assert.deepEqual(body.messages, [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Looking." },
        { type: "tool_use", id: "a", name: "list_pods", input: {} },
        { type: "tool_use", id: "b", name: "list_pods", input: { x: 1 } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "[]" },
        {
          type: "tool_result",
          tool_use_id: "b",
          content: "boom",
          is_error: true,
        },
      ],
    },
  ]);
  assert.equal(headers[0]!["x-api-key"], KEY);
  assert.equal(headers[0]!.authorization, undefined);
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

test("the settings make a model, none make nothing, and no property of a model shows its key", () => {
  assert.equal(modelFrom({}), undefined);
  const model = modelFrom({
    CASCADE_MODEL_PROVIDER: "local",
    CASCADE_MODEL_URL: "http://127.0.0.1:1234/v1",
    CASCADE_MODEL_NAME: "qwen",
    CASCADE_MODEL_KEY: KEY,
  })!;
  assert.deepEqual(
    { provider: model.provider, name: model.name, local: model.local },
    { provider: "local", name: "qwen", local: true },
  );
  assert.ok(!JSON.stringify(model).includes(KEY));
  assert.ok(!Object.values(model).some((value) => value === KEY));
  const hosts: [string, boolean][] = [
    ["http://localhost:11434/v1", true],
    ["http://127.5.0.1:8080/v1", true],
    ["http://[::1]:8080/v1", true],
    ["https://api.groq.com/openai/v1", false],
    ["http://192.168.1.5:8080/v1", false],
  ];
  for (const [url, local] of hosts)
    assert.equal(
      modelClient({ provider: "other", url, name: "m" }).local,
      local,
      url,
    );
  const refusals: [string, Record<string, string>, RegExp][] = [
    [
      "an unknown provider",
      { CASCADE_MODEL_PROVIDER: "gpt" },
      /unknown model provider/,
    ],
    [
      "a hosted provider with no key",
      { CASCADE_MODEL_PROVIDER: "groq" },
      /KEY is not set/,
    ],
    [
      "another address with none",
      { CASCADE_MODEL_PROVIDER: "other" },
      /needs an address/,
    ],
    [
      "a key and no provider",
      { CASCADE_MODEL_KEY: KEY },
      /PROVIDER is not set/,
    ],
  ];
  for (const [what, env, reason] of refusals)
    assert.throws(
      () => modelFrom(env),
      (error) => error instanceof Refusal && reason.test(error.message),
      what,
    );
  assert.equal(
    modelFrom({ CASCADE_MODEL_PROVIDER: "groq", CASCADE_MODEL_KEY: KEY })!.name,
    "openai/gpt-oss-120b",
  );
});

test("the check passes only when the model calls the tool with arguments its schema accepts, and says why otherwise", async () => {
  const cases: [string, "openai" | "anthropic", () => Reply, RegExp | true][] =
    [
      ["a call", "openai", openai.call, true],
      ["a call", "anthropic", anthropic.call, true],
      ["text", "openai", openai.text, /answers, but does not call tools/],
      ["text", "anthropic", anthropic.text, /answers, but does not call tools/],
      [
        "a bad key",
        "openai",
        openai.unauthorized,
        /the provider said: .*Incorrect API key/,
      ],
      [
        "a bad key",
        "anthropic",
        anthropic.unauthorized,
        /the provider said: .*invalid x-api-key/,
      ],
      [
        "arguments of the wrong type",
        "openai",
        openai.badCall,
        /does not accept.*must be a string/,
      ],
      [
        "arguments of the wrong type",
        "anthropic",
        () => anthropic.call(3),
        /does not accept.*must be a string/,
      ],
    ];
  for (const [what, protocol, reply, expected] of cases) {
    const { url } = await serving(reply);
    const model =
      protocol === "openai"
        ? modelClient({
            provider: "other",
            url: `${url}/v1`,
            name: "m",
            key: KEY,
          })
        : modelClient({ provider: "anthropic", url, name: "m", key: KEY });
    const result = await check(model);
    const label = `${what} (${protocol})`;
    if (expected === true) assert.deepEqual(result, { ok: true }, label);
    else {
      assert.equal(result.ok, false, label);
      assert.match(result.reason!, expected, label);
      assert.ok(!result.reason!.includes(KEY), `${label} shows the key`);
    }
  }
});

/** A terminal answering from a script, and keeping everything it was shown. */
function scripted(asks: string[], secrets: string[] = []) {
  const shown: string[] = [];
  const terminal: Terminal = {
    out: (text) => shown.push(text),
    err: (text) => shown.push(text),
    ask: async (question) => {
      shown.push(question);
      return asks.shift() ?? "";
    },
    secret: async (question) => {
      shown.push(question);
      return secrets.shift() ?? "";
    },
  };
  return { terminal, text: () => shown.join("") };
}

const envIn = async (path: string) => parseEnv(await readFile(path, "utf8"));

const settingsIn = async (path: string) =>
  Object.fromEntries(
    Object.entries(await envIn(path)).filter(([name]) =>
      name.startsWith("CASCADE_MODEL_"),
    ),
  );

test("the flow keeps the four settings in .env after a model that calls a tool, never shows the key, and --off removes only them", async () => {
  const app = await mkdtemp(join(folder, "app-"));
  const env = join(app, ".env");
  await writeFile(env, "KEEP=1\n");
  const good = await serving(openai.call);
  const run = scripted(["6", `${good.url}/v1`, "stub-model"], [KEY]);
  assert.equal(await flow([], run.terminal, app), 0);
  assert.deepEqual(await settingsIn(env), {
    CASCADE_MODEL_PROVIDER: "other",
    CASCADE_MODEL_URL: `${good.url}/v1`,
    CASCADE_MODEL_NAME: "stub-model",
    CASCADE_MODEL_KEY: KEY,
  });
  assert.match(await readFile(env, "utf8"), /^KEEP=1$/m);
  assert.ok(!run.text().includes(KEY), "the key was shown");
  assert.equal(good.headers[0]!.authorization, `Bearer ${KEY}`);

  assert.equal(await flow(["--off"], scripted([]).terminal, app), 0);
  assert.deepEqual(await envIn(env), { KEEP: "1" });
});

test("the settings are kept in .env as process.loadEnvFile reads them back, in the file's own line endings, and a value that cannot be is refused", async () => {
  const app = await mkdtemp(join(folder, "app-"));
  const env = join(app, ".env");
  const settings = (url: string, key: string) => ({
    CASCADE_MODEL_PROVIDER: "other",
    CASCADE_MODEL_URL: url,
    CASCADE_MODEL_NAME: "a name # with 'both' quotes",
    CASCADE_MODEL_KEY: key,
  });
  await writeFile(env, "KEEP=1\r\nOTHER=2\r\n");
  for (const key of ['k"e y#1', "k'e y#1", "plain"]) {
    await save(app, settings("http://h/v1", key));
    const text = await readFile(env, "utf8");
    assert.ok(!/(^|[^\r])\n/.test(text), "a line lost its CR");
    assert.deepEqual(await envIn(env), {
      KEEP: "1",
      OTHER: "2",
      ...settings("http://h/v1", key),
    });
  }
  await assert.rejects(
    save(app, settings("http://h/v1", `a"b'c`)),
    (error) => error instanceof Refusal,
  );
  assert.equal(await remove(app), true);
  assert.deepEqual(await envIn(env), { KEEP: "1", OTHER: "2" });
  assert.equal(await remove(app), false);
  assert.ok((await readFile(env, "utf8")).includes("\r\n"));
});

test("the flow changes nothing for a model that does not call tools or a key the provider refuses, whose message does not show the key either", async () => {
  const app = await mkdtemp(join(folder, "app-"));
  const env = join(app, ".env");
  for (const [reply, said] of [
    [openai.text, /does not call tools/],
    [openai.unauthorized, /Incorrect API key/],
  ] as const) {
    const { url } = await serving(reply);
    const run = scripted(["6", `${url}/v1`, "m", "n"], [KEY]);
    assert.equal(await flow([], run.terminal, app), 1);
    assert.match(run.text(), said);
    assert.ok(!run.text().includes(KEY), "the key was shown");
    await assert.rejects(readFile(env), { code: "ENOENT" });
  }
});

test("the flow says a free provider's terms and where to make its key, and writes nothing without one", async () => {
  const app = await mkdtemp(join(folder, "app-"));
  const run = scripted(["2"], [""]);
  assert.equal(await flow([], run.terminal, app), 2);
  assert.match(run.text(), /https:\/\/console\.groq\.com\/keys/);
  assert.match(run.text(), /30 days/);
  assert.match(run.text(), /story pods, not a person's own/);
  await assert.rejects(readFile(join(app, ".env")), { code: "ENOENT" });
});
