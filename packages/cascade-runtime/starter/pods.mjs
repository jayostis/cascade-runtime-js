// What the scripts share: where pods live, what a pod may be called, and which pod a script works on.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { exit, stderr } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { parseArgs } from "node:util";

/** Every pod of this app is a folder here, named as the pod. */
export const PODS = fileURLToPath(new URL("pods/", import.meta.url));
export const POD_NAME = /^[a-z0-9][a-z0-9._-]*$/;
export const NO_POD = "No pod loaded. Run `npm run reset` to load Alex's and Priya's pods.";

export function podFolder(name) {
  return join(PODS, name);
}

/** The pods there are, by name: a folder still empty is none, so reading it never makes a pod. */
export async function podNames() {
  try {
    const entries = await readdir(PODS, { withFileTypes: true });
    const names = [];
    for (const entry of entries)
      if (
        entry.isDirectory() &&
        (await readdir(podFolder(entry.name))).length > 0
      )
        names.push(entry.name);
    return names.sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
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
