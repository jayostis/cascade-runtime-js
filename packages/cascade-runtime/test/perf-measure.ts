import { type Job, type Measured } from "./perf-job.js";
import { measureFileOps } from "./perf-scenarios/file-ops.js";
import { measureFloor } from "./perf-scenarios/floor.js";
import { measureFresh } from "./perf-scenarios/fresh-first-screen.js";
import { measureQuestionPage } from "./perf-scenarios/question-page.js";
import { measureReopen } from "./perf-scenarios/reopen-first-answer.js";
import { measureStored } from "./perf-scenarios/stored.js";

/** One job in this process, which is as fresh as a process is: nothing is warm that a run of the app would not have warm. */
export function measure(job: Job): Promise<Measured> {
  switch (job.scenario) {
    case "file-ops":
      return measureFileOps(job);
    case "floor":
      return measureFloor(job);
    case "fresh":
      return measureFresh(job);
    case "reopen":
      return measureReopen(job);
    case "question-page":
      return measureQuestionPage(job);
    case "stored":
      return measureStored(job);
  }
}
