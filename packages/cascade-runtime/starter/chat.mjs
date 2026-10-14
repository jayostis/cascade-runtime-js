// The app's chat: a person's question goes to the model the app was set up with (`model-client.mjs`), which may call the
// tools over the pods (`pod-tools.mjs`) and the tools that open the app's own pages, for up to `MAX_ROUNDS` rounds.
// `chatRoute` is `POST /chat`; `runChat` the loop, which tells what happens as events.
import { Buffer } from "node:buffer";
import console from "node:console";
import {
  checkInput,
  findChanges,
  labSeriesIn,
  Refusal,
  timelineIn,
} from "cascade-runtime";
import { KITS, podPath, trendPath } from "./pods.mjs";
import { withPod } from "./pod-tools.mjs";
import {
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
const MAX_CONTEXT = 2000;

/** The rules the model is given, apart from where the person is. */
export const RULES = `You answer questions about the health records in the pods of this app, for the person who owns them.
Every number, date and name you give comes from a tool's result, never from memory or estimate. Say when a tool finds nothing.
A finding says what changed after what: a test's results were lower or higher after a medication started or stopped. It never says why, never that the medication caused the change, and never advice about what to do. Say that a doctor can tell what it means.
A record's date is a fact of the record. Never call a date "in the future" or "in the past" because of what you believe the date today to be.
Write plain text with no links and no markdown. The app shows a finding's rows under your answer, and open_trend, open_entry and open_pod move the app to a page: use them when the person asks to see something.`;

const NO_POD = "No pod is open.";

/** The context message of a turn: where the person is, apart from their words. */
function contextOf({ pod, page }) {
  return `${pod === "" ? NO_POD : `The person is looking at the pod ${pod}.`} The page on screen is ${page}.`;
}

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The body of `POST /chat`: `pod` (the name of the pod the page is about, or "" for none), `page` (its address),
 * `messages` (what the person and the model said, `user` and `assistant` text only, the last the person's),
 * optionally `context` (what an "Ask about this" is about) and `confirmed` (the pods the person has allowed a hosted
 * model to be asked about).
 *
 * @throws Refusal saying what is wrong.
 */
export function checkBody(body) {
  if (!isObject(body)) throw new Refusal("the body must be a JSON object");
  for (const key of Object.keys(body))
    if (!["pod", "page", "messages", "context", "confirmed"].includes(key))
      throw new Refusal(`${key} is not a property of the body`);
  const { pod, page, messages, context, confirmed = [] } = body;
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
  if (
    context !== undefined &&
    (!isObject(context) || JSON.stringify(context).length > MAX_CONTEXT)
  )
    throw new Refusal(
      `context must be an object of at most ${MAX_CONTEXT} characters`,
    );
  if (
    !Array.isArray(confirmed) ||
    confirmed.length > 100 ||
    !confirmed.every((each) => typeof each === "string")
  )
    throw new Refusal("confirmed must be a list of pod names");
  return {
    pod,
    page,
    messages: messages.map(({ role, content }) => ({ role, content })),
    ...(context === undefined ? {} : { context }),
    confirmed,
  };
}

/** An entry's address: `entry` as `ask` gives it, an IRI, or just its ID. */
export const entryPath = (name, entry) =>
  `${podPath(name)}entries/${encodeURIComponent(entryId(entry))}`;

const unique = (items) => [...new Set(items)];

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
          `the pod ${name} holds no entry ${entry}; its ${unique(rows.map((row) => row.entry)).length} entries are those the entry column of ask's rows names`,
        );
      return { opened: entryPath(name, entry) };
    },
  },
];

const text = (value) => ({ text: value, isError: true });

/**
 * The tools a chat reaches: `shared` is `podTools(...)`, `demoNames` the names of the demo hospitals. `specs` is what
 * the model is told of them. A `session` runs them for one chat, as a model at `local` (a loopback address) or not
 * and with the pods the person `confirmed` it may be asked about. A hosted model is not sent a person's own pod, nor
 * its name, until it is confirmed; a made-up one, an example or story pod, it is.
 */
export function chatTools(shared, { demoNames }) {
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

  function session({ local, confirmed = [] }) {
    const allowed = new Set(confirmed);
    const made = new Map();

    /** Made up: an example pod, or one that holds records and every one came from a demo hospital. */
    function madeUp(name) {
      if (KITS.includes(name)) return true;
      if (!made.has(name))
        made.set(
          name,
          shared
            .podNamed(name)
            .then((pod) => pod.ask(SOURCES))
            .then(
              (rows) =>
                rows.length > 0 &&
                rows.every(({ hospital }) => demoNames.has(hospital)),
            ),
        );
      return made.get(name);
    }

    const needsConfirmation = async (name) =>
      !local && !allowed.has(name) && !(await madeUp(name));

    async function visible() {
      const names = await shared.names();
      if (local) return names;
      const shown = await Promise.all(
        names.map(async (name) => !(await needsConfirmation(name))),
      );
      return names.filter((_, at) => shown[at]);
    }

    async function runTool(tool, input) {
      const { pod: name, ...rest } = input;
      if (!(await shared.names()).includes(name)) {
        const names = await visible();
        throw new Refusal(
          names.length === 0
            ? `there is no pod ${name}, and no pod at all`
            : `there is no pod ${name}; the pods are ${names.join(", ")}`,
        );
      }
      if (await needsConfirmation(name)) return { confirm: name };
      const pod = await shared.podNamed(name);
      const value = await tool.run(pod, rest, name);
      const found =
        tool.name === "find_changes" ? await findChanges(pod, rest) : undefined;
      return {
        value,
        ...(found === undefined
          ? {}
          : {
              findings: value.map((finding) => ({
                ...finding,
                rows: rowsOf(found.find(({ key }) => key === finding.key)),
              })),
            }),
        ...(tool.name.startsWith("open_") ? { open: value.opened } : {}),
      };
    }

    return {
      /** Whether a hosted model may not be asked about the pod yet: it is a person's own and not confirmed. */
      needsConfirmation,

      /**
       * A tool call of the model, by name and raw JSON arguments: `{ text, isError, value, findings?, open? }`, or
       * `{ confirm }` naming the pod the person must allow first. Input the rules refuse is `isError`, for the model
       * to read; nothing here throws for it.
       */
      async run(name, rawArguments) {
        let input;
        try {
          input = rawArguments === "" ? {} : JSON.parse(rawArguments);
        } catch (error) {
          return text(`the arguments are not JSON: ${error.message}`);
        }
        if (name === shared.list.name) {
          try {
            checkInput(shared.list.inputSchema, input);
          } catch (error) {
            if (error instanceof Refusal) return text(error.message);
            throw error;
          }
          const value = await visible();
          return { text: JSON.stringify(value), value };
        }
        const tool = tools.find((each) => each.name === name);
        if (tool === undefined)
          return text(
            `there is no tool ${name}; the tools are ${specs.map((each) => each.name).join(", ")}`,
          );
        try {
          checkInput(tool.inputSchema, input);
          const done = await runTool(tool, input);
          if (done.confirm !== undefined) return done;
          return { text: JSON.stringify(done.value), ...done };
        } catch (error) {
          if (error instanceof Refusal) return text(error.message);
          console.error(error);
          return text("the server failed; its log says why");
        }
      },
    };
  }

  return { specs, names: () => shared.names(), session };
}

/**
 * Runs one chat turn: asks `model` about `body` (see `checkBody`) with `tools` (`chatTools`'s), runs the tool calls it
 * makes, and calls `emit` with what happens: `start`, `delta` (text), `tool` (a call and what it gave), `confirm` (a
 * pod the person must allow a hosted model to be asked about; the chat ends there), then one of `done`, `refused` (the
 * model answered and said no) or `error` (nothing answered). A `signal` that aborts ends the chat with no more events.
 *
 * @throws Refusal when `body` is bad, or names a pod there is not; nothing has been emitted then.
 */
export async function runChat({ model, tools, body: given, signal, emit }) {
  const body = checkBody(given);
  if (body.pod !== "" && !(await tools.names()).includes(body.pod))
    throw new Refusal(`there is no pod ${body.pod}`);
  const session = tools.session({
    local: model.local,
    confirmed: body.confirmed,
  });
  emit({ type: "start" });
  if (body.pod !== "" && (await session.needsConfirmation(body.pod))) {
    emit({ type: "confirm", provider: model.provider, pod: body.pod });
    return;
  }
  const system = [
    RULES,
    contextOf(body),
    ...(body.context === undefined
      ? []
      : [
          `The person asked about this: ${JSON.stringify(body.context)}. It names a finding by its key, an entry by its ID, or a trend by its test and medication.`,
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
      const done = await session.run(call.name, call.arguments);
      if (done.confirm !== undefined) {
        emit({ type: "confirm", provider: model.provider, pod: done.confirm });
        return;
      }
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
