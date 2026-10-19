// The host `podApi` reads on Node: the pods are folders in `folder`, the reference tables are kept beside them.
import { join } from "node:path";
import { openPod, tablesBeside } from "cascade-runtime";
import { podNames, podTitle } from "./pods.mjs";

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
    },
    tables: () => tablesBeside(folder),
    opensEncrypted,
    unsaid,
  };
}
