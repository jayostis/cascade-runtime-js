import { parentPort, workerData } from "node:worker_threads";
import { type BuildStep, builtWholeIn } from "../pod-database.js";
import { sqlDatabaseFunctions } from "../statements.js";
import {
  openDatabase,
  type WholeBuildDone,
  type WholeBuildJob,
} from "./sqlite.js";

const { path, whole, profile } = workerData as WholeBuildJob;
const { key, ...build } = whole;
const steps: [string, number][] = [];
/** Times each step of the build only when the caller is probing: a build that is not goes as it always did. */
const timedStep: BuildStep | undefined = profile
  ? (name, run) => {
      const started = performance.now();
      try {
        run();
      } finally {
        steps.push([name, performance.now() - started]);
      }
    }
  : undefined;
let done: WholeBuildDone;
try {
  const functions = await sqlDatabaseFunctions();
  let db: ReturnType<typeof openDatabase>;
  try {
    db = openDatabase(path, {
      ...(key === undefined ? {} : { key }),
      functions,
      building: true,
    });
  } finally {
    key?.fill(0);
  }
  try {
    builtWholeIn(db, build, timedStep);
  } finally {
    const started = performance.now();
    db.close();
    if (profile)
      steps.push(["pod-database.build.close", performance.now() - started]);
  }
  done = { steps };
} catch (error) {
  done = { error: error instanceof Error ? error.message : String(error) };
}
parentPort?.postMessage(done);
