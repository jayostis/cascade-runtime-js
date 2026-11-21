import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as absolute,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { vocabularyDerive } from "../build.js";
import {
  type Assertion,
  earl,
  featureStory,
  type OfferedTool,
  runConformance,
  type TestedWith,
} from "../conformance.js";
import { repositoryName, type RuntimeConfig } from "../config.js";
import type { Proposer } from "../replay.js";
import { Shapes } from "../shapes.js";
import { MemoryFiles } from "../files.js";
import { Layout } from "../layout.js";
import { FolderFiles } from "./folder-files.js";
import { catFile, unpack } from "./archive-commands.js";
import { featuresOf } from "../features.js";
import { folderOf } from "../files.js";
import { importersNamed } from "../importers.js";
import { type Resolved, type ResolverOptions, resolve } from "./resolver.js";
import type { Components } from "./components.js";
import {
  BRIDGE_REPOSITORY,
  compiledBridge,
  findBridgePackage,
  inWorker,
  loadConfiguredAdapters,
} from "./wasm.js";
import {
  findRoot,
  localVocabulary,
  readConfig,
  resolveVocabulary,
  siblingsOf,
  thisRuntime,
} from "./runtime.js";
import { featurePod } from "./story-pod.js";
import { OxigraphStore } from "../oxigraph-store.js";
import { EVERY_FINDING } from "../bridge.js";
import { useOxigraph, usedOxigraph } from "../oxigraph-engine.js";
import {
  chooseOxigraph,
  fetchNativeOxigraph,
  nativeOxigraph,
} from "./oxigraph-native.js";
import { kitImports } from "../kit-bridge.js";
import { KIT_FINDINGS_CHECK, kitFindings } from "../kit-findings.js";
import { kitsOf } from "../kit.js";
import { ofMediaType } from "../load-adapter.js";
import { WasmBridge } from "../wasm-bridge.js";
import { checkouts } from "./components.js";
import { bridgeRecord } from "./bridge-record.js";
import { openDatabase } from "./sqlite.js";
import {
  fixtureNames,
  sqlCheckAssertions,
  sqlFunctionAssertions,
} from "../sql-check.js";

const RUNTIME = "cascade-runtime-js";
const KIT = "conformance/";
const SPEC = "https://github.com/the-cascade-protocol/cascade-bridge-spec";
const log = (line: string): void => console.error(line);

function folderMap(pairs: readonly string[]): Map<string, string> {
  return new Map(
    pairs.map((pair) => {
      const at = pair.lastIndexOf("=");
      if (at <= 0)
        throw new Error(`--folder ${pair} is not <repository>=<folder>`);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
}

function summary(assertions: readonly Assertion[]): string {
  const count = (outcome: Assertion["outcome"]): number =>
    assertions.filter((a) => a.outcome === outcome).length;
  return `${assertions.length} tests: ${count("passed")} passed, ${count("failed")} failed, ${count("inapplicable")} inapplicable`;
}

function testedWith(resolved: Resolved): TestedWith {
  return {
    name: repositoryName(resolved.component),
    iri: resolved.iri,
    revision: resolved.version,
  };
}

/** What `cascade-runtime/tools/node` performs a model's proposal with, loaded as `toolsOffered` loads its tools. */
async function proposerOf(): Promise<Proposer> {
  const name = "cascade-runtime/tools/node";
  try {
    return ((await import(name)) as { proposer: Proposer }).proposer;
  } catch (error) {
    throw new Error(
      `${name} performs a model's proposals, and did not load (tsc -b packages/cascade-runtime builds it)`,
      { cause: error },
    );
  }
}

/**
 * The tools `cascade-runtime/tools` offers a model. That package is built on this one, so this one imports nothing of
 * it: the command loads it when it runs, by a name TypeScript does not follow.
 */
async function toolsOffered(): Promise<
  (door: { canAsk: boolean }) => readonly OfferedTool[]
> {
  const name = "cascade-runtime/tools/propose";
  let built: {
    offeredToolsOf?: (door: { canAsk: boolean }) => OfferedTool[];
  };
  try {
    built = (await import(name)) as typeof built;
  } catch (error) {
    throw new Error(
      `${name} lists the tools the examples read, and did not load (tsc -b packages/cascade-runtime builds it)`,
      { cause: error },
    );
  }
  if (built.offeredToolsOf === undefined)
    throw new Error(
      `${name} loaded but lists no \`offeredToolsOf\`: its build is stale (tsc -b packages/cascade-runtime builds it)`,
    );
  const { offeredToolsOf } = built;
  log(
    `the run lists ${offeredToolsOf({ canAsk: true }).length} tools, ${offeredToolsOf({ canAsk: false }).length} through a door that cannot ask`,
  );
  return offeredToolsOf;
}

async function conformance(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      report: { type: "string" },
      feature: { type: "string", multiple: true },
      folder: { type: "string", multiple: true, default: [] },
      jobs: { type: "string" },
      // Set by a run that shards: where a shard writes its assertions, as JSON, instead of the report.
      assertions: { type: "string" },
      // Set by a run that shards: the share of the fixtures this run checks the vocabulary's SQL over, as index/count.
      sql: { type: "string" },
    },
  });
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const config = await readConfig(root);
  const report = absolute(
    values.report ?? join(root, "build", "conformance", "earl.nt"),
  );
  const folders = folderMap(values.folder);
  if (values.assertions === undefined)
    log(`conformance: on Oxigraph's ${usedOxigraph().name} build`);
  const vocabulary = await resolveVocabulary(root, config, folders, log);
  const options = {
    siblingsIn: await siblingsOf(root),
    folders,
    cache: join(root, "build", "cache"),
    log,
  };
  const adapters = await Promise.all(
    config.adapters.map((adapter) => resolve(adapter, options)),
  );
  const bridge = await findBridgePackage(options);
  const files = new FolderFiles(vocabulary.folder, vocabulary.iri);
  if (values.sql !== undefined && values.assertions !== undefined) {
    await writeFile(
      values.assertions,
      JSON.stringify(await sqlCheckDealt(files, dealOf(values.sql))),
    );
    return 0;
  }
  const shards =
    values.feature === undefined && values.assertions === undefined
      ? await shardsOf(files, jobsOf(values.jobs))
      : [];
  const whole = values.feature === undefined && values.assertions === undefined;
  // Sharded, the SQL check is dealt to runs of its own beside the feature shards; else it runs here, beside the features.
  const checked = whole
    ? shards.length > 1
      ? sqlFunctionAssertions(files)
      : sqlAssertions(files)
    : Promise.resolve([]);
  checked.catch(() => undefined);
  const assertions =
    shards.length > 1
      ? await shardedRun(
          [
            ...shards.map((features) =>
              features.flatMap((feature) => ["--feature", feature]),
            ),
            ...shards.map((_, index) => ["--sql", `${index}/${shards.length}`]),
          ],
          values.folder,
          { iri: files.iri, features: await featuresOf(files) },
        )
      : await conformed(files, values.feature, config.importers);
  if (values.assertions !== undefined) {
    await writeFile(values.assertions, JSON.stringify(assertions));
    return 0;
  }
  await reported(
    values.feature === undefined
      ? [
          ...assertions,
          ...(await kitFindingAssertions(
            files,
            config,
            { ...options, folders },
            bridge,
          )),
          ...(await checked),
        ]
      : assertions,
    report,
    vocabulary,
    adapters,
    bridge,
  );
  return 0;
}

/**
 * One assertion for each kit: that what the configured adapters make of each document its imports hand the Bridge is
 * the output the kit saves, so a change to an adapter that changes its findings fails until the kit saves them again.
 */
async function kitFindingAssertions(
  files: FolderFiles,
  config: RuntimeConfig,
  options: ResolverOptions,
  found: Awaited<ReturnType<typeof findBridgePackage>>,
): Promise<Assertion[]> {
  const bridge = new WasmBridge(inWorker(await compiledBridge(found.folder)));
  const configured = await loadConfiguredAdapters(bridge, config.adapters, {
    resolve: (component) => resolve(component, options),
  } as Components);
  try {
    const { differ } = await kitFindings({
      vocabulary: files,
      importers: importersNamed(config.importers),
      adaptersOf: ofMediaType(configured),
    });
    return (await kitsOf(files)).map((kit): Assertion => {
      const mine = differ.filter((line) => line.startsWith(`${kit} `));
      return {
        test: `${files.iri}${kit}/#${KIT_FINDINGS_CHECK}`,
        name: KIT_FINDINGS_CHECK,
        outcome: mine.length === 0 ? "passed" : "failed",
        ...(mine.length === 0 ? {} : { why: mine.join("\n") }),
      };
    });
  } finally {
    for (const { adapter } of configured) await adapter.free();
    bridge.close();
  }
}

/**
 * One assertion for each of the six SQL functions, that it gives each vector's output, and one for each fixture, each
 * vocabulary `.sql` and each lens, that the `.sql` gives its `.rq`'s rows over the fixture as this runtime builds it.
 */
async function sqlAssertions(files: FolderFiles): Promise<Assertion[]> {
  const started = performance.now();
  const assertions = [
    ...(await sqlFunctionAssertions(files)),
    ...(await sqlCheckDealt(files, [0, 1])),
  ];
  log(
    `the vocabulary's SQL: ${assertions.length} assertions in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  return assertions;
}

/** The SQL check over the fixtures dealt to the run `index` of `count`: each `count`-th fixture from the `index`-th. */
async function sqlCheckDealt(
  files: FolderFiles,
  [index, count]: readonly [number, number],
): Promise<Assertion[]> {
  return sqlCheckAssertions(
    {
      vocabulary: files,
      newStore: () => new OxigraphStore(),
      layout: await Layout.read(files, () => new OxigraphStore()),
      open: (functions) => openDatabase(":memory:", { functions }),
    },
    (await fixtureNames(files)).filter((_, at) => at % count === index),
  );
}

function dealOf(given: string): [number, number] {
  const [index = -1, count = 0] = given.split("/").map(Number);
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(count) ||
    index < 0 ||
    index >= count
  )
    throw new Error(`--sql ${given} is not index/count, 0 <= index < count`);
  return [index, count];
}

function jobsOf(given: string | undefined): number {
  const jobs = given === undefined ? availableParallelism() : Number(given);
  if (!Number.isInteger(jobs) || jobs < 1)
    throw new Error(`--jobs ${given} is not a number of runs, 1 or more`);
  return Math.min(jobs, 4);
}

/**
 * The feature files of the vocabulary in at most `jobs` shards of about the same size, a folder's features together
 * (they share a person, and so a replay), the biggest folder first into the smallest shard. One shard when `jobs` is 1.
 */
async function shardsOf(files: FolderFiles, jobs: number): Promise<string[][]> {
  const features = await featuresOf(files);
  const folders = new Map<string, { paths: string[]; size: number }>();
  for (const path of features) {
    const group = folders.get(folderOf(path)) ?? { paths: [], size: 0 };
    group.paths.push(path);
    group.size += (await files.read(path))?.length ?? 0;
    folders.set(folderOf(path), group);
  }
  const shards: { paths: string[]; size: number }[] = Array.from(
    { length: Math.min(jobs, folders.size) },
    () => ({ paths: [], size: 0 }),
  );
  for (const { paths, size } of [...folders.values()].sort(
    (a, b) =>
      b.size - a.size || (a.paths[0] ?? "").localeCompare(b.paths[0] ?? ""),
  )) {
    const [smallest] = [...shards].sort((a, b) => a.size - b.size);
    if (smallest === undefined) break;
    smallest.paths.push(...paths);
    smallest.size += size;
  }
  return shards.map(({ paths }) => paths);
}

/**
 * Each shard, its arguments to this command, run as a child of it, beside the others, with the flags this process runs
 * under; the assertions come back in the order of `order`, the vocabulary's feature files, however many shards there
 * are, and those of no feature file after them. When one fails the others are stopped and have ended before the folder
 * they write to is removed.
 */
async function shardedRun(
  shards: readonly (readonly string[])[],
  folders: readonly string[],
  order: { readonly iri: string; readonly features: readonly string[] },
): Promise<Assertion[]> {
  const out = await mkdtemp(join(tmpdir(), "conformance-shards-"));
  const stop = new AbortController();
  try {
    const ran = await Promise.allSettled(
      shards.map(async (shard, index) => {
        const written = join(out, `${index}.json`);
        try {
          await promisify(execFile)(
            process.execPath,
            [
              ...process.execArgv,
              fileURLToPath(import.meta.url),
              "conformance",
              "--assertions",
              written,
              ...shard,
              ...folders.flatMap((folder) => ["--folder", folder]),
            ],
            { maxBuffer: 64 * 1024 * 1024, signal: stop.signal },
          );
        } catch (error) {
          stop.abort();
          const { stderr } = error as { stderr?: string };
          throw new Error(
            `the conformance run ${shard.join(" ")} failed:${stderr?.trim() || String(error)}`,
            { cause: error },
          );
        }
        return JSON.parse(await readFile(written, "utf8")) as Assertion[];
      }),
    );
    // The first to fail aborted the rest, which reject as aborted: the failure reported is the first that is not that.
    const failed = ran.filter(
      (each): each is PromiseRejectedResult => each.status === "rejected",
    );
    const cause =
      failed.find(
        ({ reason }) =>
          (reason as { cause?: { name?: string } }).cause?.name !==
          "AbortError",
      ) ?? failed[0];
    if (cause !== undefined) throw cause.reason;
    const rank = (test: string): number => {
      const path = test.slice(order.iri.length);
      const own = order.features.findIndex((feature) =>
        path.startsWith(feature),
      );
      return own >= 0
        ? own
        : order.features.findIndex((feature) =>
            path.startsWith(`${folderOf(feature)}/`),
          );
    };
    return ran
      .flatMap((each) => (each.status === "fulfilled" ? each.value : []))
      .map((assertion) => ({ assertion, at: rank(assertion.test) }))
      .sort(
        (x, y) =>
          (x.at < 0 ? Number.MAX_SAFE_INTEGER : x.at) -
          (y.at < 0 ? Number.MAX_SAFE_INTEGER : y.at),
      )
      .map(({ assertion }) => assertion);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

async function conformed(
  files: FolderFiles,
  features: string[] | undefined,
  importers: readonly string[],
): Promise<Assertion[]> {
  const layout = await Layout.read(files, () => new OxigraphStore());
  return runConformance({
    vocabulary: files,
    runtime: await thisRuntime(),
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
    importers: importersNamed(importers),
    layout,
    derive: await vocabularyDerive(files, layout),
    // Read before the tools load: the other way round, Node 22's V8 crashed in the deoptimizer inside this read (vocabulary#397).
    shapes: await Shapes.read(files, () => new OxigraphStore()),
    tools: await toolsOffered(),
    proposer: await proposerOf(),
    ...(features === undefined ? {} : { features }),
  });
}

async function reported(
  assertions: readonly Assertion[],
  report: string,
  vocabulary: Resolved,
  adapters: readonly Resolved[],
  bridge: Awaited<ReturnType<typeof findBridgePackage>>,
): Promise<void> {
  await mkdir(dirname(report), { recursive: true });
  await writeFile(
    report,
    earl(assertions, RUNTIME, [
      ...[vocabulary, ...adapters].map(testedWith),
      {
        name: repositoryName({ repository: BRIDGE_REPOSITORY }),
        iri:
          bridge.release === undefined
            ? `${BRIDGE_REPOSITORY}/tree/${bridge.commit}/`
            : `${BRIDGE_REPOSITORY}/releases/tag/${bridge.release}`,
        revision: bridge.release ?? bridge.commit,
      },
    ]),
  );
  for (const { test, outcome, why } of assertions)
    if (outcome !== "passed")
      console.error(
        `${outcome}: ${test}\n  ${(why ?? "").replaceAll("\n", "\n  ")}`,
      );
  console.error(`${summary(assertions)}; the EARL report is ${report}`);
}

/** Replays the vocabulary's conformance kit `conformance/<name>/` into build/<name>/pod. */
async function buildExamplePod(args: string[]): Promise<number> {
  const [name] = args;
  if (name === undefined || name === "")
    throw new Error(
      "name the example, as in conformance/<name>/ in the vocabulary",
    );
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const vocabulary = await localVocabulary(root, log);
  const story = `${KIT}${name}/${name}.feature`;
  if ((await vocabulary.files.read(story)) === undefined) {
    console.error(
      `build:example-pod ${name}: the vocabulary has no ${story} to build the pod from`,
    );
    return 2;
  }
  const folder = join(root, "build", name, "pod");
  await rm(folder, { recursive: true, force: true });
  const { steps } = await featurePod(
    vocabulary,
    story,
    new FolderFiles(folder),
  );
  const refused = steps.filter(({ refused }) => refused !== undefined);
  for (const { step, refused: why } of refused)
    console.error(`step ${step.name} was refused: ${why}`);
  console.error(`${story} replayed into ${folder}`);
  return 0;
}

/**
 * Saves the Bridge output of the kit `conformance/<name>/` into a folder, as `<converted folder>/<stem>/graph.ttl` and
 * `findings.ttl` for each document an import step of its story hands on, and says the commits it converted with.
 */
async function saveKitBridge(args: string[]): Promise<number> {
  const [kit, out] = args;
  const named = /^conformance\/([^/]+)\/?$/.exec(kit ?? "");
  if (named === null || out === undefined)
    throw new Error("usage: kit-bridge conformance/<kit> <folder to write>");
  const name = named[1] as string;
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const components = await checkouts(root, log);
  const vocabulary = await components.resolve(components.config.vocabulary);
  const files = new FolderFiles(vocabulary.folder, vocabulary.iri);
  const story = `conformance/${name}/${name}.feature`;
  if ((await files.read(story)) === undefined)
    throw new Error(`the vocabulary has no ${story}`);
  const inside = relative(vocabulary.folder, absolute(out));
  if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)))
    throw new Error(
      `usage: kit-bridge writes to a folder outside the vocabulary (${vocabulary.folder}), never over a kit; ${out} is inside it`,
    );
  const found = await components.bridge();
  const uncommitted = ({ uncommitted: count = 0 }: Resolved): string =>
    count === 0 ? "" : ` (uncommitted: ${count} files)`;
  const spec = await components.resolve({ repository: SPEC });
  console.error(
    `cascade-bridge-rs ${found.release ?? found.source} commit ${found.commit}${found.dirty ? " (uncommitted)" : ""}`,
  );
  console.error(
    `cascade-bridge-spec conformsTo ${spec.iri}${uncommitted(spec)}`,
  );
  console.error(
    `cascade-vocabulary ${vocabulary.iri}${uncommitted(vocabulary)}`,
  );
  const bridge = new WasmBridge(inWorker(await compiledBridge(found.folder)));
  const configured = await loadConfiguredAdapters(
    bridge,
    components.config.adapters,
    components,
  );
  try {
    for (const { resolved } of configured)
      console.error(`adapter ${resolved.iri}${uncommitted(resolved)}`);
    const { person, steps } = await featureStory(
      files,
      story,
      () => new OxigraphStore(),
    );
    let written = 0;
    for (const { step, converted, failure, documents } of await kitImports({
      vocabulary: files,
      folder: person.folder,
      steps,
      importers: importersNamed(components.config.importers),
      adaptersOf: ofMediaType(configured),
    })) {
      const saved = converted.slice(person.folder.length + 1);
      if (failure !== undefined)
        console.error(
          `${step.name}: its importer refuses it: ${String(failure)}`,
        );
      for (const { stem, offered, accepting, repeated } of documents) {
        if (accepting === undefined)
          console.error(`${step.name} ${stem}: no adapter accepts it`);
        else if (
          repeated &&
          (await files.read(`${converted}/${stem}/graph.ttl`)) === undefined
        )
          console.error(`${step.name} ${stem}: converted before`);
        else {
          const made = await accepting.convert(offered, EVERY_FINDING);
          const folder = join(out, saved, stem);
          await mkdir(folder, { recursive: true });
          await writeFile(join(folder, "graph.ttl"), made.graph);
          await writeFile(
            join(folder, "findings.ttl"),
            made.findings ?? new Uint8Array(),
          );
          written++;
        }
      }
    }
    console.error(`${written} documents written to ${out}`);
  } finally {
    for (const { adapter } of configured) await adapter.free();
    bridge.close();
  }
  return 0;
}

/**
 * The Bridge's build a run reads, picked and downloaded, so the run's later steps read it from the cache. The build it
 * picked, whichever source, is recorded in `expected.json` beside it: the build the offline tests pin, which never ask the remote for another.
 */
async function bridge(): Promise<number> {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const cache = join(root, "build", "cache");
  const found = await findBridgePackage({
    siblingsIn: await siblingsOf(root),
    cache,
    log,
  });
  const at = join(cache, "cascade-bridge-rs");
  await mkdir(at, { recursive: true });
  await writeFile(
    join(at, "expected.json"),
    `${JSON.stringify(bridgeRecord(found, BRIDGE_REPOSITORY))}
`,
  );
  return 0;
}

/** Fetches Oxigraph's native build for this platform, unless it is kept already, and checks that it loads. */
async function fetchOxigraph(): Promise<number> {
  const file = await fetchNativeOxigraph();
  const engine = nativeOxigraph(file);
  if (engine instanceof Error) throw engine;
  log(`Oxigraph's native build is at ${file}, and loads`);
  return 0;
}

/** The pod layout of the vocabulary this checkout runs against. */
async function layoutHere(): Promise<Layout> {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const { files } = await localVocabulary(root, log);
  return Layout.read(files, () => new OxigraphStore());
}

/** Prints a file of a pod, held at its own path or in an archive. */
async function cat(args: string[]): Promise<number> {
  const [pod, path] = args;
  if (pod === undefined || path === undefined)
    throw new Error("usage: cat <pod folder> <path of a file in it>");
  process.stdout.write(await catFile(pod, await layoutHere(), path));
  return 0;
}

/** Writes a pod's files, or an archive's, into an empty folder, each at its own path, to look at them. */
async function unpackCommand(args: string[]): Promise<number> {
  const [from, to] = args;
  if (from === undefined || to === undefined)
    throw new Error("usage: unpack <pod folder or archive> <empty folder>");
  const written = await unpack(from, to, await layoutHere());
  console.error(`${written} files written to ${to}`);
  return 0;
}

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  bridge,
  cat,
  unpack: unpackCommand,
  conformance,
  "fetch-oxigraph": fetchOxigraph,
  "build-example-pod": buildExamplePod,
  "kit-bridge": saveKitBridge,
};

async function main(argv: string[]): Promise<number> {
  useOxigraph(() => chooseOxigraph());
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
