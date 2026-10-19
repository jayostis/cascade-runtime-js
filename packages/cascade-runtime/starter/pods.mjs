// What the scripts share: where pods live, what a pod may be called, which pod a script works on, and the addresses
// the app's pages have.
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { env, exit, stderr } from "node:process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { parseArgs } from "node:util";
import { openPod, Refusal, Unopened } from "cascade-runtime";
import { notOpenedHere } from "./pod-api.mjs";
import {
  phaseOn,
  replayKit,
  seconds,
  setUpTables,
} from "cascade-runtime/fixtures";

/** Every pod of this app is a folder here, named as the pod. */
export const PODS = fileURLToPath(new URL("pods/", import.meta.url));
/** The kits whose pods the app was made with. */
export const KITS = [
  "alex-rivera",
  "priya-natarajan",
  "martin-okafor",
  "tamsin-vale",
];
export const POD_NAME = /^[a-z0-9][a-z0-9._-]*$/;
export const NO_POD =
  "No pod loaded. Run `npm run reset` to load Alex's, Priya's, Martin's and Tamsin's pods.";

export function podFolder(name) {
  return join(PODS, name);
}

/**
 * The pod `name` in `folder`, opened without words, as the scripts and the MCP server do: an encrypted pod is a
 * `Refusal` saying so in one line, since only the app asks for its six words.
 */
export async function openWithoutWords(name, folder) {
  try {
    return await openPod(folder);
  } catch (error) {
    if (error instanceof Unopened && error.outcome === "secret needed")
      throw new Refusal(notOpenedHere(name));
    throw error;
  }
}

/** The address of a pod's page. */
export const podPath = (name) => `/pods/${encodeURIComponent(name)}/`;

/**
 * The address of a pod's trend: `test` is a LOINC code and `medication` an RxNorm code, or a name where the drug has no
 * code, both as bare as `find_changes` gives them; with no `medication`, none is marked.
 */
export function trendPath(name, { test, medication }) {
  const query = new URLSearchParams({
    test,
    ...(medication === undefined ? {} : { medication }),
  });
  return `${podPath(name)}trend?${query}`;
}

/** The origin `server.mjs` listens on, for a script that is not the server: `PORT`, else 3000. */
export function appOrigin() {
  return `http://127.0.0.1:${Number(env.PORT || 3000)}`;
}

/** `trendPath` on the app's origin: the address a model can be given. */
export function trendUrl(name, trend) {
  return new URL(trendPath(name, trend), appOrigin()).href;
}

/**
 * The pods there are, by name: a folder still empty is none, so reading it never makes a pod, and neither is
 * `.answers`, where the runtime keeps each pod's answers.
 */
export async function podNames(folder = PODS) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    const names = [];
    for (const entry of entries)
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        (await readdir(join(folder, entry.name))).length > 0
      )
        names.push(entry.name);
    return names.sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/** The folder the runtime keeps the pod's answers in. */
export function answersFolder(name, folder = PODS) {
  return join(folder, ".answers", name);
}

/** The title `pod.json` keeps for the pod, the name typed when it was made; undefined where none is kept. */
export async function podTitle(name, folder = PODS) {
  try {
    const kept = JSON.parse(
      await readFile(join(answersFolder(name, folder), "pod.json"), "utf8"),
    );
    return typeof kept.title === "string" ? kept.title : undefined;
  } catch {
    return undefined;
  }
}

/** Removes the pod and its answers. */
export async function deletePod(name, folder = PODS) {
  await rm(join(folder, name), { recursive: true, force: true });
  await rm(answersFolder(name, folder), { recursive: true, force: true });
}

/** Removes every pod; gives the names of those there were. */
export async function deleteAll() {
  const names = await podNames();
  await rm(PODS, { recursive: true, force: true });
  return names;
}

/**
 * Removes every pod and loads the kits' pods again, the app as it was made: what `npm run reset` and the File menu's
 * Reset all data do. `out(text)`, when given, is told what is under way: the tables' setup as its own step with each
 * phase's seconds, then each kit with its own. Gives the names of the pods there were.
 */
export async function resetAll(out) {
  const names = await deleteAll();
  if (out !== undefined)
    try {
      await setUpTables(PODS, phaseOn(out));
    } catch (error) {
      out(`\nthe app's tables could not be set up: ${error.message}\n`);
    }
  for (const kit of KITS) {
    const started = performance.now();
    out?.(`\nLoading the pod ${kit}, from the kit the package carries…`);
    try {
      await replayKit(kit, podFolder(kit));
      out?.(` loaded in ${seconds(started)}\n`);
    } catch (error) {
      out?.("\n");
      throw new Error(`the pod ${kit} did not load: ${error.message}`, {
        cause: error,
      });
    }
  }
  return names;
}

/** Says why, and ends the script with exit code 2. */
export function refuse(reason) {
  stderr.write(`${reason}\n`);
  exit(2);
}

export function checkName(name) {
  if (!POD_NAME.test(name))
    refuse(
      `${name} is no pod name: use lower-case letters, digits, ".", "_" and "-", starting with a letter or digit`,
    );
  return name;
}

/**
 * The script's arguments: its options and exactly as many positionals as `positionals` names. npm keeps an option
 * given before `--` for itself, so a stray positional most often means that.
 */
export function argumentsOf(args, usage, options, positionals) {
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    refuse(`${error.message}\nusage: ${usage}`);
  }
  if (parsed.positionals.length !== positionals)
    refuse(
      `usage: ${usage}\nAn option to an npm script goes after \`--\`, as \`npm run pod:load -- alex-rivera --through J24\`.`,
    );
  return parsed;
}

/** The pod named by `--pod`, or the only one there is. */
export async function choosePod(given) {
  const names = await podNames();
  if (given !== undefined) {
    checkName(given);
    if (!names.includes(given))
      refuse(
        names.length === 0
          ? `there is no pod ${given}. ${NO_POD}`
          : `there is no pod ${given}; there are ${names.join(", ")}`,
      );
    return given;
  }
  if (names.length === 0) refuse(NO_POD);
  if (names.length > 1)
    refuse(
      `there are several pods, ${names.join(", ")}: name one with \`-- --pod <name>\``,
    );
  return names[0];
}
