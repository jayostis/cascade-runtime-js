import { type DatasetId } from "./perf-data.js";
import { type Flame, type Job } from "./perf-job.js";
import { type Plan, type Scenario } from "./perf-plan.js";

/**
 * What a scenario's rows are written against: the plan, the size and the variant, the folder the runs share, and the
 * sentences every row of the size begins its `extra` with.
 */
export interface Context {
  readonly plan: Plan;
  readonly dataset: DatasetId;
  readonly encrypted: boolean;
  readonly work: string;
  readonly log: (line: string) => void;
  readonly flame: Flame;
  /** The profiles the record's patient has, which a run that names them as the person's own claims. */
  readonly claim: readonly string[];
  /** The dataset, its digest and its size, as a row says what it was measured on. */
  readonly about: string;
  /** How the headline rows were made: unprobed, a median of the plan's repeats, each in a process of its own. */
  readonly how: string;
  readonly wants: (scenario: Scenario) => boolean;
  /** Where a run named `label` keeps its pod. */
  readonly place: (label: string) => string;
  /** The job of one unprobed run named `label`. */
  readonly unprobed: (label: string, kind: Job["scenario"]) => Omit<Job, "out">;
}
