import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { child } from "./perf-child.js";
import { type Context } from "./perf-context.js";
import {
  LARGE,
  type DatasetId,
  loadDataset,
  profileOfPatient,
} from "./perf-data.js";
import { commits, envOf } from "./perf-env.js";
import { explain } from "./perf-glossary.js";
import {
  type CpuNote,
  type Flame,
  type Job,
  type Measured,
  nameOf,
  secs,
  type TraceNote,
} from "./perf-job.js";
import { type Plan, type Scenario } from "./perf-plan.js";
import {
  clockRow,
  probedRows,
  refused,
  type PerfFile,
  type Row,
} from "./perf-rows.js";
import { againRows, SCENARIO_OF } from "./perf-scenarios/after-first-import.js";
import { closeProbedRows, closeRows } from "./perf-scenarios/close.js";
import { fileOpsAt } from "./perf-scenarios/file-ops.js";
import { floorAt } from "./perf-scenarios/floor.js";
import {
  freshProbedRows,
  freshRows,
  recordsRow,
} from "./perf-scenarios/fresh-first-screen.js";
import {
  questionPageRows,
  questionPageTotal,
} from "./perf-scenarios/question-page.js";
import {
  reopenProbedTotal,
  reopenRows,
} from "./perf-scenarios/reopen-first-answer.js";
import { killedRows } from "./perf-scenarios/reopen-after-kill.js";
import { storedRows } from "./perf-scenarios/stored.js";
import { databaseBeside } from "../src/node/resolved.js";

/** One build of a scenario at a size, as `flame.json` lists it. */
export interface FlameBuild {
  /** `<scenario>-<size>[-encrypted]`, as the rows name it. */
  readonly name: string;
  readonly scenario: Scenario;
  readonly dataset: DatasetId;
  readonly encrypted: boolean;
  readonly trace: Omit<TraceNote, "scenario" | "dataset" | "encrypted">;
  readonly cpu?: CpuNote & {
    /** The scenario whose process this profile is, when it is not this one's: a close is the last step of a fresh run. */
    readonly processOf?: Scenario;
  };
}

/** The builds of a run, each scenario's trace with the CPU profile that goes with it. */
export function flameBuilds(flame: Flame): FlameBuild[] {
  return flame.traces.map(({ scenario, dataset, encrypted, ...trace }) => {
    const name = nameOf(scenario, dataset, encrypted);
    const own = flame.cpu.get(name);
    const fresh = flame.cpu.get(
      nameOf("fresh-first-screen", dataset, encrypted),
    );
    const cpu =
      own ??
      (scenario === "close" && fresh !== undefined
        ? { ...fresh, processOf: "fresh-first-screen" as const }
        : undefined);
    return {
      name,
      scenario,
      dataset,
      encrypted,
      trace,
      ...(cpu !== undefined && { cpu }),
    };
  });
}

/** Every scenario wanted at one size, encrypted or not: runs them and gives their rows. */
async function scenariosAt(
  plan: Plan,
  dataset: DatasetId,
  encrypted: boolean,
  work: string,
  log: (line: string) => void,
  flame: Flame,
): Promise<Row[]> {
  const data = await loadDataset(dataset);
  const claim = await profileOfPatient(data);
  const about = `dataset=${dataset} sha256=${data.sha256} records=${data.records}${encrypted ? " encrypted" : ""}`;
  const wants = (scenario: Scenario) => plan.scenarios.has(scenario);
  const place = (label: string) => join(work, label, "pod");
  const ctx: Context = {
    plan,
    dataset,
    encrypted,
    work,
    log,
    flame,
    claim,
    about,
    how: `unprobed, median of ${plan.repeats} runs, each in a process of its own; ${about}`,
    wants,
    place,
    unprobed: (label, kind) => ({
      scenario: kind,
      dataset,
      encrypted,
      probed: false,
      folder: place(label),
      claim,
    }),
  };
  const rows: Row[] = wants("fresh-first-screen")
    ? [recordsRow(ctx, data.records)]
    : [];

  // fresh: the headline runs, then the probed one. The last unprobed pod stays for the scenarios that open one.
  const needsPod =
    wants("reopen-first-answer") ||
    wants("question-page") ||
    wants("reimport-identical") ||
    wants("reimport-changed") ||
    wants("add-one-record") ||
    wants("reopen-after-kill") ||
    wants("question-after-update") ||
    wants("stored");
  const fresh: Measured[] = [];
  let kept: string | undefined;
  const freshRuns =
    wants("fresh-first-screen") || wants("close")
      ? plan.repeats
      : needsPod
        ? 1
        : 0;
  for (let at = 0; at < freshRuns; at++) {
    const label = `fresh-${at}`;
    log(
      `${dataset}${encrypted ? " encrypted" : ""}: fresh run ${at + 1}/${freshRuns}`,
    );
    fresh.push(await child(ctx.unprobed(label, "fresh"), work));
    if (kept !== undefined)
      await rm(dirname(kept), { recursive: true, force: true });
    kept = place(label);
  }
  if (wants("fresh-first-screen") && fresh.length > 0)
    rows.push(...freshRows(ctx, fresh));
  if (wants("close") && fresh.length > 0) rows.push(...closeRows(ctx, fresh));

  // the probed fresh run, on a pod of its own.
  if (plan.probe && (wants("fresh-first-screen") || wants("close"))) {
    log(`${dataset}${encrypted ? " encrypted" : ""}: fresh run, probed`);
    const probed = await child(
      {
        ...ctx.unprobed("fresh-probed", "fresh"),
        probed: true,
        ...(plan.profiles !== undefined && { profiles: plan.profiles }),
      },
      work,
    );
    flame.traces.push(...(probed.traces ?? []));
    await rm(dirname(place("fresh-probed")), { recursive: true, force: true });
    const note = `probed run: some work runs one at a time, so these are slower than the same steps unprobed`;
    if (wants("fresh-first-screen") && probed.seen !== undefined)
      rows.push(...freshProbedRows(ctx, probed, probed.seen, note));
    if (wants("close") && probed.closeSeen !== undefined)
      rows.push(...closeProbedRows(ctx, probed, probed.closeSeen, note));
  }

  // The CPU profile: one more fresh run, unprobed, so that it is the code as it runs. The close is its last step.
  if (
    plan.profiles !== undefined &&
    plan.cpuProfile &&
    (wants("fresh-first-screen") || wants("close"))
  ) {
    log(`${dataset}${encrypted ? " encrypted" : ""}: fresh run, CPU profile`);
    await child(ctx.unprobed("fresh-cpu", "fresh"), work, {
      into: plan.profiles,
      name: nameOf(
        wants("fresh-first-screen") ? "fresh-first-screen" : "close",
        dataset,
        encrypted,
      ),
      notes: flame.cpu,
    });
    await rm(dirname(place("fresh-cpu")), { recursive: true, force: true });
  }

  // What a read or a job does to a pod it does to a copy of a pod an earlier run left, so that each is the first thing done
  // after what left it, and none finds what an earlier run left in the folder (and no import is ever made into the pod the
  // fresh runs left, which `stored` counts last).
  let copies = 0;
  const onACopy = async (
    from: string,
    kind: Job["scenario"],
    more: Partial<Job>,
    {
      probed = false,
      profile,
      keep = false,
    }: { probed?: boolean; profile?: string; keep?: boolean } = {},
  ): Promise<{ ran: Measured; folder: string }> => {
    const label = `${kind}-${copies++}`;
    await cp(from, join(work, label), { recursive: true });
    try {
      const ran = await child(
        {
          ...ctx.unprobed(label, kind),
          ...more,
          probed,
          ...(probed &&
            plan.profiles !== undefined && { profiles: plan.profiles }),
        },
        work,
        profile !== undefined && plan.profiles !== undefined
          ? { into: plan.profiles, name: profile, notes: flame.cpu }
          : undefined,
      );
      return { ran, folder: join(work, label) };
    } finally {
      if (!keep) await rm(join(work, label), { recursive: true, force: true });
    }
  };
  const where = `${dataset}${encrypted ? " encrypted" : ""}`;
  /** The rows of a scenario measured on copies of the pod in `from`: the runs, then the probed run and the CPU profile. */
  const onCopiesOf = async (
    scenario: Scenario,
    from: string,
    kind: Job["scenario"],
    more: Partial<Job>,
    scenarioRows: (
      ctx: Context,
      name: string,
      runs: readonly Measured[],
    ) => Row[],
    probedTotal: (probed: Measured) => number,
    { repeats = plan.repeats, keep = false } = {},
  ): Promise<{ runs: Measured[]; kept?: string }> => {
    const name = nameOf(scenario, dataset, encrypted);
    const runs: Measured[] = [];
    let last: string | undefined;
    for (let at = 0; at < repeats; at++) {
      log(`${where}: ${scenario} ${at + 1}/${repeats}`);
      if (last !== undefined) await rm(last, { recursive: true, force: true });
      const made = await onACopy(from, kind, more, {
        keep: keep && at === repeats - 1,
      });
      runs.push(made.ran);
      last = keep && at === repeats - 1 ? made.folder : undefined;
    }
    if (wants(scenario)) {
      rows.push(...scenarioRows(ctx, name, runs));
      if (plan.probe) {
        log(`${where}: ${scenario}, probed`);
        const { ran: probed } = await onACopy(from, kind, more, {
          probed: true,
        });
        flame.traces.push(...(probed.traces ?? []));
        if (probed.seen !== undefined) {
          rows.push(
            clockRow(
              `${name}/probed-total`,
              "s",
              [probedTotal(probed)],
              `probed run: some work runs one at a time, so these are slower than the same steps unprobed`,
            ),
            ...probedRows(name, probed.seen),
          );
        }
      }
      if (plan.profiles !== undefined && plan.cpuProfile) {
        log(`${where}: ${scenario}, CPU profile`);
        await onACopy(from, kind, more, { profile: name });
      }
    }
    return { runs, ...(last !== undefined && { kept: last }) };
  };

  // reopen and question-page, on the last pod a fresh run left.
  if (kept !== undefined) {
    const fresh0 = dirname(kept);
    if (wants("reopen-first-answer"))
      await onCopiesOf(
        "reopen-first-answer",
        fresh0,
        "reopen",
        {},
        reopenRows,
        reopenProbedTotal,
      );
    if (wants("question-page"))
      await onCopiesOf(
        "question-page",
        fresh0,
        "question-page",
        {},
        questionPageRows,
        questionPageTotal,
      );

    // The jobs of every day: the same document again, with ten source entries changed, and with one more, each as an import
    // into a copy. A job is a process of its own with its own seed for ids and a clock later than the first import's
    // (`label` and `n`: see `pinClock`), so what it writes never repeats a name the first import wrote.
    let updated: string | undefined;
    for (const again of ["identical", "changed", "added"] as const) {
      const scenario = SCENARIO_OF[again];
      const forUpdate = again === "changed" && wants("question-after-update");
      if (!wants(scenario) && !forUpdate) continue;
      const made = await onCopiesOf(
        scenario,
        fresh0,
        "again",
        { again, label: scenario, n: 1 },
        (c, name, runs) => againRows(c, scenario, runs),
        (probed) => secs(probed, "open", "import", "first-answer"),
        { repeats: wants(scenario) ? plan.repeats : 1, keep: forUpdate },
      );
      if (forUpdate) updated = made.kept;
    }
    // The first question after an update: a reopen of the pod the changed document was imported into and closed.
    if (updated !== undefined) {
      await onCopiesOf(
        "question-after-update",
        updated,
        "reopen",
        { as: "question-after-update" },
        reopenRows,
        reopenProbedTotal,
      );
      await rm(updated, { recursive: true, force: true });
    }

    // Reopening after the process was stopped before it closed: a new pod, imported into by a process that is killed after
    // the import and the first screen, so that there is no database or kept build, and opened as often as the others.
    if (wants("reopen-after-kill")) {
      log(`${where}: reopen-after-kill, the import that is killed`);
      const folder = place("killed");
      await child(
        { ...ctx.unprobed("killed", "killed"), label: "killed", n: 0 },
        work,
      );
      const database = await databaseBeside(folder);
      const found = await database.exists();
      if (found)
        throw new Error(
          "the process that was killed left a database beside the pod: it was not stopped before it could be built",
        );
      const counted = await child(
        { ...ctx.unprobed("killed", "stored"), folder },
        work,
      );
      if (counted.stored === undefined)
        throw new Error("the stored scenario counted nothing");
      await onCopiesOf(
        "reopen-after-kill",
        dirname(folder),
        "reopen",
        { as: "reopen-after-kill" },
        reopenRows,
        reopenProbedTotal,
      );
      rows.push(...killedRows(ctx, counted.stored, found));
      await rm(dirname(folder), { recursive: true, force: true });
    }
  }
  // stored: the pod the fresh runs left, counted last, in a process of its own, once: its counts are exact. It reads the pod where
  // the last fresh run closed it; the scenarios above opened copies of it.
  if (wants("stored") && kept !== undefined) {
    log(`${dataset}${encrypted ? " encrypted" : ""}: stored`);
    const counted = await child(
      { ...ctx.unprobed("fresh-last", "stored"), folder: kept },
      work,
    );
    if (counted.stored === undefined)
      throw new Error("the stored scenario counted nothing");
    rows.push(
      ...storedRows(
        nameOf("stored", dataset, encrypted),
        about,
        counted.stored,
        data.records,
      ),
    );
  }
  if (kept !== undefined)
    await rm(dirname(kept), { recursive: true, force: true });
  return rows;
}

/** Each row with its glossary sentence first in `extra`, so a reader of the file or the history page hovers to a plain meaning. */
export function explained(rows: readonly Row[]): {
  rows: Row[];
  missing: string[];
} {
  const missing: string[] = [];
  const out = rows.map((row) => {
    const says = explain(row.name);
    if (says === undefined) {
      missing.push(row.name);
      return row;
    }
    return {
      ...row,
      extra: row.extra === undefined ? says : `${says} | ${row.extra}`,
    };
  });
  return { rows: out, missing };
}

/** The file for a plan: every scenario at every size, plain, and encrypted at the large size; the floor once for a size. */
export async function perfFile(
  plan: Plan,
  log: (line: string) => void = () => undefined,
  /** Called with the file as far as it is, after each size, so a run that fails late loses nothing before it. */
  partial: (file: PerfFile) => Promise<void> = () => Promise.resolve(),
): Promise<PerfFile> {
  const work = await mkdtemp(join(tmpdir(), "perf-report-"));
  const flame: Flame = { traces: [], cpu: new Map() };
  const flamed = async (): Promise<void> => {
    if (plan.profiles === undefined) return;
    await mkdir(plan.profiles, { recursive: true });
    await writeFile(
      join(plan.profiles, "flame.json"),
      `${JSON.stringify({ builds: flameBuilds(flame) }, null, 2)}
`,
    );
  };
  try {
    const results: Row[] = [];
    // A plan of the floor alone has no pod to open, so no scenario runs, and no record is loaded for the pod's scenarios.
    const only = [...plan.scenarios].every(
      (scenario) => scenario === "floor" || scenario === "file-ops",
    );
    // What one file costs belongs to no size: once, first, before any import has used the machine.
    if (plan.scenarios.has("file-ops")) {
      const kept = async (rows: readonly Row[]): Promise<void> =>
        partial({
          env: envOf(plan),
          commit: await commits(),
          results: explained([...results, ...rows]).rows,
        });
      results.push(...(await fileOpsAt(plan, work, log, { keep: kept })));
      await partial({
        env: envOf(plan),
        commit: await commits(),
        results: explained(results).rows,
      });
    }
    for (const size of plan.sizes) {
      const modes: boolean[] =
        plan.encryption === "plain"
          ? [false]
          : plan.encryption === "encrypted"
            ? [true]
            : plan.encryption === "both" ||
                (plan.encryption === "auto" && size === LARGE)
              ? [false, true]
              : [false];
      for (const encrypted of only ? [] : modes) {
        results.push(
          ...(await scenariosAt(plan, size, encrypted, work, log, flame)),
        );
        await flamed();
        await partial({
          env: envOf(plan),
          commit: await commits(),
          results: explained(results).rows,
        });
      }
      if (plan.scenarios.has("floor")) {
        results.push(...(await floorAt(plan, size, work, log)));
        await partial({
          env: envOf(plan),
          commit: await commits(),
          results: explained(results).rows,
        });
      }
    }
    const bad = results.map(refused).find((reason) => reason !== undefined);
    if (bad !== undefined)
      throw new Error(`a row the result schema refuses: ${bad}`);
    const { rows, missing } = explained(results);
    if (missing.length > 0)
      log(
        `the glossary (test/perf-glossary/) has no sentence for ${missing.length} rows, first ${missing.slice(0, 5).join(", ")}`,
      );
    return { env: envOf(plan), commit: await commits(), results: rows };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
