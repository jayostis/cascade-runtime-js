import { dirname, join, resolve as absolute } from "node:path";
import { resolved } from "./node/resolved.js";
import { openPodWith, type Pod } from "./pod.js";
import type { Tables } from "./tables.js";

export type {
  Done,
  Exported,
  ExportSource,
  Imported,
  ImportOptions,
  ImportProgress,
  Opened,
  Pod,
  Row,
} from "./pod.js";
export type { Checked, Tables } from "./tables.js";
export * from "./connect/index.js";
export { loopbackSignIn, type LoopbackOptions } from "./node/loopback.js";

const beside = new Map<string, Promise<Tables>>();

/** How long the check an open waits on may take: a network that stalls must not hold a local pod closed. */
const CHECK_ON_OPEN_MS = 10_000;

/**
 * The tables an app keeps for the pods in the folder: `.tables/` in it, beside `.answers/`, checked against the feeds
 * when first asked for, unless `cascade-runtime.json` turns `checkOnOpen` off.
 */
export function tablesBeside(pods = "pods"): Promise<Tables> {
  const folder = join(absolute(pods), ".tables");
  let found = beside.get(folder);
  if (found === undefined) {
    const finding = resolved().then(async (parts) => {
      const tables = parts.tablesIn(folder);
      if (parts.local.config.tables.checkOnOpen)
        await tables.check({ signal: AbortSignal.timeout(CHECK_ON_OPEN_MS) });
      return tables;
    });
    found = finding;
    beside.set(folder, finding);
    finding.catch(() => beside.delete(folder));
  }
  return found;
}

/**
 * The pod in a folder on disk, given the tables of the folder it is in, or, with none, in memory, given the
 * package's starter copies; `options.title` is used only when the pod is new.
 */
export async function openPod(
  folder?: string,
  options: { title?: string } = {},
): Promise<Pod> {
  const parts = await resolved();
  return openPodWith(
    folder === undefined
      ? parts
      : { ...parts, tables: await tablesBeside(dirname(absolute(folder))) },
    folder,
    options,
  );
}
