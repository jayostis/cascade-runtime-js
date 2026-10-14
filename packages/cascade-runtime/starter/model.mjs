// `npm run model [-- --off]`: choose the model the chat uses, check that it calls a tool, and keep the choice in `.env`.
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, exit, stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { parseArgs } from "node:util";
import { checkInput, Refusal } from "cascade-runtime";
import {
  callsMessage,
  modelClient,
  PROVIDERS,
  redact,
  SETTINGS,
} from "./model-client.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const USAGE = "usage: npm run model [-- --off]";
const CHOICES = Object.keys(PROVIDERS);
const SERVERS = [
  {
    label: "Ollama",
    url: "http://localhost:11434/v1",
    key: "ollama",
    name: PROVIDERS.local.name,
  },
  { label: "LM Studio", url: "http://localhost:1234/v1", key: "lm-studio" },
];
const CHECK_SECONDS = 120;

/** The one harmless tool the check offers. */
export const CHECK_TOOL = {
  name: "note_word",
  description: "Notes a word. Call it to answer.",
  inputSchema: {
    type: "object",
    properties: { word: { type: "string", description: "The word to note." } },
    required: ["word"],
    additionalProperties: false,
  },
};

const CHECK_SYSTEM = [
  "You are being tested on calling a tool. Answer by calling it.",
];

/** The chat's second round: the call's result goes back, as the chat sends it, and the model must answer without error. */
async function secondRound(model, messages, call, signal, seconds) {
  let answered = false;
  for await (const event of model.turn({
    system: CHECK_SYSTEM,
    messages: [
      ...messages,
      { role: "tool", id: call.id, content: "Noted: ready." },
    ],
    tools: [CHECK_TOOL],
    signal,
  })) {
    if (event.type === "error")
      return {
        ok: false,
        reason: `it called the tool, but failed once the result went back (the chat's second round): ${event.message}`,
      };
    if (event.type === "refused")
      return {
        ok: false,
        reason: `it called the tool, then declined once the result went back: ${event.text}`,
      };
    if (event.type === "text" || event.type === "call") answered = true;
  }
  if (signal.aborted)
    return { ok: false, reason: `no answer within ${seconds} seconds` };
  return answered
    ? { ok: true }
    : {
        ok: false,
        reason: "it sent no answer once the tool's result went back",
      };
}

/**
 * Two real requests carrying only `CHECK_TOOL`, as the chat makes them: passes only when the model calls it with
 * arguments its schema accepts, and then answers, without error, the result sent back.
 * Resolves `{ ok: true }` or `{ ok: false, reason }`, the reason in the provider's own words where it gave one.
 */
export async function check(model, { seconds = CHECK_SECONDS } = {}) {
  const signal = globalThis.AbortSignal.timeout(seconds * 1000);
  let spoke = false;
  const messages = [
    { role: "user", content: 'Note the word "ready" with the tool.' },
  ];
  for await (const event of model.turn({
    system: CHECK_SYSTEM,
    messages,
    tools: [CHECK_TOOL],
    signal,
  })) {
    if (event.type === "error") return { ok: false, reason: event.message };
    if (event.type === "refused")
      return { ok: false, reason: `the model declined: ${event.text}` };
    if (event.type === "text") spoke = true;
    if (event.type === "call") {
      if (event.name !== CHECK_TOOL.name)
        return {
          ok: false,
          reason: `it called ${event.name}, which was not offered`,
        };
      try {
        checkInput(CHECK_TOOL.inputSchema, JSON.parse(event.arguments));
      } catch (error) {
        return {
          ok: false,
          reason: `it called ${CHECK_TOOL.name} with arguments its schema does not accept: ${error.message}`,
        };
      }
      return secondRound(
        model,
        [...messages, callsMessage("", [event])],
        event,
        signal,
        seconds,
      );
    }
  }
  if (signal.aborted)
    return { ok: false, reason: `no answer within ${seconds} seconds` };
  return {
    ok: false,
    reason: spoke
      ? "it answers, but does not call tools; the chat needs a model that does"
      : "it sent no answer",
  };
}

const envFile = (folder) => join(folder, ".env");

async function readEnv(folder) {
  try {
    return await readFile(envFile(folder), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

const setting = new RegExp(`^\\s*(export\\s+)?(${SETTINGS.join("|")})\\s*=`);

/** The lines of an `.env` other than the four settings, each with its own line ending; and whether any setting was dropped. */
function withoutSettings(text) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const kept = lines.filter((line) => !setting.test(line));
  return { kept, dropped: kept.length < lines.length };
}

/** A value as `process.loadEnvFile` reads it back: it unescapes nothing, so a quote that is not in the value is the one used. */
function quoted(value, name) {
  if (/^[\w./:@+=,-]*$/.test(value)) return value;
  if (!/[\r\n']/.test(value)) return `'${value}'`;
  if (!/[\r\n"]|\\n/.test(value)) return `"${value}"`;
  throw new Refusal(
    `${name} cannot be kept in .env: a value with a line break, or with both kinds of quote, is read back differently.`,
  );
}

/** Replaces the four settings in the folder's `.env`, keeping its other lines as they were. */
export async function save(folder, values) {
  const text = (await readEnv(folder)) ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = SETTINGS.map(
    (name) => `${name}=${quoted(values[name] ?? "", name)}${eol}`,
  );
  const { kept } = withoutSettings(text);
  while (kept.length > 0 && kept.at(-1).trim() === "") kept.pop();
  if (kept.length > 0 && !/\n$/.test(kept.at(-1))) kept[kept.length - 1] += eol;
  await writeFile(envFile(folder), [...kept, ...lines].join(""), {
    mode: 0o600,
  });
}

/** Removes the four settings; whether there were any. */
export async function remove(folder) {
  const text = await readEnv(folder);
  if (text === undefined) return false;
  const { kept, dropped } = withoutSettings(text);
  if (!dropped) return false;
  if (kept.every((line) => line.trim() === "")) await rm(envFile(folder));
  else await writeFile(envFile(folder), kept.join(""), { mode: 0o600 });
  return true;
}

/**
 * The flow: asks which model, reads a key if the provider needs one, checks the model and keeps the settings in the
 * folder's `.env`. `terminal` is `{ out(text), err(text), ask(question) → text, secret(question) → text }`; the key is
 * redacted from everything printed. Resolves the exit code.
 */
export async function flow(args, terminal, folder = HERE) {
  let key;
  let typed = "";
  const say = (text) => terminal.out(redact(text, typed));
  const complain = (text) => terminal.err(redact(text, typed));
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: { off: { type: "boolean" } },
      allowPositionals: false,
      strict: true,
    });
  } catch (error) {
    complain(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (parsed.values.off) {
    say(
      (await remove(folder))
        ? "Removed the model settings from .env; the app has no chat.\n"
        : "No model settings in .env; nothing to remove.\n",
    );
    return 0;
  }

  say("Which model should the chat use?\n\n");
  CHOICES.forEach((id, index) => {
    const { label, summary } = PROVIDERS[id];
    say(
      `  ${index + 1}. ${label}: ${summary}${index === 0 ? " (recommended)" : ""}\n`,
    );
  });
  const picked = (await terminal.ask("\nChoose 1-6 [1]: ")).trim() || "1";
  const provider = CHOICES[Number(picked) - 1];
  if (!/^\d$/.test(picked) || provider === undefined) {
    complain(`${picked} is no choice: run \`npm run model\` again.\n`);
    return 2;
  }
  const known = PROVIDERS[provider];
  say(`\n${known.data}\n`);

  let url = known.url;
  let name = known.name;
  if (provider === "local") {
    say("\n");
    SERVERS.forEach(({ label, url: address }, index) =>
      say(`  ${index + 1}. ${label} (${address})\n`),
    );
    const server =
      SERVERS[
        Number((await terminal.ask("Which one? [1]: ")).trim() || "1") - 1
      ];
    if (server === undefined) {
      complain("That is neither: run `npm run model` again.\n");
      return 2;
    }
    ({ url, key, name } = server);
    say(
      `Start ${server.label} with a model that calls tools before going on; \`npm run model\` does not download or start one.\n`,
    );
  } else if (provider === "other") {
    url = (await terminal.ask("\nThe address, ending in /v1: ")).trim();
    if (url === "") {
      complain("No address given; nothing was changed.\n");
      return 2;
    }
    key = typed = (
      await terminal.secret(
        "Its key, if it wants one (a • shows for each character): ",
      )
    ).trim();
  } else {
    say(`\nMake a key at ${known.key}\n`);
    key = typed = (
      await terminal.secret("Paste it here (a • shows for each character): ")
    ).trim();
    if (key === "") {
      complain("No key given; nothing was changed.\n");
      return 2;
    }
  }

  if (provider === "anthropic")
    say("\nclaude-sonnet-5-5 also works: slower, and dearer.\n");
  name =
    (await terminal.ask(`Model name [${name ?? "required"}]: `)).trim() || name;
  if (name === undefined) {
    complain("No model name given; nothing was changed.\n");
    return 2;
  }

  say(`\nChecking that ${name} calls a tool…\n`);
  let result;
  try {
    result = await check(modelClient({ provider, url, name, key }));
  } catch (error) {
    result = { ok: false, reason: error.message };
  }
  if (result.ok) say("It does.\n");
  else {
    complain(`Not usable as it is: ${result.reason}\n`);
    const again = (await terminal.ask("Keep these settings anyway? (y/N) "))
      .trim()
      .toLowerCase();
    if (again !== "y" && again !== "yes") {
      say("Nothing was changed.\n");
      return 1;
    }
  }
  try {
    await save(folder, {
      CASCADE_MODEL_PROVIDER: provider,
      CASCADE_MODEL_URL: url,
      CASCADE_MODEL_NAME: name,
      CASCADE_MODEL_KEY: key,
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    complain(`${error.message} Nothing was changed.\n`);
    return 2;
  }
  say(
    `\nSaved to .env: ${provider}, ${name}${typed === "" ? "" : ", and the key"}. \`npm start\` now offers the chat; \`npm run model -- --off\` removes it.\n`,
  );
  return 0;
}

const PASTE_HINT =
  "Ctrl+V does not paste here: right-click, or Ctrl+Shift+V in Windows Terminal";

/**
 * Reads a line from a terminal in raw mode, echoing a `•` for each character kept so a paste can be seen to land. Ctrl+V
 * arrives as `\x16` where the console does not paste: it is dropped, and said so once.
 */
export function secret(question, io = { stdin, stdout, exit }) {
  const { stdin: input, stdout: output } = io;
  output.write(question);
  return new Promise((done) => {
    const line = [];
    let hinted = false;
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      output.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          finish();
          return done(line.join(""));
        }
        if (character === "\x03") {
          finish();
          io.exit(130);
          return;
        }
        if (character === "\x16") {
          if (!hinted)
            output.write(`\n${PASTE_HINT}\n${"•".repeat(line.length)}`);
          hinted = true;
        } else if (character === "\x7f" || character === "\b") {
          if (line.pop() !== undefined) output.write("\b \b");
        } else if (character >= " ") {
          line.push(character);
          output.write("•");
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function ask(question) {
  const reading = createInterface({ input: stdin, output: stdout });
  try {
    return await reading.question(question);
  } finally {
    reading.close();
  }
}

if (argv[1] && pathToFileURL(resolve(argv[1])).href === import.meta.url) {
  const args = argv.slice(2);
  if (!args.includes("--off") && !stdin.isTTY) {
    stderr.write("npm run model asks questions: run it in a terminal.\n");
    exit(2);
  }
  exit(
    await flow(args, {
      out: (text) => stdout.write(text),
      err: (text) => stderr.write(text),
      ask,
      secret,
    }),
  );
}
