import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { vocabularyDerive } from "../build.js";
import { type Assertion, earl, runManifest } from "../conformance.js";
import { MemoryFiles } from "../files.js";
import { Layout } from "../layout.js";
import { FolderFiles } from "./folder-files.js";
import { importersNamed } from "./importers.js";
import { findRoot, readConfig, resolveVocabulary } from "./runtime.js";
import { OxigraphStore } from "../oxigraph-store.js";

const RUNTIME = "cascade-runtime-js";
const VECTORS = "runtime/vectors/manifest.ttl";

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
  return `${assertions.length} entries: ${count("passed")} passed, ${count("failed")} failed, ${count("inapplicable")} inapplicable`;
}

async function conformance(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      report: { type: "string" },
      manifest: { type: "string", default: VECTORS },
      folder: { type: "string", multiple: true, default: [] },
    },
  });
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const config = await readConfig(root);
  const report = absolute(
    values.report ?? join(root, "build", "conformance", "earl.nt"),
  );
  const log = (line: string): void => console.error(line);
  const vocabulary = await resolveVocabulary(
    root,
    config,
    folderMap(values.folder),
    log,
  );
  const files = new FolderFiles(vocabulary.folder, vocabulary.iri);
  const layout = await Layout.read(files, () => new OxigraphStore());
  const assertions = await runManifest({
    vocabulary: files,
    manifest: values.manifest,
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
    importers: importersNamed(config.importers),
    layout,
    derive: await vocabularyDerive(files, layout),
  });
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, earl(assertions, RUNTIME));
  console.error(`${summary(assertions)}; the EARL report is ${report}`);
  return 0;
}

function buildExamplePod(args: string[]): number {
  const [name = "<name>"] = args;
  console.error(
    `build:example-pod ${name}: cascade-vocabulary has no conformance kit to build it from yet; ` +
      "the kit, and this command, arrive with step 11 of jayostis/cascade-vocabulary#39",
  );
  return 2;
}

const COMMANDS: Record<string, (args: string[]) => number | Promise<number>> = {
  conformance,
  "build-example-pod": buildExamplePod,
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
