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
  hubFiles,
  type Ingredient,
  podOf,
  viewTitles,
} from "../front-page.js";
import type {
  Conformance,
  PagesContext,
  TestReports,
  TestRun,
} from "../hub/context.js";
import { buildTree } from "../sections.js";
import { Site, type SiteOptions } from "../site.js";
import { readSpecReport, type SpecReport, specPages } from "../spec.js";
import { COPY } from "../terms.js";
import { FINISHERS, SECTIONS } from "./hub/index.js";
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
/** The hub's folders of the term reference and the spec's pages. */
const TERMS = "terms/";
const SPEC_FOLDER = "spec/";

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

/** Where a kit's site, in a folder of the hub, finds the hub's pages it links: those a section of the hub writes. */
function inHub(): Pick<SiteOptions, "terms" | "spec"> {
  const written = (path: string) =>
    SECTIONS.some((section) => section.path === path);
  return {
    ...(written(`${TERMS}index.html`) && { terms: `../${TERMS}` }),
    ...(written(`${SPEC_FOLDER}index.html`) && { spec: `../${SPEC_FOLDER}` }),
  };
}

/**
 * Builds a kit's site. Built alone it links no term and no rule, since nothing beside it holds the term reference or
 * the spec; the hub gives it the folders of those it holds.
 */
async function buildExampleSite(
  args: string[],
  hub: Pick<SiteOptions, "terms" | "spec"> = {},
): Promise<number> {
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
  return writeSite(
    vocabulary,
    { name, pod, named },
    values.out,
    values.lens,
    hub,
  );
}

async function writeSite(
  vocabulary: LocalVocabulary,
  { name, pod, named }: Target,
  outFolder: string | undefined,
  lens: string | undefined,
  hub: Pick<SiteOptions, "terms" | "spec">,
): Promise<number> {
  const { iri } = vocabulary.resolved;
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
    ...(iri.includes("/tree/") && { blob: iri.replace("/tree/", "/blob/") }),
    ...hub,
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

/** The runtime checkout and the vocabulary the pages are built from. */
async function builtFromRuntime(resolved: Resolved): Promise<Ingredient[]> {
  const runtime = await checkout(ROOT);
  const self = { repository: RUNTIME };
  return [
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
  ];
}

/**
 * A conformance run's report, read, with the table the run wrote beside it as table.md. A missing file is no error: the
 * pages show every result as not run.
 */
async function readConformance(
  file: string,
  vocabulary: string,
): Promise<Conformance> {
  const none = { report: { results: new Map(), ranWith: [], repeated: [] } };
  if (!existsSync(file)) {
    log(`no conformance report at ${file}, so every example shows as not run`);
    return none;
  }
  const earl = await readFile(file);
  let report: SpecReport;
  try {
    report = await readSpecReport(earl);
  } catch (error) {
    log(
      `the conformance report at ${file} cannot be read (${error instanceof Error ? error.message : String(error)}), so every example shows as not run`,
    );
    return none;
  }
  if (report.vocabulary !== undefined && report.vocabulary !== vocabulary)
    log(
      `the report is of ${report.vocabulary}, the pages read ${vocabulary}; results are joined by path`,
    );
  const tableFile = join(dirname(file), "table.md");
  return {
    report,
    earl,
    ...(existsSync(tableFile) ? { table: await readFile(tableFile) } : {}),
  };
}

const reportFileOf = (named: string | undefined): string =>
  absolute(named ?? join(ROOT, "build", "conformance", "earl.nt"));

/**
 * One suite's newest run on main, kept in a folder as `junit.xml` with `run.json` beside it (`commit`, `at`, `url`). A
 * folder without both, or a `run.json` that does not name the run, is no run: the page says so for that suite.
 */
async function readTestRun(
  folder: string,
  suite: string,
): Promise<TestRun | undefined> {
  const reportFile = join(folder, "junit.xml");
  const runFile = join(folder, "run.json");
  if (!existsSync(reportFile) || !existsSync(runFile)) {
    log(`no ${suite} test report in ${folder}, so its page says not available`);
    return undefined;
  }
  let run: Partial<Record<"commit" | "at" | "url", unknown>>;
  try {
    run = JSON.parse(await readFile(runFile, "utf8")) as typeof run;
  } catch (error) {
    log(
      `${runFile} cannot be read (${error instanceof Error ? error.message : String(error)}), so the ${suite} test report is not available`,
    );
    return undefined;
  }
  const { commit, at, url } = run;
  if (
    typeof commit !== "string" ||
    typeof at !== "string" ||
    typeof url !== "string"
  ) {
    log(
      `${runFile} names no commit, time and url, so the ${suite} test report is not available`,
    );
    return undefined;
  }
  return { report: await readFile(reportFile, "utf8"), commit, at, url };
}

/** The runtime's and the vocabulary's newest runs on main, from `<folder>/runtime` and `<folder>/vocabulary`. */
async function readTestReports(folder: string): Promise<TestReports> {
  const [runtime, vocabulary] = await Promise.all([
    readTestRun(join(folder, "runtime"), "runtime"),
    readTestRun(join(folder, "vocabulary"), "vocabulary"),
  ]);
  return {
    ...(runtime === undefined ? {} : { runtime }),
    ...(vocabulary === undefined ? {} : { vocabulary }),
  };
}

const testsFolderOf = (named: string | undefined): string =>
  absolute(named ?? join(ROOT, "build", "tests"));

/** Runs the work on the first call, and gives the same answer to every call after. */
function once<T>(work: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | undefined;
  return () => (answer ??= work());
}

/**
 * The providers of the hub's context: every kit's published sample built with the staged package, as an app that
 * installed it would, each one's pod and site, and what the pages were built from.
 */
function pagesContext(
  vocabulary: LocalVocabulary,
  reportFile: string,
  testsFolder: string,
): PagesContext {
  return {
    root: ROOT,
    log,
    // Set only by the deploy's build, so a pull request's artifact and a local build keep relative links.
    ...(process.env.PAGES_URL ? { base: process.env.PAGES_URL } : {}),
    examples: once(async () => {
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
            .map(
              ([path, bytes]) => [path.slice(name.length + 1), bytes] as const,
            ),
        );
        const pod = join(ROOT, "build", name, "pod");
        await rm(pod, { recursive: true, force: true });
        const podFiles = new FolderFiles(pod);
        for (const [path, bytes] of podOf(sample))
          await podFiles.write(path, bytes);
        const built = await buildExampleSite([name], inHub());
        if (built !== 0) throw new Error(`the site of ${name} was not built`);
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
      return examples;
    }),
    builtFrom: once(async () => {
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
      return {
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
      };
    }),
    vocabulary: once(async () => ({
      files: new FolderFiles(
        vocabulary.resolved.folder,
        vocabulary.resolved.iri,
      ),
      builtFrom: await builtFromRuntime(vocabulary.resolved),
      at: clock.now(),
    })),
    report: once(() => readConformance(reportFile, vocabulary.resolved.iri)),
    tests: once(() => readTestReports(testsFolder)),
    start: once(async () => {
      const starter = await latestBuild(
        STARTER_REPOSITORY,
        join(ROOT, "build", "cache", STARTER),
      );
      log(
        `${STARTER}: the quick start names the release ${RELEASE}${starter}, the newest build of its default branch`,
      );
      return startOf(starter, vocabulary.layout, EXAMPLE);
    }),
  };
}

/**
 * Builds the whole Pages tree into build/pages: the hub's sections, the front page above them, and what reads the tree
 * once it is written. The one command that the pull request's docs site and the deploy both run. `--no-kits` leaves out
 * what is made of the kits, which is most of the time. `--report` names the conformance run's EARL report, with its
 * table.md beside it; the spec and conformance pages show every result as not run when there is none. `--tests` names the
 * folder of the unit test reports, `runtime/` and `vocabulary/` in it, each with `junit.xml` and `run.json`; the page of
 * a suite with none says it is not available.
 */
async function buildPages(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      "no-kits": { type: "boolean" },
      report: { type: "string" },
      tests: { type: "string" },
    },
  });
  const vocabulary = await localVocabulary(ROOT, log);
  const { tree } = await buildTree({
    sections: SECTIONS,
    ctx: pagesContext(
      vocabulary,
      reportFileOf(values.report),
      testsFolderOf(values.tests),
    ),
    front: (rows) => hubFiles(viewTitles(vocabulary.layout), rows),
    finishers: FINISHERS,
    skip: ({ needsKits }) => values["no-kits"] === true && needsKits === true,
  });
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
  const resolved = await resolveVocabulary(
    ROOT,
    await readConfig(ROOT),
    undefined,
    log,
  );
  const { report } = await readConformance(
    reportFileOf(values.report),
    resolved.iri,
  );
  const { files, warnings, unnoted, waiting } = await specPages({
    vocabulary: new FolderFiles(resolved.folder, resolved.iri),
    report,
    builtFrom: await builtFromRuntime(resolved),
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
    `${warnings.length} warnings${kinds.size === 0 ? "" : ` (${[...kinds].map(([kind, count]) => `${count} ${kind}`).join(", ")})`}; ${unnoted.length} rules say no note rules them, ${waiting.length} Choice rows wait on an issue; ${files.size} files written to ${out} in ${Math.round(performance.now() - started)} ms`,
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
