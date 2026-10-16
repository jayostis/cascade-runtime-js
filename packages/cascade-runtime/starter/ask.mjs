// `npm run ask -- [--pod <name>] "<question>"`: the question's rows, one JSON object a line.
import { argv, stdout } from "node:process";
import { Refusal } from "cascade-runtime";
import {
  argumentsOf,
  choosePod,
  openWithoutWords,
  podFolder,
  refuse,
} from "./pods.mjs";

const { positionals, values } = argumentsOf(
  argv.slice(2),
  'npm run ask -- [--pod <name>] "<question>"',
  { pod: { type: "string" } },
  1,
);
const name = await choosePod(values.pod);
let pod;
try {
  pod = await openWithoutWords(name, podFolder(name));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  refuse(error.message);
}
let rows;
try {
  rows = await pod.ask(positionals[0]);
} catch (error) {
  await pod.close();
  refuse(error.message);
}
await pod.close();
for (const row of rows) stdout.write(`${JSON.stringify(row)}\n`);
