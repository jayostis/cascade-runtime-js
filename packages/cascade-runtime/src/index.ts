import { dirname, join, resolve as absolute } from "node:path";
import { resolved } from "./node/resolved.js";
import { checkedOutcome, startedOutcome } from "./outcomes.js";
import type { Phase } from "./phase.js";
import { openPodWith, type Pod } from "./pod.js";
import { CHECK_ON_OPEN_MS, type Tables } from "./tables.js";

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
export type {
  About,
  ClassificationRow,
  Coded,
  Codes,
  Concept,
  Fact,
  Facts,
  Found,
  HeldSeries,
  HeldVersion,
  Searched,
  VariantAsked,
  Watched,
  WhatClinVarSays,
} from "./tables.js";
export type { TablesSettings } from "@cascade-runtime/runtime";
export * from "./changes.js";
export * from "./connect/index.js";
export * from "./tools.js";
export { Refusal } from "@cascade-runtime/runtime";
export { loopbackSignIn, type LoopbackOptions } from "./node/loopback.js";
export { configureTables } from "./node/resolved.js";

const beside = new Map<string, Promise<Tables>>();

/**
 * The tables an app keeps for the pods in the folder: `.tables/` in it, beside `.answers/`, checked against the feeds
 * when first asked for, unless `cascade-runtime.json` turns `checkOnOpen` off.
 */
export function tablesBeside(pods = "pods", phase?: Phase): Promise<Tables> {
  const folder = join(absolute(pods), ".tables");
  let found = beside.get(folder);
  if (found === undefined) {
    const finding = resolved().then(async (parts) => {
      const tables = parts.tablesIn(folder);
      if (phase === undefined) {
        if (parts.local.config.tables.checkOnOpen)
          await tables.check({ signal: AbortSignal.timeout(CHECK_ON_OPEN_MS) });
        return tables;
      }
      await phase(
        "Reading the reference tables the package carries into pods/.tables…",
        () => tables.start(),
        async (bytes) =>
          startedOutcome(bytes, bytes === 0 ? [] : await tables.held()),
      );
      if (parts.local.config.tables.checkOnOpen) {
        let signal = new AbortController().signal;
        await phase(
          `Checking ${parts.local.config.tables.feeds.join(", ")} for newer tables…`,
          () => {
            signal = AbortSignal.timeout(CHECK_ON_OPEN_MS);
            return tables.check({ signal });
          },
          async (checked) =>
            checkedOutcome(checked, await tables.held(), signal.aborted),
        );
      }
      await phase("Listing the tables' codes for search…", () =>
        tables.listing(),
      );
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
