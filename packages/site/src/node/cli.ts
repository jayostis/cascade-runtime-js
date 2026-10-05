import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  clock,
  folderOf,
  OxigraphStore,
  podDataset,
  questions,
  written,
} from "@cascade-runtime/runtime";
import {
  FolderFiles,
  findRoot,
  type LocalVocabulary,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { Site } from "../site.js";
import { storyPod } from "./story-pod.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const RUNTIME_CLI = join(
  ROOT,
  "packages",
  "runtime",
  "dist",
  "src",
  "node",
  "cli.js",
);
const log = (line: string): void => console.error(line);

interface Target {
  readonly name: string;
  readonly pod: FolderFiles;
  /** The arguments that name this pod to `npm run ask`. */
  readonly named: string;
}

function target(name: string | undefined, pod: string | undefined): Target {
  if (name === undefined || name === "")
    throw new Error("name the example, as in build/<name>/pod");
  const folder =
    pod === undefined ? join(ROOT, "build", name, "pod") : absolute(pod);
  const named =
    pod === undefined
      ? name
      : `${name} --pod ${relative(ROOT, folder).split("\\").join("/")}`;
  return { name, pod: new FolderFiles(folder), named };
}

async function buildExampleSite(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      pod: { type: "string" },
      out: { type: "string" },
      lens: { type: "string" },
    },
  });
  const { name, pod, named } = target(positionals[0], values.pod);
  const vocabulary = await localVocabulary(ROOT, log);
  return writeSite(vocabulary, { name, pod, named }, values.out, values.lens);
}

async function writeSite(
  vocabulary: LocalVocabulary,
  { name, pod, named }: Target,
  outFolder: string | undefined,
  lens: string | undefined,
): Promise<number> {
  const out = absolute(outFolder ?? join(ROOT, "build", name, "site"));
  const site = await Site.build({
    vocabulary: vocabulary.files,
    layout: vocabulary.layout,
    build: vocabulary.build,
    pod,
    lens: lens ?? vocabulary.config.lens,
    newStore: () => new OxigraphStore(),
    name,
    at: clock.now(),
    ask: `npm run ask -- ${named}`,
  });
  const files = await site.files();
  if (outFolder === undefined) await rm(out, { recursive: true, force: true });
  const folder = new FolderFiles(out);
  for (const [path, bytes] of files) await folder.write(path, bytes);
  console.error(`${files.size} files written to ${out}`);
  return 0;
}

/** Replays a story of the vocabulary into build/<its folder's name>/pod, then builds that pod's site. */
async function buildStorySite(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { through: { type: "string" } },
  });
  const [story] = positionals;
  if (story === undefined)
    throw new Error("name the story, by its path in the vocabulary");
  const vocabulary = await localVocabulary(ROOT, log);
  const name = folderOf(story).split("/").at(-1) ?? "";
  const folder = join(ROOT, "build", name, "pod");
  await rm(folder, { recursive: true, force: true });
  const pod = new FolderFiles(folder);
  await storyPod(vocabulary, story, pod, values.through);
  console.error(`the story replayed into ${folder}`);
  return writeSite(
    vocabulary,
    { name, pod, named: name },
    undefined,
    undefined,
  );
}

async function buildExample(args: string[]): Promise<number> {
  const [name] = args;
  try {
    await promisify(execFile)(
      process.execPath,
      [RUNTIME_CLI, "build-example-pod", ...args],
      { cwd: ROOT },
    );
  } catch (error) {
    const { stderr, code } = error as { stderr?: string; code?: number };
    process.stderr.write(stderr ?? "");
    console.error(`build:example ${name ?? ""}: no pod was built, so no site`);
    return typeof code === "number" ? code : 1;
  }
  return buildExampleSite(args.slice(0, 1));
}

async function ask(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { pod: { type: "string" }, lens: { type: "string" } },
  });
  const [name, question] = positionals;
  const { pod } = target(name, values.pod);
  const vocabulary = await localVocabulary(ROOT);
  const asked = await questions(vocabulary.files);
  const query = asked.get(question ?? "");
  if (query === undefined) {
    throw new Error(
      `no question ${question ?? ""}; there are ${[...asked.keys()].join(", ")}`,
    );
  }
  const { store } = await podDataset(
    pod,
    vocabulary.layout,
    vocabulary.build,
    values.lens ?? vocabulary.config.lens,
    new OxigraphStore(),
    { title: name ?? "", at: clock.now() },
  );
  const { rows } = await store.select(query.text);
  for (const row of rows) {
    process.stdout.write(
      `${[...row].map(([column, term]) => `?${column}=${written(term)}`).join("\t")}\n`,
    );
  }
  return 0;
}

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  "build-example-site": buildExampleSite,
  "build-example": buildExample,
  "build-story-site": buildStorySite,
  ask,
};

async function main(argv: string[]): Promise<number> {
  const [command = "", ...args] = argv;
  const run = COMMANDS[command];
  if (run === undefined) {
    console.error(`usage: cli.js ${Object.keys(COMMANDS).join(" | ")} ...`);
    return 2;
  }
  try {
    return await run(args);
  } catch (error) {
    console.error(
      `${command}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
