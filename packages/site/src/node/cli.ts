import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve as absolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  clock,
  OxigraphStore,
  podDataset,
  questions,
  repositoryName,
  treeIri,
  written,
} from "@cascade-runtime/runtime";
import {
  BRIDGE_REPOSITORY,
  type BridgePackageFound,
  BUILD as RELEASE,
  checkout,
  FolderFiles,
  findBridgePackage,
  findRoot,
  latestBuild,
  type LocalVocabulary,
  localVocabulary,
  PACKED,
  type Packed,
  readConfig,
  type Resolved,
  resolve,
  resolveVocabulary,
  siblingsOf,
} from "@cascade-runtime/runtime/node";
import type * as Published from "cascade-runtime/published";
import {
  type Example,
  type Ingredient,
  pagesTree,
  podOf,
} from "../front-page.js";
import { Site } from "../site.js";
import { readSpecReport, type SpecReport, specPages } from "../spec.js";
import { COPY } from "../terms.js";
import { servePages } from "./serve.js";
import { assertStagedCurrent } from "./staged.js";
import { STARTER_REPOSITORY, startOf } from "./start.js";

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
const STAGE = join(ROOT, "build", "package");
const STARTER = "cascade-starter-kit";
const PAGES = join(ROOT, "build", "pages");
const SPEC = join(ROOT, "build", "spec");
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

/**
 * The commit of the vocabulary the package `npm run build:package` staged carries, whose published samples are the
 * examples' pods: only a packed package publishes them.
 */
async function stagedVocabulary(repository: string): Promise<string> {
  const packedFile = join(STAGE, "components", PACKED);
  if (!existsSync(packedFile))
    throw new Error(
      `${STAGE} holds no package; run npm run build:package first`,
    );
  assertStagedCurrent(STAGE, ROOT);
  const packed = JSON.parse(await readFile(packedFile, "utf8")) as Packed;
  const commit = packed.components.find(
    (component) => component.repository === repository,
  )?.commit;
  if (commit === undefined)
    throw new Error(`${packedFile} records no ${repository}`);
  return commit;
}

/**
 * Builds every kit's published sample with the staged package, as an app that installed it would, and each one's site
 * over its pod, and writes them under build/pages beneath the newcomer's page and the examples' page.
 */
async function buildPages(): Promise<number> {
  const vocabulary = await localVocabulary(ROOT, log);
  const staged = await stagedVocabulary(
    vocabulary.config.vocabulary.repository,
  );
  log(
    `the sites are built from cascade-vocabulary at ${vocabulary.resolved.version}; the pods read the one the package carries, at ${staged}`,
  );
  const { publishedSamples } = (await import(
    pathToFileURL(join(STAGE, "dist", "src", "node", "published.js")).href
  )) as typeof Published;
  const samples = await publishedSamples();
  const examples: Example[] = [];
  for (const [name, title] of samples.kits) {
    const sample = new Map(
      [...samples.files]
        .filter(([path]) => path.startsWith(`${name}/`))
        .map(([path, bytes]) => [path.slice(name.length + 1), bytes] as const),
    );
    const pod = join(ROOT, "build", name, "pod");
    await rm(pod, { recursive: true, force: true });
    const podFiles = new FolderFiles(pod);
    for (const [path, bytes] of podOf(sample))
      await podFiles.write(path, bytes);
    const built = await buildExampleSite([name]);
    if (built !== 0) return built;
    const folder = new FolderFiles(join(ROOT, "build", name, "site"));
    const site = new Map<string, Uint8Array>();
    for (const path of await folder.list(""))
      if (!path.startsWith(COPY)) {
        const bytes = await folder.read(path);
        if (bytes !== undefined) site.set(path, bytes);
      }
    for (const [path, bytes] of sample) site.set(path, bytes);
    examples.push({ folder: name, title, site });
  }
  const siblingsIn = await siblingsOf(ROOT);
  const cache = join(ROOT, "build", "cache");
  const adapters = await Promise.all(
    vocabulary.config.adapters.map((followed) =>
      resolve(followed, { siblingsIn, cache, log }),
    ),
  );
  const bridge = await findBridgePackage({ siblingsIn, cache, log });
  const starter = await latestBuild(STARTER_REPOSITORY, join(cache, STARTER));
  log(
    `${STARTER}: the quick start names the release ${RELEASE}${starter}, the newest build of its default branch`,
  );
  const runtime = await checkout(ROOT);
  if (runtime === undefined)
    throw new Error(
      `${ROOT} is not a git checkout, so no commit built the pages`,
    );
  const self = { repository: RUNTIME };
  const builtFrom = atCommit(
    repositoryName(self),
    treeIri(self, runtime.commit),
    runtime.commit,
    runtime.uncommitted,
  );
  const tree = pagesTree(
    examples,
    {
      ingredients: [builtFrom, resolvedIngredient(vocabulary.resolved)],
      configured: [
        ...adapters.map(resolvedIngredient),
        bridgeIngredient(bridge),
      ],
      at: clock.now(),
    },
    startOf(starter, vocabulary.layout, EXAMPLE),
  );
  const out = PAGES;
  await rm(out, { recursive: true, force: true });
  const pages = new FolderFiles(out);
  for (const [path, bytes] of tree) await pages.write(path, bytes);
  console.error(`${tree.size} files written to ${out}`);
  return 0;
}

/**
 * Builds the spec's pages into build/spec from the vocabulary beside this checkout and the conformance run's EARL
 * report, and prints each place a rule and a note's Choice row do not name each other, which fails nothing yet.
 */
async function buildSpec(args: string[]): Promise<number> {
  const started = performance.now();
  const { values } = parseArgs({
    args,
    options: { report: { type: "string" }, out: { type: "string" } },
  });
  const reportFile = absolute(
    values.report ?? join(ROOT, "build", "conformance", "earl.nt"),
  );
  const resolved = await resolveVocabulary(
    ROOT,
    await readConfig(ROOT),
    undefined,
    log,
  );
  let report: SpecReport = { results: new Map(), ranWith: [], repeated: [] };
  if (existsSync(reportFile))
    report = await readSpecReport(await readFile(reportFile));
  else
    log(
      `build-spec: no report at ${reportFile}, so every example shows as not run`,
    );
  if (report.vocabulary !== undefined && report.vocabulary !== resolved.iri)
    log(
      `build-spec: the report is of ${report.vocabulary}, the pages read ${resolved.iri}; results are joined by path`,
    );
  const runtime = await checkout(ROOT);
  const self = { repository: RUNTIME };
  const { files, warnings } = await specPages({
    vocabulary: new FolderFiles(resolved.folder, resolved.iri),
    report,
    builtFrom: [
      ...(runtime === undefined
        ? []
        : [
            atCommit(
              repositoryName(self),
              treeIri(self, runtime.commit),
              runtime.commit,
              runtime.uncommitted,
            ),
          ]),
      resolvedIngredient(resolved),
    ],
    at: clock.now(),
  });
  const out = absolute(values.out ?? SPEC);
  await rm(out, { recursive: true, force: true });
  const folder = new FolderFiles(out);
  for (const [path, bytes] of files) await folder.write(path, bytes);
  const kinds = new Map<string, number>();
  for (const { kind, where, what } of warnings) {
    console.error(`warning: ${where}: ${what}`);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  console.error(
    `${warnings.length} warnings (${[...kinds].map(([kind, count]) => `${count} ${kind}`).join(", ")}); ${files.size} files written to ${out} in ${Math.round(performance.now() - started)} ms`,
  );
  return 0;
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
  "build-spec": buildSpec,
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
