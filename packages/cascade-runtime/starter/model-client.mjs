// The one door to a model: `modelFrom` reads the settings `npm run model` saved, `modelClient` makes a `Model` of any
// provider, and a `Model` streams one turn as events (`text`, `call`, `done`, `refused`, `error`). Nothing else in the
// app knows a provider's wire format, and no property of a `Model` exposes its key.
import { existsSync } from "node:fs";
import process from "node:process";
import { Refusal } from "cascade-runtime";
import { fileURLToPath, URL } from "node:url";

/** Where `npm run model` keeps its settings, beside this module. */
export const ENV_FILE = fileURLToPath(new URL(".env", import.meta.url));
/** The four settings, in the order they are written. */
export const SETTINGS = [
  "CASCADE_MODEL_PROVIDER",
  "CASCADE_MODEL_URL",
  "CASCADE_MODEL_NAME",
  "CASCADE_MODEL_KEY",
];

const FREE_ONLY_FOR_STORIES =
  "Use it for the example and story pods, not a person's own.";

/**
 * The providers a person can choose, in the order they are offered. `data` says what happens to what is sent; `url` and
 * `name` are the defaults; `key` is the page where a key is made (none: the provider needs no key).
 */
export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    summary: "free key, no card",
    name: "gemini-3.5-flash-lite",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    key: "https://aistudio.google.com/apikey",
    data: `Google uses the free tier to improve its products, and people may read what is sent. ${FREE_ONLY_FOR_STORIES} Google's terms allow only the paid tier for people in the EEA, Switzerland and the UK: there, choose Groq or a model on this computer.`,
  },
  groq: {
    label: "Groq",
    summary: "free key, no card",
    name: "openai/gpt-oss-120b",
    url: "https://api.groq.com/openai/v1",
    key: "https://console.groq.com/keys",
    data: `Groq does not train on what is sent (Groq Services Agreement, section 4.2) and may log it for up to 30 days. ${FREE_ONLY_FOR_STORIES}`,
  },
  openrouter: {
    label: "OpenRouter",
    summary: "free models, about 50 questions a day",
    name: "google/gemma-4-31b-it:free",
    url: "https://openrouter.ai/api/v1",
    key: "https://openrouter.ai/keys",
    data: `What happens to what is sent depends on the model's provider, and a free model may log and train on it. ${FREE_ONLY_FOR_STORIES}`,
  },
  local: {
    label: "On this computer",
    summary: "Ollama or LM Studio",
    name: "qwen3.5:4b",
    url: "http://localhost:11434/v1",
    key: undefined,
    data: "Nothing leaves this machine.",
  },
  anthropic: {
    label: "Anthropic",
    summary: "paid, best at calling tools",
    name: "claude-haiku-5-5",
    url: "https://api.anthropic.com",
    key: "https://platform.claude.com/settings/keys",
    data: "A paid API: Anthropic's terms for the API apply to what is sent.",
  },
  other: {
    label: "Another OpenAI-compatible address",
    summary: "you give the address",
    name: undefined,
    url: undefined,
    key: undefined,
    data: "Not known: treated as a hosted provider unless the address is on this computer.",
  },
};

/** A model server on this computer, whatever its port: 127.0.0.0/8, ::1 or localhost. */
export function isLoopback(address) {
  let host;
  try {
    host = new URL(address).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/** The text with every occurrence of the key replaced, so a provider echoing it back shows nothing. */
export function redact(text, key) {
  const said = String(text);
  return key ? said.replaceAll(key, "[key]") : said;
}

/** What a person can do about a refused key or a busy model, in place of the provider's own reply; nothing for any other failure. */
function advice(status, message, { provider, name }) {
  const label =
    provider === "other" || provider === "local"
      ? "The model server"
      : (PROVIDERS[provider]?.label ?? provider);
  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && KEYED.test(message))
  )
    return `${label} rejected the key: check CASCADE_MODEL_KEY in .env, or run \`npm run model\` again. ${message}`;
  if (status === 429 || status === 503 || status === 529)
    return `${name} is busy at ${label} (${status}): try again in a minute, or choose another model with \`npm run model\``;
  return message;
}

const KEYED = /\b(api[ _-]?key|auth(entication)? key)\b/i;

/**
 * Why a request failed: what a person can do about it where the status says (a rejected key, a busy model), else the
 * provider's words with the network's reason beneath: "Connection error. (ECONNREFUSED)". The key is never in it.
 */
function failureOf(error, settings) {
  let message = error?.message ?? String(error);
  let reason;
  for (let cause = error?.cause; cause; cause = cause.cause)
    reason = cause.code || cause.message || reason;
  if (reason && !message.includes(reason)) message += ` (${reason})`;
  return {
    status: error?.status,
    message: redact(advice(error?.status, message, settings), settings.key),
  };
}

/**
 * The assistant message that asks for `calls`, as a `Model` takes it back: each call keeps what the provider attached
 * (`extra`), or Gemini refuses the next round.
 */
export function callsMessage(said, calls) {
  return {
    role: "assistant",
    content: said,
    calls: calls.map(({ id, name, arguments: input, extra }) => ({
      id,
      name,
      arguments: input,
      ...(extra === undefined ? {} : { extra }),
    })),
  };
}

function parseArguments(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

/** The Chat Completions request's messages: the parts of `system` joined into one message. */
function openaiMessages(system, messages) {
  return [
    { role: "system", content: system.join("\n\n") },
    ...messages.map((message) => {
      if (message.role === "tool")
        return {
          role: "tool",
          tool_call_id: message.id,
          content: message.content,
        };
      if (message.role === "assistant" && message.calls?.length)
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.calls.map(
            ({ id, name, arguments: args, extra }) => ({
              id,
              type: "function",
              function: { name, arguments: args },
              ...(extra === undefined ? {} : { extra_content: extra }),
            }),
          ),
        };
      return { role: message.role, content: message.content };
    }),
  ];
}

async function* openaiTurn(settings, { system, messages, tools, signal }) {
  const calls = [];
  let last;
  let finish;
  let refusal = "";
  const body = {
    model: settings.name,
    messages: openaiMessages(system, messages),
    stream: true,
    ...(tools.length === 0
      ? {}
      : {
          tools: tools.map(({ name, description, inputSchema }) => ({
            type: "function",
            function: { name, description, parameters: inputSchema },
          })),
        }),
    ...(settings.provider === "local" || settings.provider === "other"
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {}),
  };
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      baseURL: settings.url,
      apiKey: settings.key || "none",
      organization: null,
      project: null,
      maxRetries: 0,
    });
    for await (const chunk of await client.chat.completions.create(body, {
      signal,
    })) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const { delta } = choice;
      if (delta?.content) yield { type: "text", text: delta.content };
      if (delta?.refusal) refusal += delta.refusal;
      for (const part of delta?.tool_calls ?? []) {
        const startsNew =
          part.index === undefined &&
          last !== undefined &&
          ((part.id && part.id !== last.id) ||
            (!part.id && part.function?.name && last.name));
        const slot =
          part.index ??
          Math.max(startsNew ? calls.length : calls.length - 1, 0);
        const call = (calls[slot] ??= { id: "", name: "", arguments: "" });
        last = call;
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        if (part.extra_content) call.extra = part.extra_content;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  } catch (error) {
    if (signal?.aborted) return;
    yield { type: "error", ...failureOf(error, settings) };
    return;
  }
  if (signal?.aborted) return;
  if (refusal || finish === "content_filter") {
    yield {
      type: "refused",
      text: refusal || "The model's provider declined to answer.",
    };
    return;
  }
  const made = calls.filter(Boolean);
  for (const [index, { id, name, arguments: args, extra }] of made.entries())
    yield {
      type: "call",
      id: id || `call_${index}`,
      name,
      arguments: args || "{}",
      ...(extra === undefined ? {} : { extra }),
    };
  yield {
    type: "done",
    stop: made.length > 0 ? "calls" : finish === "length" ? "length" : "end",
  };
}

/** The Messages request's messages: consecutive tool results are one user message of `tool_result` blocks. */
function anthropicMessages(messages) {
  const made = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.id,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };
      const last = made.at(-1);
      if (last?.role === "user" && last.content[0]?.type === "tool_result")
        last.content.push(block);
      else made.push({ role: "user", content: [block] });
    } else if (message.role === "assistant" && message.calls?.length)
      made.push({
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.calls.map(({ id, name, arguments: args }) => ({
            type: "tool_use",
            id,
            name,
            input: parseArguments(args),
          })),
        ],
      });
    else made.push({ role: message.role, content: message.content });
  }
  return made;
}

const ANTHROPIC_MAX_TOKENS = 4096;

async function* anthropicTurn(settings, { system, messages, tools, signal }) {
  const blocks = new Map();
  const made = [];
  let stop;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      baseURL: settings.url,
      apiKey: settings.key ?? null,
      authToken: null,
      maxRetries: 0,
    });
    const events = await client.messages.create(
      {
        model: settings.name,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: system.map((text) => ({ type: "text", text })),
        messages: anthropicMessages(messages),
        stream: true,
        ...(tools.length === 0
          ? {}
          : {
              tools: tools.map(({ name, description, inputSchema }) => ({
                name,
                description,
                input_schema: inputSchema,
              })),
            }),
      },
      { signal },
    );
    for await (const event of events) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use")
          blocks.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            json: "",
          });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta")
          yield { type: "text", text: event.delta.text };
        else if (event.delta.type === "input_json_delta")
          blocks.get(event.index).json += event.delta.partial_json;
      } else if (event.type === "content_block_stop") {
        const block = blocks.get(event.index);
        if (block)
          made.push({
            type: "call",
            id: block.id || `call_${made.length}`,
            name: block.name,
            arguments: block.json || "{}",
          });
      } else if (event.type === "message_delta") {
        stop = event.delta.stop_reason ?? stop;
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    yield { type: "error", ...failureOf(error, settings) };
    return;
  }
  if (signal?.aborted) return;
  if (stop === "refusal") {
    yield { type: "refused", text: "The model declined to answer." };
    return;
  }
  yield* made;
  yield {
    type: "done",
    stop: made.length > 0 ? "calls" : stop === "max_tokens" ? "length" : "end",
  };
}

/**
 * A `Model` for the provider: `turn({ system, messages, tools, signal })` streams the events of one request. `local` is
 * true when the address is on this computer. An unknown provider throws a `Refusal`; a missing address or name falls back to the
 * provider's default, and `other` has none. A `call` event may carry `extra`, what the provider attached to the call
 * (Gemini's thought signature): an assistant message's call that has it sends it back, unread.
 */
export function modelClient({ provider, url, name, key }) {
  const known = PROVIDERS[provider];
  if (!known)
    throw new Refusal(
      `unknown model provider "${provider}": use ${Object.keys(PROVIDERS).join(", ")}, or run \`npm run model\``,
    );
  const settings = {
    provider,
    url: url || known.url,
    name: name || known.name,
    key,
  };
  if (!settings.url)
    throw new Refusal(
      `the provider ${provider} needs an address: set CASCADE_MODEL_URL, or run \`npm run model\``,
    );
  if (!settings.name)
    throw new Refusal(
      `the provider ${provider} needs a model name: set CASCADE_MODEL_NAME, or run \`npm run model\``,
    );
  const turn =
    provider === "anthropic"
      ? (input) => anthropicTurn(settings, input)
      : (input) => openaiTurn(settings, input);
  return Object.freeze({
    provider,
    name: settings.name,
    local: isLoopback(settings.url),
    turn,
  });
}

/**
 * The model the settings name, or nothing when `CASCADE_MODEL_PROVIDER` is unset. With the process's own environment,
 * `.env` beside this module is loaded first when it exists (a variable already set wins); the server never loads it.
 */
export function modelFrom(env = process.env) {
  if (env === process.env && existsSync(ENV_FILE))
    process.loadEnvFile(ENV_FILE);
  const provider = env.CASCADE_MODEL_PROVIDER;
  if (!provider) {
    if (SETTINGS.some((name) => env[name]))
      throw new Refusal(
        "CASCADE_MODEL_PROVIDER is not set, though other model settings are: run `npm run model`",
      );
    return undefined;
  }
  const key = env.CASCADE_MODEL_KEY || undefined;
  const hosted = PROVIDERS[provider] && !["local", "other"].includes(provider);
  if (hosted && !key)
    throw new Refusal(
      `CASCADE_MODEL_KEY is not set for ${provider}: run \`npm run model\``,
    );
  return modelClient({
    provider,
    url: env.CASCADE_MODEL_URL,
    name: env.CASCADE_MODEL_NAME,
    key,
  });
}
