import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { cp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** This package's root, `dist/src/` being two levels down, in the workspace and in an install alike. */
const PACKAGE = fileURLToPath(new URL("../../", import.meta.url));
const STARTER = join(PACKAGE, "starter");
const COMMAND = "create-cascade-app";
const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const USAGE = `usage: ${COMMAND} <folder> [--tarball <address>]`;
/** The kits whose pods a made app starts with, in the order they are loaded; the starter's `npm run reset` loads the same. */
export const KITS = ["alex-rivera", "priya-natarajan"] as const;

export interface Terminal {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** Asks the person for the folder's name; absent when no person is at a terminal. */
  readonly ask?: () => Promise<string>;
  /** Installs the project's dependencies in the folder, resolving whether it succeeded. */
  readonly install: (folder: string) => Promise<boolean>;
  /** Replays the kit's story into the folder, rejecting with why it could not. */
  readonly load: (kit: string, folder: string) => Promise<void>;
}

/** The word as a shell reads it: quoted when it holds a space or a character a shell would act on. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(word)
    ? word
    : `"${word.replaceAll('"', '\\"')}"`;
}

/** The one line that makes an app in the folder from the package at the address. */
export function startLine(address: string, folder: string): string {
  return `npx --yes --package=${shellWord(address)} ${COMMAND} ${shellWord(folder)}`;
}

/** What a person gives a coding agent, started in the folder holding the made app, to build their app in it. */
export function agentPrompt(folder: string): string {
  return [
    `Build me an app on a Cascade pod. Work inside ${folder}: read its AGENTS.md first and follow it, and use only what its guide teaches.`,
    "My idea: <describe your idea in a sentence>",
  ].join("\n");
}

/** How a project depends on the package at the address: a URL as it is, a file by its absolute path. */
function dependencyOn(address: string): string {
  return /^[a-z][a-z0-9+.-]+:/i.test(address)
    ? address
    : `file:${absolute(address).replaceAll("\\", "/")}`;
}

async function recordedAddress(): Promise<string | undefined> {
  const manifest = JSON.parse(
    await readFile(join(PACKAGE, "package.json"), "utf8"),
  ) as { cascadeRuntime?: { tarball?: string } };
  return manifest.cascadeRuntime?.tarball;
}

/** Why the folder cannot be made into a project, or nothing. */
async function unusable(target: string): Promise<string | undefined> {
  const name = basename(target);
  if (!PROJECT_NAME.test(name) || name.length > 214)
    return `${name} is no project name: use lower-case letters, digits, ".", "_" and "-", starting with a letter or digit`;
  if (!existsSync(target)) return undefined;
  if (!statSync(target).isDirectory()) return `${target} is a file`;
  if ((await readdir(target)).length > 0) return `${target} is not empty`;
  return undefined;
}

async function rewrite(
  path: string,
  change: (text: string) => string,
): Promise<void> {
  await writeFile(path, change(await readFile(path, "utf8")));
}

async function copyStarter(
  target: string,
  name: string,
  dependency: string,
): Promise<void> {
  await cp(STARTER, target, { recursive: true });
  await rename(join(target, "gitignore"), join(target, ".gitignore"));
  await rewrite(join(target, "package.json"), (text) => {
    const manifest = JSON.parse(text) as {
      name: string;
      dependencies: Record<string, string>;
    };
    manifest.name = name;
    manifest.dependencies["cascade-runtime"] = dependency;
    return `${JSON.stringify(manifest, null, 2)}\n`;
  });
  await rewrite(join(target, "README.md"), (text) =>
    text.replace(/^# .*$/m, () => `# ${name}`),
  );
}

/** `create-cascade-app <folder> [--tarball <address>]`: the exit code, having written only what it says. */
export async function create(
  args: readonly string[],
  terminal: Terminal,
): Promise<number> {
  const refuse = (reason: string): number => {
    terminal.err(`${reason}\n`);
    return 2;
  };
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22)
    return refuse(
      `${COMMAND} needs Node 22 or later; this is ${process.version}`,
    );
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: { tarball: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    return refuse(`${(error as Error).message}\n${USAGE}`);
  }
  if (parsed.positionals.length > 1) return refuse(USAGE);
  let folder = parsed.positionals[0];
  if (folder === undefined) {
    if (terminal.ask === undefined) return refuse(USAGE);
    folder = (await terminal.ask()).trim();
    if (folder === "") return refuse("no folder given");
  }
  const address = parsed.values.tarball ?? (await recordedAddress());
  const target = absolute(folder);
  const reason = await unusable(target);
  if (reason !== undefined) return refuse(reason);
  if (address === undefined)
    return refuse(
      `no address of cascade-runtime is known: give one with --tarball <address>\n${USAGE}`,
    );

  const name = basename(target);
  try {
    await copyStarter(target, name, dependencyOn(address));
  } catch (error) {
    terminal.err(
      `the starter could not be copied into ${target}, which may be left half made: ${(error as Error).message}
`,
    );
    return 1;
  }
  if (!(await terminal.install(target))) {
    terminal.err(
      `the install failed; ${target} is left as it is: run \`npm install\` in it\n`,
    );
    return 1;
  }
  const loaded = [];
  for (const kit of KITS) {
    terminal.out(`\nLoading the pod ${kit}, from the kit the package carries…`);
    const started = performance.now();
    const pod = join(target, "pods", kit);
    try {
      await terminal.load(kit, pod);
      loaded.push(kit);
      terminal.out(
        ` loaded in ${((performance.now() - started) / 1000).toFixed(1)} s\n`,
      );
    } catch (error) {
      await rm(pod, { recursive: true, force: true });
      terminal.out("\n");
      terminal.err(
        `the pod ${kit} did not load: ${(error as Error).message}\nThe app is made; \`npm run reset\` in it loads its pods again.\n`,
      );
    }
  }
  terminal.out(
    [
      "",
      `Made ${target}${loaded.length === 0 ? "" : `, with ${loaded.length === 1 ? "the pod" : "the pods"} ${loaded.join(" and ")}`}. Start your coding agent in ${dirname(target)}, the folder holding it, and give it this, with your idea in its last line:`,
      "",
      agentPrompt(name),
      "",
      "To run the app yourself instead:",
      "",
      `  cd ${shellWord(folder)}`,
      "  npm start",
      "",
      "then open http://127.0.0.1:3000/. `npm run help` lists the app's commands.",
      "",
    ].join("\n"),
  );
  return 0;
}

/** npm's install in the folder, its output shown: npm's own script when npm ran this, otherwise `npm` through the shell. */
export function npmInstall(folder: string): Promise<boolean> {
  const npm = process.env.npm_execpath;
  const child =
    npm !== undefined && /\.c?js$/.test(npm)
      ? spawn(process.execPath, [npm, "install"], {
          cwd: folder,
          stdio: "inherit",
        })
      : spawn("npm install", { cwd: folder, stdio: "inherit", shell: true });
  return new Promise((done) => {
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}
