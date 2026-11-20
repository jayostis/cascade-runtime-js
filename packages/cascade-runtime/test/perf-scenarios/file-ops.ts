import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { child } from "../perf-child.js";
import { PER_BUILD } from "../perf-data.js";
import { type Job, type Measured } from "../perf-job.js";
import { type Plan } from "../perf-plan.js";
import { clockRow, countRow, type Row } from "../perf-rows.js";

/** How many small files each operation is timed over. */
export const FILES = 3000;

/** The operations, in the order they are timed. */
export const FILE_OPS = [
  "absent-check",
  "create",
  "create-rename",
  "full-path",
] as const;

/** How many files of an operation are in flight at once. */
export const IN_FLIGHT = [1, 16, 64] as const;

/** A file's bytes: a few hundred, as most of a pod's files are. */
const OBJECT = new TextEncoder().encode("<a> <b> <c> .\n".repeat(20));

/** What one process measured: seconds per file for each `<operation>/in-flight-<n>`, and the seconds to write every file's bytes as one file. */
export interface FileOpsRun {
  readonly files: number;
  readonly perFile: Readonly<Record<string, number>>;
  /** All the files' bytes written as one file, then renamed over its name. */
  readonly whole: number;
  /** The same, with the file flushed to the drive before the rename. */
  readonly flushed?: number;
}

/** Runs `work` for the indexes 0..files-1, `atOnce` of them in flight, and gives the seconds per file. */
async function timed(
  files: number,
  atOnce: number,
  work: (index: number) => Promise<unknown>,
): Promise<number> {
  const started = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: atOnce }, async () => {
      for (;;) {
        const index = next++;
        if (index >= files) return;
        await work(index);
      }
    }),
  );
  return (performance.now() - started) / 1000 / files;
}

/** One file as the folder host writes it: a name beside it that is no file of the pod, renamed over the real one. */
async function createAndRename(dir: string, index: number): Promise<void> {
  const writing = join(dir, `f${index}.1.${index}.writing`);
  await writeFile(writing, OBJECT, { flag: "wx" });
  await rename(writing, join(dir, `f${index}`));
}

/**
 * Every operation at every number in flight, over `files` small files, in `folder` (which is left empty): the cost of asking
 * whether a file is there, of creating it, of creating and renaming it, and of what the folder host does for a file (look at
 * it, resolve its folder, create, rename); and writing the same bytes as one file.
 */
export async function fileOpsOnce(
  folder: string,
  files: number = FILES,
): Promise<FileOpsRun> {
  const operations: Record<
    (typeof FILE_OPS)[number],
    (dir: string, index: number) => Promise<unknown>
  > = {
    "absent-check": (dir, index) =>
      lstat(join(dir, `f${index}`)).catch(() => undefined),
    create: (dir, index) =>
      writeFile(join(dir, `f${index}`), OBJECT, { flag: "wx" }),
    "create-rename": createAndRename,
    "full-path": async (dir, index) => {
      await lstat(join(dir, `f${index}`)).catch(() => undefined);
      await realpath(dir);
      await createAndRename(dir, index);
    },
  };
  await mkdir(folder, { recursive: true });
  const perFile: Record<string, number> = {};
  for (const op of FILE_OPS)
    for (const atOnce of IN_FLIGHT) {
      const dir = join(folder, `${op}-${atOnce}`);
      await mkdir(dir, { recursive: true });
      perFile[`${op}/in-flight-${atOnce}`] = await timed(
        files,
        atOnce,
        (index) => operations[op](dir, index),
      );
      await rm(dir, { recursive: true, force: true });
    }
  const all = new Uint8Array(OBJECT.length * files);
  for (let at = 0; at < files; at++) all.set(OBJECT, at * OBJECT.length);
  const oneFile = async (flush: boolean): Promise<number> => {
    const dir = join(folder, flush ? "one-flushed" : "one");
    await mkdir(dir, { recursive: true });
    const started = performance.now();
    const writing = join(dir, "pack.writing");
    if (flush) {
      const handle = await open(writing, "wx");
      try {
        await handle.writeFile(all);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else await writeFile(writing, all, { flag: "wx" });
    await rename(writing, join(dir, "pack"));
    const seconds = (performance.now() - started) / 1000;
    await rm(dir, { recursive: true, force: true });
    return seconds;
  };
  const whole = await oneFile(false);
  const flushed = await oneFile(true);
  return { files, perFile, whole, flushed };
}

/** The file micro-bench in this process, in the job's folder, which it leaves empty. */
export async function measureFileOps(job: Job): Promise<Measured> {
  const fileOps = await fileOpsOnce(job.folder);
  await rm(job.folder, { recursive: true, force: true });
  return {
    seconds: {},
    parts: {},
    rssBytes: process.memoryUsage.rss(),
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    fileOps,
  };
}

/** Whether the machine's virus scanner was as it is, with its live checking switched off or on, or on with the folder excluded from it. */
export type ScannerState = "as-is" | "off" | "on" | "excluded";

const NAME = "file-ops-3000-files";

/** The rows of one state: the median over the runs of each operation, and the files counted. */
export function fileOpsRows(
  state: ScannerState,
  runs: readonly FileOpsRun[],
): Row[] {
  const name = state === "as-is" ? NAME : `${NAME}-scanner-${state}`;
  const how = `median of ${runs.length} runs, each in a process of its own, over ${runs[0]?.files ?? 0} files of ${OBJECT.length} bytes; ${
    state === "as-is"
      ? "the machine as it is"
      : state === "off"
        ? "the virus scanner's live checking switched off for the run"
        : state === "on"
          ? "the virus scanner's live checking switched on for the run, which the runner has off"
          : "the virus scanner's live checking on, the folder excluded from it"
  }`;
  const samples = (pick: (run: FileOpsRun) => number | undefined) =>
    runs.flatMap((run) => pick(run) ?? []);
  const keys = [...new Set(runs.flatMap((run) => Object.keys(run.perFile)))];
  const flushed = samples((run) => run.flushed);
  return [
    ...keys.map((key) =>
      clockRow(
        `${name}/${key}`,
        "s",
        samples((run) => run.perFile[key]),
        `seconds per file; ${how}`,
        9,
      ),
    ),
    clockRow(
      `${name}/one-file/whole`,
      "s",
      samples((run) => run.whole),
      `seconds to write every file's bytes as one file and rename it; ${how}`,
    ),
    ...(flushed.length === 0
      ? []
      : [
          clockRow(
            `${name}/one-file/whole-flushed`,
            "s",
            flushed,
            `seconds to write every file's bytes as one file, flush it to the drive and rename it; ${how}`,
          ),
        ]),
    countRow(`${name}/count/files`, runs[0]?.files ?? 0, how),
  ];
}

/** What the machine's virus scanner can be asked and told, where it has one. */
export interface Scanner {
  /** Whether its live checking is on; undefined where that cannot be read. */
  realtimeOn(): Promise<boolean | undefined>;
  setRealtime(on: boolean): Promise<void>;
  excluded(folder: string): Promise<boolean | undefined>;
  exclude(folder: string): Promise<void>;
  unexclude(folder: string): Promise<void>;
}

const execute = promisify(execFile);

/** Windows Defender, through PowerShell's Defender cmdlets; these need an administrator and refuse where tamper protection is on. */
export function windowsScanner(
  powershell: (script: string) => Promise<string> = async (script) =>
    (
      await execute("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ])
    ).stdout,
): Scanner {
  const quoted = (path: string) => `'${path.replaceAll("'", "''")}'`;
  const realtimeOn = async (): Promise<boolean | undefined> => {
    try {
      const said = (
        await powershell("(Get-MpComputerStatus).RealTimeProtectionEnabled")
      )
        .trim()
        .toLowerCase();
      return said === "true" ? true : said === "false" ? false : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    realtimeOn,
    async setRealtime(on) {
      await powershell(
        `Set-MpPreference -DisableRealtimeMonitoring $${on ? "false" : "true"}`,
      );
      // The status follows the setting after a moment.
      for (let waited = 0; waited < 20; waited++) {
        if ((await realtimeOn()) === on) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        `real-time protection is still ${on ? "off" : "on"} ten seconds after Set-MpPreference`,
      );
    },
    async excluded(folder) {
      try {
        return (
          (
            await powershell(
              `@((Get-MpPreference).ExclusionPath) -contains ${quoted(folder)}`,
            )
          )
            .trim()
            .toLowerCase() === "true"
        );
      } catch {
        return undefined;
      }
    },
    async exclude(folder) {
      await powershell(`Add-MpPreference -ExclusionPath ${quoted(folder)}`);
    },
    async unexclude(folder) {
      await powershell(`Remove-MpPreference -ExclusionPath ${quoted(folder)}`);
    },
  };
}

const message = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 300);

/**
 * The micro-bench's rows: the machine as it is and, when the plan compares and the machine has a scanner whose live checking is
 * on, with the checking switched off and with the folder excluded. Whatever it changed is put back, whether or not a
 * measurement fails, and what the scanner allowed is recorded either way.
 */
export async function fileOpsAt(
  plan: Plan,
  work: string,
  log: (line: string) => void,
  deps: {
    scanner?: Scanner;
    /** One process's measurement, in a folder of its own. */
    once?: (folder: string) => Promise<FileOpsRun>;
  } = {},
): Promise<Row[]> {
  const scanner =
    deps.scanner ??
    (process.platform === "win32" ? windowsScanner() : undefined);
  const once =
    deps.once ??
    (async (folder: string) => {
      const { fileOps } = await child(
        {
          scenario: "file-ops",
          dataset: PER_BUILD,
          encrypted: false,
          probed: false,
          folder,
          claim: [],
        },
        work,
      );
      if (fileOps === undefined)
        throw new Error("the file micro-bench measured nothing");
      return fileOps;
    });
  const batch = async (state: ScannerState): Promise<Row[]> => {
    const runs: FileOpsRun[] = [];
    for (let at = 0; at < plan.repeats; at++) {
      log(`file operations, ${state}: run ${at + 1}/${plan.repeats}`);
      runs.push(await once(join(work, `file-ops-${state}-${at}`)));
    }
    return fileOpsRows(state, runs);
  };
  const rows = await batch("as-is");
  const startedOn = await scanner?.realtimeOn();
  if (scanner === undefined || startedOn === undefined) return rows;
  rows.push(
    countRow(
      `${NAME}/count/scanner-realtime-on`,
      startedOn ? 1 : 0,
      "read from Windows Defender after the first measurement",
    ),
  );
  if (!plan.scannerCompare) return rows;

  // Live checking is flipped to the other state for a run: off where the runner has it on, on where it has it off, to read what
  // it costs either way. The folder's exclusion is read with it on.
  const flipTo = !startedOn;
  const flipName = flipTo ? "on" : "off";
  let flipped = false;
  let touched = false;
  const restore = async (): Promise<void> => {
    // A switch that took no effect has nothing to put back: a refusal to put back what was never changed is no failure.
    await scanner.setRealtime(startedOn).catch((error: unknown) => {
      if (flipped || !touched) throw error;
      log(`real-time protection could not be put back: ${message(error)}`);
    });
  };
  try {
    let refusal = "";
    try {
      touched = true;
      await scanner.setRealtime(flipTo);
      flipped = (await scanner.realtimeOn()) === flipTo;
      if (!flipped)
        refusal = `real-time protection was still ${startedOn ? "on" : "off"} after the switch`;
    } catch (error) {
      refusal = message(error);
    }
    rows.push(
      countRow(
        `${NAME}/count/scanner-switch-${flipName}-allowed`,
        flipped ? 1 : 0,
        flipped
          ? `Set-MpPreference -DisableRealtimeMonitoring $${flipTo ? "false" : "true"} took effect, read back from Get-MpComputerStatus`
          : `refused: ${refusal}`,
      ),
    );
    if (flipped) {
      rows.push(...(await batch(flipName)));
      rows.push(
        countRow(
          `${NAME}-scanner-${flipName}/count/scanner-realtime-on`,
          (await scanner.realtimeOn()) === true ? 1 : 0,
          "read back after the run",
        ),
      );
    }
    if (startedOn) await restore();
    if (startedOn || flipped)
      rows.push(...(await excludedRows(scanner, work, batch)));
  } finally {
    await restore();
  }
  return rows;
}

/** The folder excluded from a scanner whose live checking is on, one run, and the exclusion removed again. */
async function excludedRows(
  scanner: Scanner,
  work: string,
  batch: (state: ScannerState) => Promise<Row[]>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let excluded = false;
  let tried = false;
  let why = "";
  try {
    try {
      tried = true;
      await scanner.exclude(work);
      excluded = (await scanner.excluded(work)) === true;
      if (!excluded) why = "Get-MpPreference did not list the folder";
    } catch (error) {
      why = message(error);
    }
    rows.push(
      countRow(
        `${NAME}/count/scanner-exclusion-allowed`,
        excluded ? 1 : 0,
        excluded
          ? "Add-MpPreference -ExclusionPath took effect, read back from Get-MpPreference"
          : `refused: ${why}`,
      ),
    );
    if (excluded) {
      rows.push(...(await batch("excluded")));
      rows.push(
        countRow(
          `${NAME}-scanner-excluded/count/scanner-realtime-on`,
          (await scanner.realtimeOn()) === true ? 1 : 0,
          "read back during the run",
        ),
        countRow(
          `${NAME}-scanner-excluded/count/scanner-folder-excluded`,
          (await scanner.excluded(work)) === true ? 1 : 0,
          "read back during the run",
        ),
      );
    }
  } finally {
    if (tried)
      await scanner.unexclude(work).catch((error: unknown) => {
        if (excluded) throw error;
      });
  }
  return rows;
}
