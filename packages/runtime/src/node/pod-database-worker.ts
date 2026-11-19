import { parentPort, workerData } from "node:worker_threads";
import { builtWholeIn } from "../pod-database.js";
import { sqlDatabaseFunctions } from "../statements.js";
import {
  openDatabase,
  type WholeBuildDone,
  type WholeBuildJob,
} from "./sqlite.js";

const { path, whole } = workerData as WholeBuildJob;
const { key, ...build } = whole;
let done: WholeBuildDone = {};
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
    builtWholeIn(db, build);
  } finally {
    db.close();
  }
} catch (error) {
  done = { error: error instanceof Error ? error.message : String(error) };
}
parentPort?.postMessage(done);
