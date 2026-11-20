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
import { join, parse } from "node:path";
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

/**
 * Whether the machine's virus scanner was as it is, with its live checking switched off, with its live, file and script checking on and none
 * of the runner's excluded folders, or with those on and the folder excluded.
 */
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
          ? "the virus scanner's live, file and script checking switched on for the run and the runner's excluded folders taken off its list"
          : "the virus scanner's checking on, the folder excluded from it"
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

/** What a virus scanner is set to: each kind of checking it does and the folders it leaves alone. */
export interface ScannerSettings {
  /** Live checking of every file as it is read or written. */
  readonly realtime: boolean;
  /** Checking of files as they are opened or downloaded. */
  readonly fileOpening: boolean;
  /** Watching what a program does. */
  readonly behaviour: boolean;
  /** Checking of scripts. */
  readonly scripts: boolean;
  readonly excludedFolders: readonly string[];
  /** How the scanner runs, as it names it, where it says. */
  readonly mode?: string;
}

/** What the machine's virus scanner can be asked and told, where it has one. */
export interface Scanner {
  /** What it is set to; undefined where that cannot be read. */
  read(): Promise<ScannerSettings | undefined>;
  /** Sets every kind of checking and the excluded folders to these, and throws where the scanner is still not so set. */
  set(settings: ScannerSettings): Promise<void>;
}

const folderKey = (folder: string): string =>
  folder.toLowerCase().replace(/(?<=.)\\+$/, "");

/** Whether two sets of settings are the same in everything a run changes. */
export function sameSettings(a: ScannerSettings, b: ScannerSettings): boolean {
  const folders = (settings: ScannerSettings) =>
    [...new Set(settings.excludedFolders.map(folderKey))].sort().join("\n");
  return (
    a.realtime === b.realtime &&
    a.fileOpening === b.fileOpening &&
    a.behaviour === b.behaviour &&
    a.scripts === b.scripts &&
    folders(a) === folders(b)
  );
}

/** The settings in a sentence, for the row that records them. */
export function describeSettings(settings: ScannerSettings): string {
  const kind = (on: boolean) => (on ? "on" : "off");
  return `live checking ${kind(settings.realtime)}, file-opening checking ${kind(settings.fileOpening)}, behaviour monitoring ${kind(settings.behaviour)}, script scanning ${kind(settings.scripts)}, excluded folders [${settings.excludedFolders.join(", ")}]${settings.mode === undefined ? "" : `, running mode ${settings.mode}`}`;
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
  const read = async (): Promise<ScannerSettings | undefined> => {
    try {
      const said = JSON.parse(
        (
          await powershell(
            "$p = Get-MpPreference; $s = Get-MpComputerStatus; [pscustomobject]@{ realtime = [bool]$s.RealTimeProtectionEnabled; fileOpening = -not $p.DisableIOAVProtection; behaviour = -not $p.DisableBehaviorMonitoring; scripts = -not $p.DisableScriptScanning; excludedFolders = @($p.ExclusionPath | Where-Object { $_ }); mode = [string]$s.AMRunningMode } | ConvertTo-Json -Compress",
          )
        ).trim(),
      ) as Record<string, unknown>;
      const folders = Array.isArray(said.excludedFolders)
        ? said.excludedFolders
        : said.excludedFolders === undefined || said.excludedFolders === null
          ? []
          : [said.excludedFolders];
      return {
        realtime: said.realtime === true,
        fileOpening: said.fileOpening === true,
        behaviour: said.behaviour === true,
        scripts: said.scripts === true,
        excludedFolders: folders.map(String),
        ...(typeof said.mode === "string" && said.mode !== ""
          ? { mode: said.mode }
          : {}),
      };
    } catch {
      return undefined;
    }
  };
  return {
    read,
    async set(settings) {
      const now = await read();
      const off = (on: boolean) => `$${on ? "false" : "true"}`;
      await powershell(
        `Set-MpPreference -DisableRealtimeMonitoring ${off(settings.realtime)} -DisableIOAVProtection ${off(settings.fileOpening)} -DisableBehaviorMonitoring ${off(settings.behaviour)} -DisableScriptScanning ${off(settings.scripts)}`,
      );
      const wanted = new Set(settings.excludedFolders.map(folderKey));
      const had = new Set((now?.excludedFolders ?? []).map(folderKey));
      for (const folder of now?.excludedFolders ?? [])
        if (!wanted.has(folderKey(folder)))
          await powershell(
            `Remove-MpPreference -ExclusionPath ${quoted(folder)}`,
          );
      for (const folder of settings.excludedFolders)
        if (!had.has(folderKey(folder)))
          await powershell(`Add-MpPreference -ExclusionPath ${quoted(folder)}`);
      // The status follows the settings after a moment.
      for (let waited = 0; waited < 20; waited++) {
        const after = await read();
        if (after !== undefined && sameSettings(after, settings)) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        `the scanner is still not set as asked ten seconds after Set-MpPreference: ${describeSettings((await read()) ?? settings)}`,
      );
    },
  };
}

const message = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 400);

/** What a process offers to put a scanner back when it is stopped. */
export interface SignalHost {
  once(signal: "SIGINT" | "SIGTERM", handler: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", handler: () => void): unknown;
  exit(code: number): unknown;
}

/** Runs `restore` when the process is interrupted or told to stop, then exits; the returned function takes the handlers off. */
export function restoringOnSignals(
  restore: () => Promise<void>,
  host: SignalHost = process as unknown as SignalHost,
): () => void {
  const installed = (["SIGINT", "SIGTERM"] as const).map((signal) => {
    const handler = () => {
      void restore().finally(() => host.exit(signal === "SIGINT" ? 130 : 143));
    };
    host.once(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    for (const [signal, handler] of installed) host.off(signal, handler);
  };
}

/**
 * The micro-bench's rows: the machine as it is and, when the plan compares and the machine has a scanner, with its live
 * checking switched off (where it was on), with its live, file and script checking on and the runner's excluded folders taken off, and with the
 * folder excluded. What the scanner is set to is recorded for each, and whatever was changed is put back and checked, whether or
 * not a measurement fails or the process is stopped.
 */
export async function fileOpsAt(
  plan: Plan,
  work: string,
  log: (line: string) => void,
  deps: {
    scanner?: Scanner;
    /** One process's measurement, in a folder of its own. */
    once?: (folder: string) => Promise<FileOpsRun>;
    signals?: SignalHost;
    /** Called with the rows so far after each state, so that a run that is killed keeps what it had. */
    keep?: (rows: readonly Row[]) => Promise<void>;
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
  // The scanner is told to leave this folder alone, not the whole of `work`, which holds the runs' own results too.
  const excludedHome = join(work, "left-alone");
  const batch = async (state: ScannerState): Promise<Row[]> => {
    const runs: FileOpsRun[] = [];
    for (let at = 0; at < plan.repeats; at++) {
      log(`file operations, ${state}: run ${at + 1}/${plan.repeats}`);
      runs.push(
        await once(
          join(
            state === "excluded" ? excludedHome : work,
            `file-ops-${state}-${at}`,
          ),
        ),
      );
    }
    return fileOpsRows(state, runs);
  };
  const rows = await batch("as-is");
  // The folder the files were made in, as the system names it, and the drive it is on: where a person's pod would be is another.
  const real = await realpath(work).catch(() => work);
  const left = join(real, "left-alone");
  rows.push(
    countRow(
      `${NAME}/count/work-folder`,
      1,
      `the files were made under ${real}, on the drive ${parse(real).root}`,
    ),
  );
  const start = await scanner?.read();
  if (scanner === undefined || start === undefined) return rows;
  rows.push(
    countRow(
      `${NAME}/count/scanner-realtime-on`,
      start.realtime ? 1 : 0,
      describeSettings(start),
    ),
  );
  if (!plan.scannerCompare) return rows;

  // Every check of a file is on, and nothing is left alone. Behaviour monitoring stays as it was: with it on, Defender ended the
  // process that changed its settings and started another (Behavior:Win32/NodeSuspProcLaunch.D, run 44824490994), and it checks
  // what a program does, not the files it makes.
  const scanning: ScannerSettings = {
    ...start,
    realtime: true,
    fileOpening: true,
    scripts: true,
    excludedFolders: [],
  };
  let changed = false;
  let restored: { ok: boolean; says: string } | undefined;
  const restore = async (): Promise<void> => {
    if (!changed || restored?.ok === true) return;
    await scanner.set(start).catch((error: unknown) => {
      log(`the scanner's settings could not be put back: ${message(error)}`);
    });
    const after = await scanner.read().catch(() => undefined);
    restored = {
      ok: after !== undefined && sameSettings(after, start),
      says:
        after === undefined
          ? "the settings could not be read back"
          : describeSettings(after),
    };
    if (!restored.ok)
      log(
        `THE SCANNER IS NOT AS IT WAS: ${restored.says}; it was ${describeSettings(start)}`,
      );
  };
  /** Sets the scanner to `settings`, records whether it let that be, and measures when it did. */
  const attempt = async (
    state: Exclude<ScannerState, "as-is">,
    settings: ScannerSettings,
  ): Promise<boolean> => {
    const allowedName = {
      off: "scanner-switch-off-allowed",
      on: "scanner-switch-on-allowed",
      excluded: "scanner-exclusion-allowed",
    }[state];
    let refusal = "";
    changed = true;
    log(`scanner, ${state}: setting ${describeSettings(settings)}`);
    try {
      await scanner.set(settings);
    } catch (error) {
      refusal = message(error);
    }
    const now = await scanner.read();
    const took = now !== undefined && sameSettings(now, settings);
    if (!took && refusal === "")
      refusal = `the scanner read back ${now === undefined ? "nothing" : describeSettings(now)}`;
    rows.push(
      countRow(
        `${NAME}/count/${allowedName}`,
        took ? 1 : 0,
        took
          ? `set through Set-MpPreference, Add-MpPreference and Remove-MpPreference, read back from Get-MpPreference: ${describeSettings(settings)}`
          : `refused: ${refusal}`,
      ),
    );
    if (!took) return false;
    rows.push(...(await batch(state)));
    await deps.keep?.(rows);
    const during = await scanner.read();
    rows.push(
      countRow(
        `${NAME}-scanner-${state}/count/scanner-realtime-on`,
        during?.realtime === true ? 1 : 0,
        during === undefined ? "unreadable" : describeSettings(during),
      ),
    );
    if (state === "excluded")
      rows.push(
        countRow(
          `${NAME}-scanner-excluded/count/scanner-folder-excluded`,
          (during?.excludedFolders ?? []).some(
            (folder) => folderKey(folder) === folderKey(left),
          )
            ? 1
            : 0,
          `${left}, read back after the run`,
        ),
      );
    return true;
  };
  const stopListening = restoringOnSignals(restore, deps.signals);
  try {
    if (start.realtime) await attempt("off", { ...start, realtime: false });
    const everythingOn = sameSettings(start, scanning);
    const onWorked = everythingOn ? true : await attempt("on", scanning);
    await attempt("excluded", {
      ...(onWorked ? scanning : start),
      excludedFolders: [...(onWorked ? scanning : start).excludedFolders, left],
    });
    await restore();
    rows.push(
      countRow(
        `${NAME}/count/scanner-restored`,
        restored?.ok === true ? 1 : 0,
        `read back after the last run: ${restored?.says ?? "nothing was changed"}`,
      ),
    );
  } catch (error) {
    log(`the comparison failed: ${message(error)}`);
    throw error;
  } finally {
    stopListening();
    await restore();
  }
  return rows;
}
