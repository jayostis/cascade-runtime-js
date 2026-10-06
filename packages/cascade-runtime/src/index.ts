import { resolved } from "./node/resolved.js";
import { openPodWith, type Pod } from "./pod.js";

export type { Done, ExportSource, Imported, Pod, Row } from "./pod.js";

/** The pod in a folder on disk, or, with none, in memory; `options.title` is used only when the pod is new. */
export async function openPod(
  folder?: string,
  options: { title?: string } = {},
): Promise<Pod> {
  return openPodWith(await resolved(), folder, options);
}
