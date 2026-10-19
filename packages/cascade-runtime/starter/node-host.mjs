// The host `podApi` reads on Node: the pods are folders in `folder`, the reference tables are kept beside them.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { openPod, tablesBeside } from "cascade-runtime";
import { deletePod, podNames, podTitle, restoreKits } from "./pods.mjs";

/**
 * The pods in `folder` and their tables, for `podApi`. With `opensEncrypted` false, an encrypted pod is refused rather
 * than asked for its words; `unsaid(kind, error)` is told when the tables cannot say what a page would name.
 */
export function nodeHost({ folder, opensEncrypted = true, unsaid = () => {} }) {
  return {
    pods: {
      names: () => podNames(folder),
      title: (name) => podTitle(name, folder),
      open: (name, options) => openPod(join(folder, name), options),
      /** Removes the pods and their answers, with `all` every answer kept; never the reference tables. */
      async remove(names, { all = false } = {}) {
        for (const name of names) await deletePod(name, folder);
        if (all)
          await rm(join(folder, ".answers"), { recursive: true, force: true });
      },
    },
    samples: [],
    restore: () => restoreKits(folder),
    tables: () => tablesBeside(folder),
    checkTables: async () =>
      (await tablesBeside(folder)).check({ cache: "no-cache" }),
    opensEncrypted,
    unsaid,
  };
}
