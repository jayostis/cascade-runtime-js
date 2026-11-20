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
  type Measured,
  nameOf,
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
import { storedRows } from "./perf-scenarios/stored.js";

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
    wants("reopen-first-answer") || wants("question-page") || wants("stored");
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

  // reopen and question-page, on the last pod a fresh run left.
  for (const [scenario, kind, scenarioRows, probedTotal] of [
    ["reopen-first-answer", "reopen", reopenRows, reopenProbedTotal],
    ["question-page", "question-page", questionPageRows, questionPageTotal],
  ] as const) {
    if (!wants(scenario) || kept === undefined) continue;
    const name = nameOf(scenario, dataset, encrypted);
    // Each run opens a copy of the pod the fresh run left, so that each is the first open after an import, as the
    // headline says, and none finds what an earlier run left in the folder.
    const keptFolder = dirname(kept);
    let copies = 0;
    const onACopy = async (
      probed: boolean,
      profiled = false,
    ): Promise<Measured> => {
      const label = `${kind}-${copies++}`;
      await cp(keptFolder, join(work, label), { recursive: true });
      try {
        return await child(
          {
            ...ctx.unprobed(label, kind),
            probed,
            ...(probed &&
              plan.profiles !== undefined && { profiles: plan.profiles }),
          },
          work,
          profiled && plan.profiles !== undefined
            ? { into: plan.profiles, name, notes: flame.cpu }
            : undefined,
        );
      } finally {
        await rm(join(work, label), { recursive: true, force: true });
      }
    };
    const runs: Measured[] = [];
    for (let at = 0; at < plan.repeats; at++) {
      log(
        `${dataset}${encrypted ? " encrypted" : ""}: ${scenario} ${at + 1}/${plan.repeats}`,
      );
      runs.push(await onACopy(false));
    }
    rows.push(...scenarioRows(ctx, name, runs));
    if (plan.probe) {
      log(`${dataset}${encrypted ? " encrypted" : ""}: ${scenario}, probed`);
      const probed = await onACopy(true);
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
      log(
        `${dataset}${encrypted ? " encrypted" : ""}: ${scenario}, CPU profile`,
      );
      await onACopy(false, true);
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
