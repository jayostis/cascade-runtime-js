// The app's chat: a person's question goes to the model the app was set up with (`model-client.mjs`), which may call the
// tools over the pods (`pod-tools.mjs`) and the tools that open the app's own pages, for up to `MAX_ROUNDS` rounds.
// `chatRoute` is `POST /chat`; `runChat` the loop, which tells what happens as events.
import { Buffer } from "node:buffer";
import console from "node:console";
import { checkInput, labSeriesIn, Refusal, timelineIn } from "cascade-runtime";
import { podPath, trendPath } from "./pods.mjs";
import { withPod } from "./pod-tools.mjs";
import {
  CHANGED,
  changeSaid,
  entryId,
  HISTORY,
  LABS,
  SOURCES,
  testsIn,
  TREND_VIEW,
} from "./summary.mjs";

/** How many rounds of tool calls a chat runs before it ends with an error. */
export const MAX_ROUNDS = 6;
const MAX_MESSAGES = 100;
const MAX_CHARACTERS = 100_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CONTEXT = 200;

/** The rules the model is given, apart from where the person is. */
export const RULES = `You answer questions about the health records in the pods of this app, for the person who owns them.
Every number, date and name you give comes from a tool's result, never from memory or estimate. Say when a tool finds nothing.
A finding says what changed after what: a test's results were lower or higher after a medication started or stopped. It never says why, never that the medication caused the change, and never advice about what to do. A clinician can say why.
A record's date is a fact of the record. Never call a date "in the future" or "in the past" because of what you believe the date today to be.
Write plain text with no links and no markdown. The app shows a finding's rows under your answer, and open_trend, open_entry and open_pod move the app to a page: use them when the person asks to see something.`;

/** What a chat that began with "Ask about this" is also told: its answer is about the thing, not the person. */
export const EXPLAIN_THE_THING =
  "Explain the thing the person asked about, never the person: say what the records show of it, and nothing of the person's habits, choices or character.";

const NO_POD = "No pod is open.";

/** The context message of a turn: where the person is, apart from their words. */
function contextOf({ pod, page }) {
  return `${pod === "" ? NO_POD : `The person is looking at the pod ${pod}.`} The page on screen is ${page}.`;
}

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const CONTEXT_KEYS = {
  finding: ["key"],
  entry: ["id"],
  trend: ["test", "medication"],
  worth: ["entry"],
};

/** The shapes the "Ask about this" buttons send; the text reaches the system prompt, so nothing else passes. */
function checkContext(context) {
  const keys = isObject(context) ? CONTEXT_KEYS[context.kind] : undefined;
  if (
    keys === undefined ||
    Object.keys(context).some((key) => key !== "kind" && !keys.includes(key)) ||
    keys.some((key) =>
      context[key] === undefined
        ? key !== "medication"
        : typeof context[key] !== "string" ||
          context[key] === "" ||
          context[key].length > MAX_CONTEXT,
    )
  )
    throw new Refusal(
      `context must be { kind: "finding", key }, { kind: "entry", id }, { kind: "trend", test, medication? } or { kind: "worth", entry }, each value a text of at most ${MAX_CONTEXT} characters`,
    );
}

/**
 * The body of `POST /chat`: `pod` (the name of the pod the page is about, or "" for none), `page` (its address),
 * `messages` (what the person and the model said, `user` and `assistant` text only, the last the person's),
 * optionally `context` (what an "Ask about this" is about).
 *
 * @throws Refusal saying what is wrong.
 */
export function checkBody(body) {
  if (!isObject(body)) throw new Refusal("the body must be a JSON object");
  for (const key of Object.keys(body))
    if (!["pod", "page", "messages", "context"].includes(key))
      throw new Refusal(`${key} is not a property of the body`);
  const { pod, page, messages, context } = body;
  if (typeof pod !== "string" || pod.length > 200)
    throw new Refusal("pod must be a pod's name, or an empty string for none");
  if (typeof page !== "string" || !page.startsWith("/") || page.length > 2000)
    throw new Refusal("page must be an address on this app, starting with /");
  if (!Array.isArray(messages) || messages.length === 0)
    throw new Refusal("messages must be a list with at least one message");
  if (messages.length > MAX_MESSAGES)
    throw new Refusal(`messages must be at most ${MAX_MESSAGES} messages`);
  let characters = 0;
  messages.forEach((message, at) => {
    if (
      !isObject(message) ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content === ""
    )
      throw new Refusal(
        `messages[${at}] must be a user or assistant message with text`,
      );
    characters += message.content.length;
  });
  if (characters > MAX_CHARACTERS)
    throw new Refusal(
      `messages must be at most ${MAX_CHARACTERS} characters in all`,
    );
  if (messages.at(-1).role !== "user")
    throw new Refusal("the last message must be the person's");
  if (context !== undefined) checkContext(context);
  return {
    pod,
    page,
    messages: messages.map(({ role, content }) => ({ role, content })),
    ...(context === undefined ? {} : { context }),
  };
}

/** An entry's address: `entry` as `ask` gives it, an IRI, or just its ID. */
export const entryPath = (name, entry) =>
  `${podPath(name)}entries/${encodeURIComponent(entryId(entry))}`;

const unique = (items) => [...new Set(items)];

/** What the page says of a finding (`changeSaid`), named by `about`; nothing where there were not enough results. */
function saidOf(finding, about) {
  return CHANGED[finding.kind]?.[finding.direction] === undefined
    ? undefined
    : changeSaid(finding, about);
}

/** A finding's rows as a card shows them: each lab result by its entry's ID. */
function rowsOf({ rows }) {
  return ["before", "after"].flatMap((side) =>
    rows[side].map((row) => ({
      entry: entryId(row.entry ?? ""),
      performed: row.performed,
      value: row.value,
      unit: row.unit,
      side,
    })),
  );
}

/** The tools that move the app. A chat reaches them; an MCP client cannot move the app. */
const OPEN_TOOLS = [
  {
    name: "open_pod",
    description: "Opens a pod's page in the app.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async run(_pod, _input, name) {
      return { opened: podPath(name) };
    },
  },
  {
    name: "open_trend",
    description: TREND_VIEW.description,
    inputSchema: TREND_VIEW.inputSchema,
    async run(pod, { test, medication }, name) {
      const [labs, medications] = await Promise.all([
        pod.ask(LABS),
        pod.ask(HISTORY),
      ]);
      let series;
      try {
        series = labSeriesIn(labs, test);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        const held = testsIn(labs).map(
          ({ code, notation, name: label }) =>
            `${notation ?? code}${label === undefined ? "" : ` (${label})`}`,
        );
        throw new Refusal(
          `${error.message}; ${held.length === 0 ? "it holds no test results" : `the tests it holds are ${held.join(", ")}`}`,
        );
      }
      let drug;
      if (medication !== undefined && medication !== "") {
        const held = timelineIn(medications);
        const wanted = medication.toLowerCase();
        const found = held.find(
          (each) =>
            each.notation === medication ||
            each.code === medication ||
            each.name.toLowerCase() === wanted,
        );
        if (found === undefined) {
          const names = unique(held.map((each) => each.notation ?? each.name));
          throw new Refusal(
            `no medication ${medication} in the pod; ${names.length === 0 ? "it holds no medications" : `the medications it holds are ${names.join(", ")}`}`,
          );
        }
        drug = found.notation ?? found.name;
      }
      return {
        opened: trendPath(name, {
          test: series.test.notation ?? series.test.code,
          ...(drug ? { medication: drug } : {}),
        }),
      };
    },
  },
  {
    name: "open_entry",
    description:
      "Opens the page of one entry of a pod: what it is and where it came from.",
    inputSchema: {
      type: "object",
      properties: {
        entry: {
          type: "string",
          description:
            "The entry's IRI or ID, as the entry column of the rows of ask gives it.",
        },
      },
      required: ["entry"],
      additionalProperties: false,
    },
    async run(pod, { entry }, name) {
      const rows = await pod.ask(SOURCES);
      if (!rows.some((row) => entryId(row.entry) === entryId(entry)))
        throw new Refusal(
          `the pod ${name} holds no entry ${entry}; ask's rows give each entry's ID in their entry column`,
        );
      return { opened: entryPath(name, entry) };
    },
  },
];

const toolError = (reason) => ({ text: reason, isError: true });

/**
 * The tools a chat reaches: `shared` is `podTools(...)`. `specs` is what the model is told of them; `run(name,
 * rawArguments)` runs one call of the model and gives `{ text, isError, value, findings?, open? }`. Input the rules
 * refuse is `isError`, for the model to read; nothing here throws for it. `namesFor(pod, findings)` gives what the
 * tables say of the findings' codes (the page's `about`), so a finding says itself as the page does; without it, by the
 * records' own text.
 */
export function chatTools(shared, { namesFor } = {}) {
  const tools = [...shared.tools, ...OPEN_TOOLS].map((tool) => ({
    ...tool,
    inputSchema: withPod(tool),
  }));
  const specs = [
    {
      name: shared.list.name,
      description: shared.list.description,
      inputSchema: shared.list.inputSchema,
    },
    ...tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  ];

  async function runTool(tool, input) {
    const { pod: name, ...rest } = input;
    const pod = await shared.podNamed(name);
    if (tool.name === "find_changes") {
      const { value, found } = await tool.findings(pod, rest, name);
      const about = await namesFor?.(pod, found);
      return {
        value,
        findings: value.map((finding) => {
          const whole = found.find(({ key }) => key === finding.key);
          return {
            ...finding,
            said: saidOf(whole, about),
            rows: rowsOf(whole),
          };
        }),
      };
    }
    const value = await tool.run(pod, rest, name);
    return {
      value,
      ...(tool.name.startsWith("open_") ? { open: value.opened } : {}),
    };
  }

  async function run(name, rawArguments) {
    let input;
    try {
      input = rawArguments === "" ? {} : JSON.parse(rawArguments);
    } catch (error) {
      return toolError(`the arguments are not JSON: ${error.message}`);
    }
    const listing = name === shared.list.name;
    const tool = listing
      ? shared.list
      : tools.find((each) => each.name === name);
    if (tool === undefined)
      return toolError(
        `there is no tool ${name}; the tools are ${specs.map((each) => each.name).join(", ")}`,
      );
    try {
      checkInput(tool.inputSchema, input);
      const done = listing
        ? { value: await shared.list.run() }
        : await runTool(tool, input);
      return { text: JSON.stringify(done.value), ...done };
    } catch (error) {
      if (error instanceof Refusal) return toolError(error.message);
      console.error(error);
      return toolError("the server failed; its log says why");
    }
  }

  return { specs, names: () => shared.names(), run };
}

/**
 * Runs one chat turn: asks `model` about `body` (see `checkBody`) with `tools` (`chatTools`'s), runs the tool calls it
 * makes, and calls `emit` with what happens: `start`, `delta` (text), `tool` (a call and what it gave), then one of
 * `done`, `refused` (the model answered and said no) or `error` (nothing answered). A `signal` that aborts ends the chat with no more events.
 *
 * @throws Refusal when `body` is bad, or names a pod there is not; nothing has been emitted then.
 */
export async function runChat({ model, tools, body: given, signal, emit }) {
  const body = checkBody(given);
  if (body.pod !== "" && !(await tools.names()).includes(body.pod))
    throw new Refusal(`there is no pod ${body.pod}`);
  emit({ type: "start" });
  const system = [
    RULES,
    contextOf(body),
    ...(body.context === undefined
      ? []
      : [
          `The person asked about this: ${JSON.stringify(body.context)}. It names a finding by its key, an entry by its ID, a trend by its test and medication, or a line of Worth a look by its entry's ID; worth_a_look gives that line, which says what is flagged and never why. Find it with the tools.`,
          EXPLAIN_THE_THING,
        ]),
  ];
  const messages = [...body.messages];
  for (let round = 0; ; round += 1) {
    const calls = [];
    let said = "";
    let stop;
    for await (const event of model.turn({
      system,
      messages,
      tools: tools.specs,
      signal,
    })) {
      if (signal.aborted) return;
      if (event.type === "text") {
        said += event.text;
        emit({ type: "delta", text: event.text });
      } else if (event.type === "call") calls.push(event);
      else if (event.type === "done") stop = event.stop;
      else if (event.type === "refused") {
        emit({ type: "refused", text: event.text });
        return;
      } else if (event.type === "error") {
        emit({ type: "error", message: event.message });
        return;
      }
    }
    if (signal.aborted) return;
    if (calls.length === 0) {
      emit({ type: "done", stop: stop ?? "end" });
      return;
    }
    if (round === MAX_ROUNDS) {
      emit({
        type: "error",
        message: `the model was still asking for tools after ${MAX_ROUNDS} rounds`,
      });
      return;
    }
    messages.push({
      role: "assistant",
      content: said,
      calls: calls.map(({ id, name, arguments: input }) => ({
        id,
        name,
        arguments: input,
      })),
    });
    for (const call of calls) {
      if (signal.aborted) return;
      const done = await tools.run(call.name, call.arguments);
      const ok = done.isError !== true;
      emit({
        type: "tool",
        id: call.id,
        name: call.name,
        ok,
        ...(ok ? { result: done.value } : { error: done.text }),
        ...(done.findings === undefined ? {} : { findings: done.findings }),
        ...(done.open === undefined ? {} : { open: done.open }),
      });
      messages.push({
        role: "tool",
        id: call.id,
        content: done.text,
        ...(ok ? {} : { isError: true }),
      });
    }
  }
}

/** The request's body as JSON, at most `MAX_BODY_BYTES` of it. */
async function jsonOf(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw new Refusal(`the body must be at most ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Refusal("the body must be JSON");
  }
}

/**
 * `POST /chat`: streams `runChat`'s events as NDJSON. A body the rules refuse is 400 with the reason, and no model
 * set is 503. It catches its own errors, as a stream already started cannot be answered with a page, and aborts the
 * model's call when the request closes before it has been answered.
 */
export async function chatRoute(request, response, { model, tools }) {
  const aborting = new globalThis.AbortController();
  response.on("close", () => {
    if (!response.writableFinished) aborting.abort();
  });
  const refuse = (status, error) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error }));
  };
  const emit = (event) => {
    if (response.destroyed || response.writableEnded) return;
    if (!response.headersSent)
      response.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      });
    response.write(`${JSON.stringify(event)}\n`);
  };
  try {
    if (model === undefined)
      return refuse(503, "No model is set. Run `npm run model`.");
    await runChat({
      model,
      tools,
      body: await jsonOf(request),
      signal: aborting.signal,
      emit,
    });
    response.end();
  } catch (error) {
    if (error instanceof Refusal && !response.headersSent)
      return refuse(400, error.message);
    console.error(error);
    if (response.headersSent) {
      emit({
        type: "error",
        message: "the chat failed; the server's log says why",
      });
      response.end();
    } else refuse(500, "the chat failed; the server's log says why");
  }
}
