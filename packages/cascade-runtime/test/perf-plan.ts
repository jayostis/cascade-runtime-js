import { DATASETS, PER_BUILD, type DatasetId } from "./perf-data.js";

/**
 * Each scenario's fixed id: the first part of every row's name. `floor` is the same input loaded as plainly as SQL can
 * (perf-floor.ts), which a fresh import is read against; it is run once for a size, beside the others. `stored` counts what
 * the pod the fresh runs left holds (perf-scenarios/stored.ts); the counts are exact, so it is run once, after the others.
 */
export const SCENARIOS = [
  "fresh-first-screen",
  "reopen-first-answer",
  "question-page",
  "close",
  "floor",
  "stored",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface Plan {
  readonly scenarios: ReadonlySet<Scenario>;
  readonly sizes: readonly DatasetId[];
  readonly encryption: "plain" | "encrypted" | "both" | "auto";
  readonly repeats: number;
  readonly probe: boolean;
  /** The folder the traces, the CPU profiles and `flame.json` go to; none are made without it. */
  readonly profiles?: string;
  /** Whether each scenario also gets a CPU profile, when there is a folder: one more run of it, unprobed. */
  readonly cpuProfile?: boolean;
}

export function parsed(args: string[]): {
  plan: Plan;
  out: string | undefined;
} {
  const value = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
  };
  const list = <T extends string>(
    text: string | undefined,
    all: readonly T[],
    what: string,
  ): T[] =>
    (text === undefined ? [...all] : text.split(",")).map((each) => {
      if (!(all as readonly string[]).includes(each))
        throw new Error(`no ${what} ${each}; there are ${all.join(", ")}`);
      return each as T;
    });
  const sizes = list(
    value("--size") ?? value("--sizes") ?? PER_BUILD,
    Object.keys(DATASETS) as DatasetId[],
    "size",
  );
  const encryption = (value("--encryption") ?? "auto") as Plan["encryption"];
  if (!["plain", "encrypted", "both", "auto"].includes(encryption))
    throw new Error("--encryption is plain, encrypted, both or auto");
  return {
    plan: {
      scenarios: new Set(list(value("--scenario"), SCENARIOS, "scenario")),
      sizes,
      encryption,
      repeats: Number(value("--repeats") ?? 3),
      probe: !args.includes("--no-probe"),
      ...(value("--profiles") !== undefined && {
        profiles: value("--profiles") as string,
      }),
      cpuProfile: !args.includes("--no-cpu-profile"),
    },
    out: value("--out"),
  };
}
