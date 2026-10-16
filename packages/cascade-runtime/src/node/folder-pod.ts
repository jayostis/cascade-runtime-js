import { resolve as absolute } from "node:path";
import { Refusal } from "@cascade-runtime/runtime";
import { headerIn } from "@cascade-runtime/runtime/node";
import { podKey } from "../encrypted.js";
import { openPodWith, type Parts, type Pod } from "../pod.js";

/**
 * The pod in the folder, or in memory with none, opened as `openPodWith` opens it; with a secret, a new pod is made
 * encrypted and an encrypted one opened. Throws `Unopened` when the pod does not open with what was given, and refuses
 * a secret for a pod in memory.
 */
export async function openFolderPod(
  parts: Parts,
  folder?: string,
  options: { title?: string; secret?: string } = {},
): Promise<Pod> {
  const { secret, ...rest } = options;
  if (folder === undefined) {
    if (secret !== undefined)
      throw new Refusal(
        "a pod in memory is never encrypted: give it a folder to open it with a secret",
      );
    return openPodWith(parts, undefined, rest);
  }
  const { files } = parts.folder(folder);
  const key = await podKey(
    {
      files,
      header: await headerIn(absolute(folder)),
      held: async () => (await files.list("")).length > 0,
    },
    secret,
    parts.derive,
  );
  return openPodWith(
    parts,
    folder,
    key === undefined ? rest : { ...rest, key },
  );
}
