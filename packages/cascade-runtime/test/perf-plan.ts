import { DATASETS, PER_BUILD, type DatasetId } from "./perf-data.js";

/**
 * Each scenario's fixed id: the first part of every row's name. `floor` is the same input loaded as plainly as SQL can
 * (perf-floor.ts), which a fresh import is read against; it is run once for a size, beside the others. `stored` counts what
 * the pod the fresh runs left holds (perf-scenarios/stored.ts); the counts are exact, so it is run once, after the others.
 * `file-ops` is what one small file costs on the machine (perf-scenarios/file-ops.ts): it belongs to no size, and runs only
 * when asked for.
 */
export const SCENARIOS = [
  "fresh-first-screen",
  "reopen-first-answer",
  "question-page",
  "close",
  "floor",
  "stored",
  "reimport-identical",
  "reimport-changed",
  "add-one-record",
  "reopen-after-kill",
  "question-after-update",
  "file-ops",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** The scenarios that are run unless they are named by `--scenario` or asked for by a flag of their own. */
const ASKED_FOR: readonly Scenario[] = SCENARIOS.filter(
  (each) => each !== "file-ops",
);

/** A refusal that says what to do and needs nothing more said: the run stops with its message alone, exit code 2. */
export class Refusal extends Error {
  override readonly name = "Refusal";
}

export interface Plan {
  readonly scenarios: ReadonlySet<Scenario>;
  readonly sizes: readonly DatasetId[];
  readonly encryption: "plain" | "encrypted" | "both" | "auto";
  readonly repeats: number;
  readonly probe: boolean;
  /** Whether the file micro-bench is also run with the virus scanner's live checking off and with the folder excluded; where the machine has one. */
  readonly scannerCompare?: boolean;
  /** Whether the file micro-bench is run in a folder the scanner leaves alone and in one it does not, the scanner only read and nothing changed; the only scenario then run. */
  readonly scannerFolders?: boolean;
  /** The folders for that, where a person names them; otherwise they are found. */
  readonly folderExcluded?: string;
  readonly folderScanned?: string;
  /** The folder the traces, the CPU profiles and `flame.json` go to; none are made without it. */
  readonly profiles?: string;
  /** Whether each scenario also gets a CPU profile, when there is a folder: one more run of it, unprobed. */
  readonly cpuProfile?: boolean;
  /**
   * Whether each job of the day-to-day scenarios is run once, with the probed run and no CPU profile, and adding one result is
   * left out of a run that names no scenario, so that each build's job stays short (they are seconds long even at the per-build
   * size). The nightly and hand-started runs leave it off and run every job as often as any scenario; naming a scenario runs it.
   */
  readonly lightJobs?: boolean;
}

export function parsed(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
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
    /** What none named means, where it is not all of them. */
    otherwise: readonly T[] = all,
  ): T[] =>
    (text === undefined ? [...otherwise] : text.split(",")).map((each) => {
      if (!(all as readonly string[]).includes(each))
        throw new Error(`no ${what} ${each}; there are ${all.join(", ")}`);
      return each as T;
    });
  const sizes = list(
    value("--size") ?? value("--sizes") ?? PER_BUILD,
    Object.keys(DATASETS) as DatasetId[],
    "size",
  );
  // The comparison changes the machine's virus scanner and puts it back in this process only: a stopped parent can leave it changed
  // (Defender can end the process itself), which a hosted runner thrown away after the job does not mind and a person's computer
  // does. Nothing lifts this on a machine that is not a runner; `--scanner-folders` compares without changing anything.
  if (args.includes("--scanner-compare") && env.GITHUB_ACTIONS !== "true")
    throw new Refusal(
      "--scanner-compare changes Windows Defender's settings and puts them back; it runs on GitHub Actions' throwaway runners only, never on a person's machine. To compare on this machine without changing anything, use --scanner-folders",
    );
  if (args.includes("--scanner-compare") && args.includes("--scanner-folders"))
    throw new Refusal(
      "--scanner-compare and --scanner-folders are two ways to compare; use one",
    );
  if (
    !args.includes("--scanner-folders") &&
    (value("--folder-excluded") !== undefined ||
      value("--folder-scanned") !== undefined)
  )
    throw new Refusal(
      "--folder-excluded and --folder-scanned name the folders of --scanner-folders, which was not given",
    );
  // The folder comparison measures the file micro-bench and nothing else: a laptop is not asked to build and measure the suite.
  if (
    args.includes("--scanner-folders") &&
    value("--scenario") !== undefined &&
    value("--scenario") !== "file-ops"
  )
    throw new Refusal(
      "--scanner-folders measures the file operations only; leave out --scenario or give file-ops",
    );
  const encryption = (value("--encryption") ?? "auto") as Plan["encryption"];
  if (!["plain", "encrypted", "both", "auto"].includes(encryption))
    throw new Error("--encryption is plain, encrypted, both or auto");
  return {
    plan: {
      scenarios: args.includes("--scanner-folders")
        ? new Set<Scenario>(["file-ops"])
        : new Set([
            ...list(
              value("--scenario"),
              SCENARIOS,
              "scenario",
              args.includes("--light-jobs")
                ? ASKED_FOR.filter((each) => each !== "add-one-record")
                : ASKED_FOR,
            ),
            ...(args.includes("--file-ops") ? ["file-ops" as const] : []),
          ]),
      scannerCompare: args.includes("--scanner-compare"),
      scannerFolders: args.includes("--scanner-folders"),
      ...(value("--folder-excluded") !== undefined && {
        folderExcluded: value("--folder-excluded") as string,
      }),
      ...(value("--folder-scanned") !== undefined && {
        folderScanned: value("--folder-scanned") as string,
      }),
      sizes,
      encryption,
      repeats: Number(value("--repeats") ?? 3),
      probe: !args.includes("--no-probe"),
      ...(value("--profiles") !== undefined && {
        profiles: value("--profiles") as string,
      }),
      cpuProfile: !args.includes("--no-cpu-profile"),
      lightJobs: args.includes("--light-jobs"),
    },
    out: value("--out"),
  };
}
