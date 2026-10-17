import { mkdir, rm, writeFile } from "node:fs/promises";
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
  runConformance,
  type TestedWith,
} from "../conformance.js";
import { repositoryName } from "../config.js";
import { Shapes } from "../shapes.js";
import { MemoryFiles } from "../files.js";
import { Layout } from "../layout.js";
import { FolderFiles } from "./folder-files.js";
import { importersNamed } from "../importers.js";
import { type Resolved, resolve } from "./resolver.js";
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
} from "./runtime.js";
import { featurePod } from "./story-pod.js";
import { OxigraphStore } from "../oxigraph-store.js";
import { kitImports } from "../kit-bridge.js";
import { ofMediaType } from "../load-adapter.js";
import { WasmBridge } from "../wasm-bridge.js";
import { checkouts } from "./components.js";

const RUNTIME = "cascade-runtime-js";
const KIT = "conformance/";
const SPEC = "https://github.com/jayostis/cascade-bridge-spec";
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

async function conformance(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      report: { type: "string" },
      feature: { type: "string", multiple: true },
      folder: { type: "string", multiple: true, default: [] },
    },
  });
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const config = await readConfig(root);
  const report = absolute(
    values.report ?? join(root, "build", "conformance", "earl.nt"),
  );
  const folders = folderMap(values.folder);
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
  const layout = await Layout.read(files, () => new OxigraphStore());
  const assertions = await runConformance({
    vocabulary: files,
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
    importers: importersNamed(config.importers),
    layout,
    derive: await vocabularyDerive(files, layout),
    shapes: await Shapes.read(files, () => new OxigraphStore()),
    ...(values.feature === undefined ? {} : { features: values.feature }),
  });
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
  return 0;
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
        if (repeated) console.error(`${step.name} ${stem}: converted before`);
        else if (accepting === undefined)
          console.error(`${step.name} ${stem}: no adapter accepts it`);
        else {
          const made = await accepting.convert(offered);
          const folder = join(out, saved, stem);
          await mkdir(folder, { recursive: true });
          await writeFile(join(folder, "graph.ttl"), made.graph);
          await writeFile(join(folder, "findings.ttl"), made.findings);
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

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  conformance,
  "build-example-pod": buildExamplePod,
  "kit-bridge": saveKitBridge,
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
