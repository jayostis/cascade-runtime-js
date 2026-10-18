import { dirname, join, resolve as absolute } from "node:path";
import { resolved } from "./node/resolved.js";
import { checkedOutcome, startedOutcome } from "./outcomes.js";
import type { Phase } from "./phase.js";
import { openFolderPod } from "./node/folder-pod.js";
import type { Pod } from "./pod.js";
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
export {
  Refusal,
  Unopened,
  type UnopenedOutcome,
} from "@cascade-runtime/runtime";
export { sixWords, typedWords } from "./six-words.js";
export { loopbackSignIn, type LoopbackOptions } from "./node/loopback.js";
export { configureTables } from "./node/resolved.js";

const beside = new Map<string, Promise<Tables>>();

/**
 * The tables an app keeps for the pods in the folder: `.tables/` in it, beside `.answers/`, checked against the feeds
 * in the background when first asked for, unless `cascade-runtime.json` turns `checkOnOpen` off; the first use answers
 * with the tables held, and a later one with what the check kept. With a `phase`, the check is waited for and reported.
 */
export function tablesBeside(pods = "pods", phase?: Phase): Promise<Tables> {
  const folder = join(absolute(pods), ".tables");
  let found = beside.get(folder);
  if (found === undefined) {
    const finding = resolved().then(async (parts) => {
      const tables = parts.tablesIn(folder);
      if (phase === undefined) {
        if (parts.local.config.tables.checkOnOpen)
          void tables
            .check({ signal: AbortSignal.timeout(CHECK_ON_OPEN_MS) })
            .catch(() => undefined);
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
 * package's starter copies; `options.title` is used only when the pod is new. With `options.secret`, a new pod is made
 * encrypted under it, and an encrypted pod opens with it, as typed or as `typedWords` cleans it; an encrypted pod that
 * does not open, or a secret given for a plaintext pod, throws `Unopened`.
 */
export async function openPod(
  folder?: string,
  options: { title?: string; secret?: string } = {},
): Promise<Pod> {
  const parts = await resolved();
  return openFolderPod(
    folder === undefined
      ? parts
      : { ...parts, tables: await tablesBeside(dirname(absolute(folder))) },
    folder,
    options,
  );
}
