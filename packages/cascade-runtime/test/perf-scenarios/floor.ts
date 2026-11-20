import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { child } from "../perf-child.js";
import { inputOf, type DatasetId } from "../perf-data.js";
import { type Loaded, loadPlainly } from "../perf-floor.js";
import { type Job, type Measured } from "../perf-job.js";
import { type Plan } from "../perf-plan.js";
import { clockRow, countRow, type Row } from "../perf-rows.js";

/** The floor in this process: the record's input read, parsed, flattened and inserted into a SQLite file in the job's folder. */
export async function measureFloor(job: Job): Promise<Measured> {
  await mkdir(job.folder, { recursive: true });
  const floor = await loadPlainly(
    (await inputOf(job.dataset)).path,
    join(job.folder, "floor.db"),
  );
  return {
    seconds: {},
    parts: {},
    rssBytes: process.memoryUsage.rss(),
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    floor,
  };
}

/**
 * The floor's rows for one size: the median of each stage (parse, flatten, insert) and of their total over the runs, and the
 * rows inserted, under `floor-<size>`.
 */
export function floorRows(
  dataset: DatasetId,
  about: string,
  runs: readonly Loaded[],
  /** The memory each run held when it finished, and the most it held, in bytes; the rows are left out without it. */
  memory?: {
    readonly rss: readonly number[];
    readonly peak: readonly number[];
  },
): Row[] {
  const name = `floor-${dataset}`;
  const how = `unprobed, median of ${runs.length} runs, each in a process of its own; ${about}`;
  const stage = (pick: (each: Loaded) => number) => runs.map(pick);
  return [
    clockRow(
      `${name}/total`,
      "s",
      stage((each) => each.parse + each.flatten + each.insert),
      `read + parse + flatten + insert into SQLite; ${how}`,
    ),
    clockRow(
      `${name}/parse`,
      "s",
      stage((each) => each.parse),
      how,
    ),
    clockRow(
      `${name}/flatten`,
      "s",
      stage((each) => each.flatten),
      how,
    ),
    clockRow(
      `${name}/insert`,
      "s",
      stage((each) => each.insert),
      how,
    ),
    countRow(`${name}/count/rows`, runs[0]?.rows ?? 0, about),
    ...(memory === undefined
      ? []
      : [
          clockRow(`${name}/rss`, "By", [...memory.rss], how),
          clockRow(`${name}/peak-rss`, "By", [...memory.peak], how),
        ]),
  ];
}

/** The floor at one size: the plain load of the record the fresh scenario imports, `plan.repeats` times, each in a process of its own. */
export async function floorAt(
  plan: Plan,
  dataset: DatasetId,
  work: string,
  log: (line: string) => void,
): Promise<Row[]> {
  const { sha256 } = await inputOf(dataset);
  const runs: Loaded[] = [];
  const memory = { rss: [] as number[], peak: [] as number[] };
  for (let at = 0; at < plan.repeats; at++) {
    log(`${dataset}: floor run ${at + 1}/${plan.repeats}`);
    const folder = join(work, `floor-${dataset}-${at}`);
    const { floor, rssBytes, peakRssBytes } = await child(
      {
        scenario: "floor",
        dataset,
        encrypted: false,
        probed: false,
        folder,
        claim: [],
      },
      work,
    );
    await rm(folder, { recursive: true, force: true });
    if (floor === undefined) throw new Error("the floor measured nothing");
    if (floor.sha256 !== sha256)
      throw new Error(
        `the floor read ${floor.sha256} for ${dataset}, the manifest says ${sha256}`,
      );
    runs.push(floor);
    memory.rss.push(rssBytes);
    memory.peak.push(peakRssBytes);
  }
  return floorRows(
    dataset,
    `dataset=${dataset} sha256=${sha256} records=${runs[0]?.records ?? 0}`,
    runs,
    memory,
  );
}
