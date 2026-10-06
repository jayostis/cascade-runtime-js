import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  clock,
  kitsOf,
  OxigraphStore,
  parseConfig,
  podDataset,
  questions,
  repositoryName,
  titleOf,
  treeIri,
  written,
} from "@cascade-runtime/runtime";
import {
  BRIDGE_REPOSITORY,
  type BridgePackageFound,
  checkout,
  CONFIG_FILE,
  FolderFiles,
  findBridgePackage,
  findRoot,
  type LocalVocabulary,
  localVocabulary,
  PACKED,
  type Packed,
  type Resolved,
  resolve,
  siblingsOf,
} from "@cascade-runtime/runtime/node";
import {
  type Example,
  type Ingredient,
  pagesTree,
  viewTitles,
} from "../front-page.js";
import { Site } from "../site.js";
import { TRY_PACKAGE, tryPage } from "../try-page.js";
import { servePages } from "./serve.js";
import { startOf } from "./start.js";

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
const RUNTIME = "https://github.com/jayostis/cascade-runtime-js";
const EXAMPLE = "alex-rivera";
const BRIDGE = "cascade-bridge-rs";
const KIT = "conformance/";
const STAGE = join(ROOT, "build", "package");
const PAGES = join(ROOT, "build", "pages");
const APP = join(ROOT, "packages", "site", "try", "app.js");
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
    defaultLens: vocabulary.config.lens,
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

function atCommit(
  name: string,
  href: string,
  commit: string,
  uncommitted = 0,
): Ingredient {
  const changes =
    uncommitted === 0 ? "" : `, with ${uncommitted} uncommitted files`;
  return { name, version: `${commit.slice(0, 12)}${changes}`, href };
}

const resolvedIngredient = (resolved: Resolved): Ingredient =>
  atCommit(
    repositoryName(resolved.component),
    resolved.iri,
    resolved.version,
    resolved.uncommitted,
  );

/** The Bridge's build a run uses, named by its release, or by the commit a checkout's build was made from. */
function bridgeIngredient(found: BridgePackageFound): Ingredient {
  return found.release === undefined
    ? {
        name: BRIDGE,
        version: `${found.commit.slice(0, 12)}${found.dirty ? ", with uncommitted changes" : ""}`,
        href: treeIri({ repository: BRIDGE_REPOSITORY }, found.commit),
      }
    : {
        name: BRIDGE,
        version: found.release,
        href: `${BRIDGE_REPOSITORY}/releases/tag/${found.release}`,
      };
}

/** What the page under try/ serves of the package `npm run build:package` staged: its browser build, and the vocabulary it carries. */
async function stagedPackage(): Promise<{
  readonly files: Map<string, Uint8Array>;
  readonly vocabulary: string;
}> {
  const components = join(STAGE, "components");
  if (!existsSync(join(components, PACKED)))
    throw new Error(
      `${STAGE} holds no package; run npm run build:package first`,
    );
  const config = parseConfig(
    await readFile(join(components, CONFIG_FILE), "utf8"),
  );
  const packed = JSON.parse(
    await readFile(join(components, PACKED), "utf8"),
  ) as Packed;
  const followed = config.vocabulary;
  const commit = packed.components.find(
    ({ repository }) => repository === followed.repository,
  )?.commit;
  if (commit === undefined)
    throw new Error(
      `${join(components, PACKED)} records no ${followed.repository}`,
    );
  const staged = new FolderFiles(STAGE);
  const paths = [
    ...(await staged.list("dist/browser")),
    `components/${CONFIG_FILE}`,
    `components/${PACKED}`,
    ...(await staged.list(`components/${repositoryName(followed)}/${commit}`)),
  ];
  const files = new Map<string, Uint8Array>();
  for (const path of paths) {
    const bytes = await staged.read(path);
    if (bytes === undefined) throw new Error(`${STAGE} holds no ${path}`);
    files.set(TRY_PACKAGE + path, bytes);
  }
  return { files, vocabulary: commit };
}

/** Builds every kit's pod and site with build-example, and writes them under build/pages beneath the newcomer's page and the examples' page. */
async function buildPages(): Promise<number> {
  const staged = await stagedPackage();
  const vocabulary = await localVocabulary(ROOT, log);
  log(
    `the pods are built from cascade-vocabulary at ${vocabulary.resolved.version}; try/ reads the one the package carries, at ${staged.vocabulary}`,
  );
  const examples: Example[] = [];
  for (const kit of await kitsOf(vocabulary.files)) {
    const name = kit.slice(KIT.length);
    const built = await buildExample([name]);
    if (built !== 0) return built;
    const folder = new FolderFiles(join(ROOT, "build", name, "site"));
    const site = new Map<string, Uint8Array>();
    for (const path of await folder.list("")) {
      const bytes = await folder.read(path);
      if (bytes !== undefined) site.set(path, bytes);
    }
    examples.push({
      folder: name,
      title: await titleOf(vocabulary.files, kit),
      site,
    });
  }
  const siblingsIn = await siblingsOf(ROOT);
  const cache = join(ROOT, "build", "cache");
  const adapters = await Promise.all(
    vocabulary.config.adapters.map((followed) =>
      resolve(followed, { siblingsIn, cache, log }),
    ),
  );
  const bridge = await findBridgePackage({ siblingsIn, cache, log });
  const runtime = await checkout(ROOT);
  if (runtime === undefined)
    throw new Error(
      `${ROOT} is not a git checkout, so no commit built the pages`,
    );
  const self = { repository: RUNTIME };
  const tree = pagesTree(
    examples,
    {
      ingredients: [
        atCommit(
          repositoryName(self),
          treeIri(self, runtime.commit),
          runtime.commit,
          runtime.uncommitted,
        ),
        resolvedIngredient(vocabulary.resolved),
      ],
      configured: [
        ...adapters.map(resolvedIngredient),
        bridgeIngredient(bridge),
      ],
      at: clock.now(),
    },
    await startOf(ROOT, runtime.commit),
    { kinds: viewTitles(vocabulary.layout), example: EXAMPLE },
    new Map([
      ["index.html", new TextEncoder().encode(tryPage(shownTitle(examples)))],
      ["app.js", await readFile(APP)],
      ...staged.files,
    ]),
  );
  const out = PAGES;
  await rm(out, { recursive: true, force: true });
  const pages = new FolderFiles(out);
  for (const [path, bytes] of tree) await pages.write(path, bytes);
  console.error(`${tree.size} files written to ${out}`);
  return 0;
}

function shownTitle(examples: readonly Example[]): string {
  const shown = examples.find(({ folder }) => folder === EXAMPLE);
  if (shown === undefined)
    throw new Error(`no example ${EXAMPLE} among the kits`);
  return shown.title;
}

/** Serves build/pages until stopped. */
async function servePagesCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" } } });
  if (!existsSync(join(PAGES, "index.html")))
    throw new Error(`${PAGES} holds no pages; run npm run build:pages first`);
  const { url } = await servePages(PAGES, Number(values.port ?? 0));
  console.log(`serving ${PAGES} at ${url}`);
  await new Promise(() => undefined);
  return 0;
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
  "build-pages": buildPages,
  "serve-pages": servePagesCommand,
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
