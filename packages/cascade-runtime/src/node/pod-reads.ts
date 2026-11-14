// `cascade-runtime/tools/node`: the reads `cascade-runtime/tools` runs over, for the pods of a folder on disk.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomId, Refusal, Unopened } from "@cascade-runtime/runtime";
import { changeTools, findChanges } from "../changes.js";
import { checkInput } from "../check.js";
import { compactRead } from "../compact-read.js";
import { openPod, tablesBeside } from "../index.js";
import type { Pod } from "../pod.js";
import type { Tables } from "../tables.js";
import {
  CHANGE_TOOLS,
  citedLabChange,
  type PodReads,
  type TableLookups,
  unknownChangeTool,
} from "../pod-tools.js";
import { proposedTurtle } from "../propose-tools.js";

export { proposer } from "./proposer.js";

/** Where the pods are: their names, each opened by name, and the reference tables they are opened with. */
export interface PodsHost {
  names(): Promise<string[]>;
  open(name: string): Promise<Pod>;
  tables?(): Promise<Pick<Tables, "about" | "variantClassification" | "held">>;
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
    tables: () => tablesBeside(folder),
  };
}

/**
 * The reads over the pods `host` gives, each pod opened once however many calls arrive together; `close()` closes
 * them. An encrypted pod is refused. The reference tables are read only with `options.tables`.
 */
export function podReads(
  host: PodsHost,
  options: { tables?: boolean } = {},
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
    async ask({ pod, question, limit, offset = 0 }) {
      const rows = await (await podNamed(pod)).ask(question);
      return {
        question,
        total: rows.length,
        ...(offset === 0 ? {} : { offset }),
        rows: rows.slice(
          offset,
          limit === undefined ? undefined : offset + limit,
        ),
      };
    },
    async compact({ pod, ...input }) {
      const asked = await podNamed(pod);
      return compactRead((question) => asked.ask(question), input);
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
      return { value: found.map(citedLabChange), found };
    },
    async write({ pod: name, proposal, model }) {
      const pod = await podNamed(name);
      const turtle = proposedTurtle(proposal, {
        model,
        owner: pod.owner,
        session: randomId(),
      });
      if (proposal.kind === "entry") {
        const { refused, activity } = await pod.enter(turtle);
        return {
          ...(refused === undefined ? {} : { refused }),
          ...(activity === undefined ? {} : { id: activity }),
        };
      }
      if (proposal.kind === "retraction") {
        const held = await pod.ask({
          query: `SELECT ?judgment WHERE { ?judgment a ?kind FILTER (?judgment = <${proposal.judgment}> && ?kind IN (<https://ns.cascadeprotocol.org/cascade#Judgment>, <https://ns.cascadeprotocol.org/cascade#MatcherJudgmentAssertion>)) }`,
        });
        if (held.length === 0)
          throw new Refusal(
            `the pod holds no judgment ${proposal.judgment} to retract`,
          );
      }
      let filed;
      try {
        filed = await pod.judge(turtle);
      } catch (error) {
        throw new Refusal(
          error instanceof Error ? error.message : String(error),
        );
      }
      return {
        ...(filed.refused === undefined ? {} : { refused: filed.refused }),
        ...(filed.judgment === undefined ? {} : { id: filed.judgment }),
      };
    },
    ...(options.tables === true &&
      host.tables !== undefined && {
        async tables({ pod: name }): Promise<TableLookups> {
          const [pod, tables] = await Promise.all([
            podNamed(name),
            host.tables!(),
          ]);
          return {
            held: () => tables.held(),
            about: (codes) => tables.about(codes),
            variantClassification: (variant) =>
              tables.variantClassification(variant),
            agreement: () => pod.agreement(),
          };
        },
      }),
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
