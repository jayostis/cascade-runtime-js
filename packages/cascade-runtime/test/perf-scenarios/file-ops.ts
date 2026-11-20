import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, win32 } from "node:path";
import { promisify } from "node:util";
import { child } from "../perf-child.js";
import { PER_BUILD } from "../perf-data.js";
import { type Job, type Measured } from "../perf-job.js";
import { Refusal, type Plan } from "../perf-plan.js";
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
 * of the runner's excluded folders, or with those on and the folder excluded; or, on a machine whose scanner is not changed at all,
 * in a folder inside one the scanner leaves alone or in a folder outside every one.
 */
export type ScannerState =
  | "as-is"
  | "off"
  | "on"
  | "excluded"
  | "in-excluded-folder"
  | "in-scanned-folder";

const NAME = "file-ops-3000-files";

/** The prefix of a state's rows. */
const rowsOf = (state: ScannerState): string =>
  state === "as-is" ? NAME : `${NAME}-scanner-${state}`;

/** The rows of one state: the median over the runs of each operation, and the files counted. */
export function fileOpsRows(
  state: ScannerState,
  runs: readonly FileOpsRun[],
): Row[] {
  const name = rowsOf(state);
  const how = `median of ${runs.length} runs, each in a process of its own, over ${runs[0]?.files ?? 0} files of ${OBJECT.length} bytes; ${
    state === "as-is"
      ? "the machine as it is"
      : state === "off"
        ? "the virus scanner's live checking switched off for the run"
        : state === "on"
          ? "the virus scanner's live, file and script checking switched on for the run and the runner's excluded folders taken off its list"
          : state === "excluded"
            ? "the virus scanner's checking on, the folder excluded from it"
            : state === "in-excluded-folder"
              ? "the scanner as the machine has it, the files made in a folder inside one the scanner leaves alone"
              : "the scanner as the machine has it, the files made in a folder outside every one the scanner leaves alone"
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
  /** What the scanner's status says of itself (Get-MpComputerStatus), which can differ from what its preferences say. */
  readonly reported?: {
    readonly fileOpening: boolean;
    readonly behaviour: boolean;
  };
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
  return `live checking ${kind(settings.realtime)}, file-opening checking ${kind(settings.fileOpening)}, behaviour monitoring ${kind(settings.behaviour)}, script scanning ${kind(settings.scripts)}, excluded folders [${settings.excludedFolders.join(", ")}]${settings.mode === undefined ? "" : `, running mode ${settings.mode}`}${settings.reported === undefined ? "" : `; Get-MpComputerStatus: IoavProtectionEnabled ${settings.reported.fileOpening}, BehaviorMonitorEnabled ${settings.reported.behaviour}`}`;
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
            "$p = Get-MpPreference; $s = Get-MpComputerStatus; [pscustomobject]@{ realtime = [bool]$s.RealTimeProtectionEnabled; fileOpening = -not $p.DisableIOAVProtection; behaviour = -not $p.DisableBehaviorMonitoring; scripts = -not $p.DisableScriptScanning; excludedFolders = @($p.ExclusionPath | Where-Object { $_ }); mode = [string]$s.AMRunningMode; reportedFileOpening = [bool]$s.IoavProtectionEnabled; reportedBehaviour = [bool]$s.BehaviorMonitorEnabled } | ConvertTo-Json -Compress",
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
        ...(typeof said.reportedFileOpening === "boolean" &&
        typeof said.reportedBehaviour === "boolean"
          ? {
              reported: {
                fileOpening: said.reportedFileOpening,
                behaviour: said.reportedBehaviour,
              },
            }
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
      // Last, and only when a kind of checking is to change: with checking on, Defender refuses a command that switches it off
      // (Trojan:Win32/PowExcEnv.B!MTB, and the process cannot be started), so the folders are put back before this is tried.
      if (
        now === undefined ||
        now.realtime !== settings.realtime ||
        now.fileOpening !== settings.fileOpening ||
        now.behaviour !== settings.behaviour ||
        now.scripts !== settings.scripts
      )
        await powershell(
          `Set-MpPreference -DisableRealtimeMonitoring ${off(settings.realtime)} -DisableIOAVProtection ${off(settings.fileOpening)} -DisableBehaviorMonitoring ${off(settings.behaviour)} -DisableScriptScanning ${off(settings.scripts)}`,
        );
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

/** The signals that stop a process, and the exit code each ends with (128 and the signal's number; SIGBREAK is Ctrl-Break on Windows). */
const STOPS = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGBREAK: 149,
} as const;

/** What a process offers to put a scanner back when it is stopped. */
export interface SignalHost {
  on(signal: keyof typeof STOPS, handler: () => void): unknown;
  off(signal: keyof typeof STOPS, handler: () => void): unknown;
  exit(code: number): unknown;
}

/**
 * Runs `restore` when the process is interrupted, told to stop, or its terminal is closed, then exits; the returned function
 * takes the handlers off. The handlers stay on while the settings are put back, and a second signal in that time is ignored,
 * where Node's own handling of it would end the process with the settings still changed.
 */
export function restoringOnSignals(
  restore: () => Promise<void>,
  host: SignalHost = process as unknown as SignalHost,
): () => void {
  let stopping = false;
  const installed = (Object.keys(STOPS) as (keyof typeof STOPS)[]).map(
    (signal) => {
      const handler = () => {
        if (stopping) return;
        stopping = true;
        void restore().finally(() => host.exit(STOPS[signal]));
      };
      host.on(signal, handler);
      return [signal, handler] as const;
    },
  );
  return () => {
    for (const [signal, handler] of installed) host.off(signal, handler);
  };
}

/** Runs the jobs it is given one after another, each after the one before has ended, whether it was fulfilled or not. */
export function inTurn(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (job) => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
}

/** Whether a folder is a folder of the list or inside one (a path in the list that holds a wildcard or a variable is not matched). */
export function insideListed(
  path: string,
  listed: readonly string[],
): string | undefined {
  const key = folderKey(path);
  return listed.find((entry) => {
    if (/[*?%]/.test(entry)) return false;
    const at = folderKey(entry);
    return key === at || key.startsWith(`${at}\\`) || key.startsWith(`${at}/`);
  });
}

/** Defender lists this, and nothing else, to a shell that is not an administrator's. */
const hidden = (entry: string): boolean => /^N\/A/i.test(entry);

/**
 * Why a folder is one this comparison does not write 3,000 files into on its own, or undefined: a drive's root, a program or
 * system folder (and what is inside one), and a user's profile folder itself or the folder holding the profiles.
 */
export function systemFolder(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (win32.parse(path).base === "") return "a drive's root";
  const key = folderKey(path);
  const inside = (parent: string | undefined): boolean => {
    if (parent === undefined || parent === "") return false;
    const at = folderKey(parent);
    return key === at || key.startsWith(`${at}\\`) || key.startsWith(`${at}/`);
  };
  const programs = [
    env.ProgramFiles ?? "C:\\Program Files",
    env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    env.ProgramW6432,
    env.ProgramData ?? "C:\\ProgramData",
    env.windir ?? env.SystemRoot ?? "C:\\Windows",
  ];
  const found = programs.find(inside);
  if (found !== undefined) return `inside ${found}, a program or system folder`;
  const profile = env.USERPROFILE;
  if (profile !== undefined && profile !== "") {
    const profiles = win32.dirname(profile);
    if (key === folderKey(profile) || key === folderKey(profiles))
      return "a user's profile folder, or the folder that holds them";
    if (folderKey(win32.dirname(path)) === folderKey(profiles))
      return "a user's profile folder";
  }
  return undefined;
}

/**
 * What a person has to know before reading the two folders' times as what the scanner costs: whether it is checking at all, which
 * entries of the list were not compared with the folders, and what is not read. Nothing here changes anything.
 */
export function scannerNotes(settings: ScannerSettings): string[] {
  const idle = [
    ...(settings.realtime ? [] : ["its live checking is off"]),
    ...(settings.fileOpening ? [] : ["its file-opening checking is off"]),
    ...(settings.reported?.fileOpening === false
      ? ["Get-MpComputerStatus says its file-opening protection is not enabled"]
      : []),
    ...(settings.mode === undefined || /^normal$/i.test(settings.mode)
      ? []
      : [
          `it runs in ${settings.mode} mode, which usually means another antivirus program is the one scanning`,
        ]),
  ];
  const unmatched = settings.excludedFolders.filter((entry) =>
    /[*?%]/.test(entry),
  );
  return [
    ...(idle.length === 0
      ? []
      : [
          `WARNING: neither folder is being scanned by Windows Defender: ${idle.join("; ")}. A flat result then says nothing about what scanning costs; it only says that two folders on this machine take the same time.`,
        ]),
    ...(unmatched.length === 0
      ? []
      : [
          `WARNING: ${unmatched.length} of the excluded list's entries hold a wildcard or a variable (${unmatched.join(", ")}) and are not compared with the folders, so a folder under one of them is read as scanned although Defender leaves it alone. If the scanned folder is under one, neither folder is scanned and a flat result says nothing about scanning: name a --folder-scanned that none of them covers.`,
        ]),
    "Only the excluded folders are read: Defender's process and file-extension exclusions are not, and files that one of them covers are not scanned in either folder.",
  ];
}

const microseconds = (seconds: number): string => {
  const us = seconds * 1e6;
  return `${us >= 100 ? Math.round(us) : us >= 10 ? +us.toFixed(1) : +us.toFixed(2)} µs`;
};

/** A range of a row, `0.000225-0.000375` seconds, as `225-375 µs`. */
const rangeIn = (row: Row | undefined): string => {
  const [low, high] = String(row?.range ?? "")
    .split("-")
    .map(Number);
  if (low === undefined || high === undefined || !(high >= low)) return "";
  const plain = (seconds: number) => microseconds(seconds).replace(" µs", "");
  return `${plain(low)}-${plain(high)} µs`;
};

/** Whether the range of a row is so wide that one run was far from the others, so its median says little. */
export const wide = (row: Row | undefined): boolean => {
  const [low, high] = String(row?.range ?? "")
    .split("-")
    .map(Number);
  return (
    low !== undefined &&
    high !== undefined &&
    high > 0 &&
    high > Math.max(low, 1e-12) * 3
  );
};

/** What the read-only comparison prints: each folder's times with their ranges, and what the scanner was read as. */
export function foldersReport(
  rows: readonly Row[],
  settings: ScannerSettings,
  where: Record<"in-excluded-folder" | "in-scanned-folder", string>,
): string[] {
  type Folder = "in-excluded-folder" | "in-scanned-folder";
  const find = (state: Folder, key: string) =>
    rows.find(({ name }) => name === `${rowsOf(state)}/${key}`);
  const cell = (state: Folder, key: string): string => {
    const row = find(state, key);
    if (row === undefined) return "-";
    const range = rangeIn(row);
    return `${microseconds(row.value)}${range === "" ? "" : ` (range ${range})`}${wide(row) ? " one slow run" : ""}`;
  };
  const lines: [string, string][] = [
    ...[1, 16, 64].map<[string, string]>((at) => [
      `create a file, ${at} at once, per file`,
      `create/in-flight-${at}`,
    ]),
    ["all the files' bytes as one file, whole", "one-file/whole"],
    ["the same, flushed first, whole", "one-file/whole-flushed"],
  ];
  return [
    "Nothing on this machine was changed: Windows Defender's settings were only read.",
    `Windows Defender read as: ${describeSettings(settings)}`,
    ...scannerNotes(settings),
    `In the excluded folder: ${where["in-excluded-folder"]}`,
    `In the scanned folder: ${where["in-scanned-folder"]}`,
    ...lines.flatMap(([text, key]) => [
      `${text}: excluded folder ${cell("in-excluded-folder", key)}; scanned folder ${cell("in-scanned-folder", key)}`,
    ]),
    "Read it as one machine, two folders: a difference between the columns is what the scanner costs here only where their ranges do not overlap.",
  ];
}

/**
 * The micro-bench in a folder the scanner leaves alone and in one it does not, on the machine as it is, and nothing is
 * changed: the scanner is only read. Which folder is which is checked against its list by real path, and a pair that is in the
 * same state is refused. The runs alternate between the two folders so that the machine's drift falls on both.
 */
export async function foldersCompared(
  plan: Plan,
  log: (line: string) => void,
  deps: {
    scanner?: Pick<Scanner, "read">;
    once: (folder: string) => Promise<FileOpsRun>;
    tmp?: string;
    /** What a person's system folders are called, where this machine's differ from the process's. */
    env?: NodeJS.ProcessEnv;
    /** Other folders to remove if the run is stopped, which its own end removes too. */
    alsoRemove?: readonly string[];
    signals?: SignalHost;
  },
): Promise<Row[]> {
  const scanner =
    deps.scanner ??
    (process.platform === "win32" ? windowsScanner() : undefined);
  const settings = await scanner?.read();
  if (settings === undefined)
    throw new Refusal(
      "--scanner-folders reads Windows Defender's list of excluded folders (Get-MpPreference) and could not: this machine has no Windows Defender, or PowerShell would not read it. Nothing was changed.",
    );
  const listed = settings.excludedFolders;
  for (const note of scannerNotes(settings)) log(note);
  const hiddenFrom = listed.find(hidden);
  if (hiddenFrom !== undefined)
    throw new Refusal(
      `Windows Defender hides its list of excluded folders from a shell that is not an administrator's (it answered "${hiddenFrom}"): run this again from an administrator PowerShell. Only the list is read; nothing is changed.`,
    );
  const state = async (folder: string) => {
    const real = await realpath(folder).catch(() => {
      throw new Refusal(`${folder} is not a folder that exists`);
    });
    return { real, entry: insideListed(real, listed) };
  };
  // The folder that is excluded: the one asked for, or the first excluded folder of the person's own that can be written to.
  const writableRoots: { real: string; entry: string | undefined }[] = [];
  if (plan.folderExcluded !== undefined) {
    const found = await state(plan.folderExcluded);
    if (found.entry === undefined)
      throw new Refusal(
        `--folder-excluded ${plan.folderExcluded} (${found.real}) is not inside any folder Windows Defender leaves alone; its list is [${listed.join(", ")}]`,
      );
    writableRoots.push(found);
  } else {
    // A drive's root last: a folder made there can need more than a person has.
    const ordered = [...listed].sort(
      (a, b) => Number(parse(a).base === "") - Number(parse(b).base === ""),
    );
    const system: string[] = [];
    for (const entry of ordered) {
      if (/[*?%]/.test(entry)) continue;
      const found = await state(entry).catch(() => undefined);
      if (found === undefined || found.entry === undefined) continue;
      const why = systemFolder(found.real, deps.env);
      if (why === undefined) writableRoots.push(found);
      else system.push(`${found.real} (${why})`);
    }
    if (writableRoots.length === 0)
      throw new Refusal(
        system.length === 0
          ? `no folder is excluded from Windows Defender on this machine that exists (its list is [${listed.join(", ")}]), so there is no excluded folder to compare; name one with --folder-excluded <a folder of your own that it leaves alone>. Nothing was changed.`
          : `the only excluded folders that exist are system or program folders: ${system.join("; ")}. This is not written into one without being asked: name a folder of your own that Windows Defender leaves alone with --folder-excluded <folder>. Nothing was changed.`,
      );
  }
  const scannedAsked = plan.folderScanned ?? deps.tmp ?? tmpdir();
  const scanned = await state(scannedAsked);
  if (scanned.entry !== undefined)
    throw new Refusal(
      `${plan.folderScanned === undefined ? "the temporary folder" : "--folder-scanned"} ${scannedAsked} (${scanned.real}) is inside ${scanned.entry}, which Windows Defender leaves alone, so both folders are in the same state; name a folder outside every one with --folder-scanned. Nothing was changed.`,
    );
  const folders: Record<"in-excluded-folder" | "in-scanned-folder", string> = {
    "in-excluded-folder": "",
    "in-scanned-folder": "",
  };
  const roots: string[] = [];
  const where = {} as Record<keyof typeof folders, string>;
  const entryOf: Record<string, string | undefined> = {};
  // A run that is stopped removes the folders it made, as its end does.
  const stopListening = restoringOnSignals(async () => {
    for (const root of [...roots, ...(deps.alsoRemove ?? [])])
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }, deps.signals);
  try {
    for (const candidate of writableRoots) {
      try {
        folders["in-excluded-folder"] = await mkdtemp(
          join(candidate.real, "cascade-perf-"),
        );
        entryOf["in-excluded-folder"] = candidate.entry;
        break;
      } catch {
        continue;
      }
    }
    if (folders["in-excluded-folder"] === "")
      throw new Refusal(
        `no excluded folder could be written to (tried ${writableRoots.map(({ real }) => real).join(", ")}); name one with --folder-excluded. Nothing was changed.`,
      );
    roots.push(folders["in-excluded-folder"]);
    folders["in-scanned-folder"] = await mkdtemp(
      join(scanned.real, "cascade-perf-"),
    );
    roots.push(folders["in-scanned-folder"]);
    entryOf["in-scanned-folder"] = undefined;
    for (const each of Object.keys(folders) as (keyof typeof folders)[])
      where[each] =
        each === "in-excluded-folder"
          ? `${folders[each]}, inside ${entryOf[each]}, which Windows Defender leaves alone`
          : `${folders[each]}, inside none of the ${listed.length} folders Windows Defender leaves alone`;
    log(
      `3,000 small files, under 1 MB in all, are written in each of these, and the folders are deleted afterwards: ${where["in-excluded-folder"]}; ${where["in-scanned-folder"]}`,
    );
    // The folders as made are checked once more, by real path, against the same list.
    for (const each of Object.keys(folders) as (keyof typeof folders)[]) {
      const now = await state(folders[each]);
      if ((now.entry !== undefined) !== (each === "in-excluded-folder"))
        throw new Error(
          `${folders[each]} is ${now.entry === undefined ? "not " : ""}inside a folder Windows Defender leaves alone, not as expected; nothing was changed`,
        );
    }
    const runs: Record<keyof typeof folders, FileOpsRun[]> = {
      "in-excluded-folder": [],
      "in-scanned-folder": [],
    };
    const order = Object.keys(folders) as (keyof typeof folders)[];
    for (let at = 0; at < plan.repeats; at++)
      for (const each of at % 2 === 0 ? order : [...order].reverse()) {
        log(`file operations, ${each}: run ${at + 1}/${plan.repeats}`);
        runs[each].push(
          await deps.once(join(folders[each], `file-ops-${each}-${at}`)),
        );
      }
    const rows = order.flatMap((each) => [
      ...fileOpsRows(each, runs[each]),
      countRow(
        `${rowsOf(each)}/count/scanner-folder-excluded`,
        each === "in-excluded-folder" ? 1 : 0,
        `${where[each]}; its real path was compared with Get-MpPreference's ExclusionPath, which was only read`,
      ),
      countRow(
        `${rowsOf(each)}/count/scanner-realtime-on`,
        settings.realtime ? 1 : 0,
        describeSettings(settings),
      ),
    ]);
    for (const line of foldersReport(rows, settings, where)) log(line);
    return rows;
  } finally {
    stopListening();
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
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
  // Nothing is changed in the machine's scanner: it is read, and two folders are measured.
  if (plan.scannerFolders === true)
    return foldersCompared(plan, log, {
      scanner,
      once,
      alsoRemove: [work],
      ...(deps.signals !== undefined && { signals: deps.signals }),
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
  // A change and a put-back never run at the same time: a signal in the middle of a change waits for it to end.
  const inTurnOf = inTurn();
  const restore = (): Promise<void> => inTurnOf(putBack);
  const putBack = async (): Promise<void> => {
    if (!changed || restored?.ok === true) return;
    let refusal = "";
    await scanner.set(start).catch((error: unknown) => {
      refusal = message(error);
      log(`the scanner's settings could not be put back: ${refusal}`);
    });
    const after = await scanner.read().catch(() => undefined);
    restored = {
      ok: after !== undefined && sameSettings(after, start),
      says: `${
        after === undefined
          ? "the settings could not be read back"
          : describeSettings(after)
      }${refusal === "" ? "" : `; putting them back failed: ${refusal}`}`,
    };
    if (!restored.ok)
      log(
        `THE SCANNER IS NOT AS IT WAS: ${restored.says}; it was ${describeSettings(start)}`,
      );
  };
  /** Sets the scanner to `settings`, records whether it let that be, and measures when it did. */
  const attempt = async (
    state: "off" | "on" | "excluded",
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
      await inTurnOf(() => scanner.set(settings));
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
