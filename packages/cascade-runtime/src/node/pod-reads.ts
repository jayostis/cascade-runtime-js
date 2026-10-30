// `cascade-runtime/tools/node`: the reads `cascade-runtime/tools` runs over, for the pods of a folder on disk.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Refusal, Unopened } from "@cascade-runtime/runtime";
import { changeTools, findChanges } from "../changes.js";
import { checkInput } from "../check.js";
import { openPod } from "../index.js";
import type { Pod } from "../pod.js";
import {
  CHANGE_TOOLS,
  citedFinding,
  type PodReads,
  unknownChangeTool,
} from "../pod-tools.js";

/** Where the pods are: their names, and each opened by name. */
export interface PodsHost {
  names(): Promise<string[]>;
  open(name: string): Promise<Pod>;
}

/** The pods of a folder: each folder in it that holds something and is not hidden, as `.answers/` and `.tables/` are. */
export function podsIn(folder: string): PodsHost {
  return {
    async names() {
      let entries;
      try {
        entries = await readdir(folder, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const names: string[] = [];
      for (const entry of entries)
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          (await readdir(join(folder, entry.name))).length > 0
        )
          names.push(entry.name);
      return names.sort();
    },
    open: (name) => openPod(join(folder, name)),
  };
}

/**
 * The reads over the pods `host` gives, each pod opened once however many calls arrive together; `close()` closes
 * them. An encrypted pod is refused.
 */
export function podReads(
  host: PodsHost,
): PodReads & { close(): Promise<void> } {
  const opened = new Map<string, Promise<Pod>>();

  /** The pod named, which must be one there is, opened once; a failed opening is forgotten. */
  async function podNamed(name: string): Promise<Pod> {
    let opening = opened.get(name);
    if (opening === undefined) {
      opening = (async () => {
        const names = await host.names();
        if (!names.includes(name))
          throw new Refusal(
            names.length === 0
              ? `there is no pod ${name}, and no pod at all`
              : `there is no pod ${name}; the pods are ${names.join(", ")}`,
          );
        return host.open(name);
      })();
      opened.set(name, opening);
      opening.catch(() => opened.delete(name));
    }
    try {
      return await opening;
    } catch (error) {
      if (error instanceof Unopened)
        throw new Refusal(
          `${name} is encrypted: these tools never open an encrypted pod, as its six words are the person's alone`,
        );
      throw error;
    }
  }

  return {
    async pods() {
      return { pods: (await host.names()).map((name) => ({ name })) };
    },
    async ask({ pod, question, limit }) {
      const rows = await (await podNamed(pod)).ask(question);
      return {
        question,
        total: rows.length,
        rows: limit === undefined ? rows : rows.slice(0, limit),
      };
    },
    async tool({ pod: name, tool: called, input = {} }) {
      unknownChangeTool(called);
      const pod = await podNamed(name);
      if (called !== "find_changes")
        return {
          value: await changeTools(pod)
            .find((each) => each.name === called)!
            .execute(input),
        };
      checkInput(
        CHANGE_TOOLS.find((each) => each.name === called)!.inputSchema,
        input,
      );
      const found = await findChanges(pod, input);
      return { value: found.map(citedFinding), found };
    },
    async close() {
      const pods = await Promise.allSettled(opened.values());
      opened.clear();
      await Promise.allSettled(
        pods.flatMap((each) =>
          each.status === "fulfilled" ? [each.value.close()] : [],
        ),
      );
    },
  };
}
