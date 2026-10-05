import { dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  clock,
  OxigraphStore,
  podDataset,
  questions,
} from "@cascade-runtime/runtime";
import {
  FolderFiles,
  findRoot,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { GraphDB, load } from "../index.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

/** Creates the repository `<name>` in the GraphDB at the URL and fills it with the pod build/<name>/pod. */
async function main(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { pod: { type: "string" } },
  });
  const [name, url] = positionals;
  if (name === undefined || url === undefined) {
    console.error(
      "usage: npm run graphdb -- <name> <GraphDB's base URL> [--pod <folder>]",
    );
    return 2;
  }
  try {
    const vocabulary = await localVocabulary(ROOT, (line) =>
      console.error(line),
    );
    const pod = new FolderFiles(
      values.pod === undefined
        ? join(ROOT, "build", name, "pod")
        : absolute(values.pod),
    );
    const built = await podDataset(
      pod,
      vocabulary.layout,
      vocabulary.build,
      vocabulary.config.lens,
      new OxigraphStore(),
      { title: name, at: clock.now() },
    );
    const loaded = await load(
      new GraphDB(url, name),
      built.title,
      built.store,
      await questions(vocabulary.files),
      (line) => console.error(line),
    );
    console.log(
      `${name}: ${loaded.graphs} graphs, ${loaded.statements} statements, ${loaded.saved.length} saved queries`,
    );
    return 0;
  } catch (error) {
    console.error(
      `graphdb: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
