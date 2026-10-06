// `npm run ask -- [--pod <name>] "<question>"`: the question's rows, one JSON object a line.
import { argv, stdout } from "node:process";
import { openPod } from "cascade-runtime";
import { argumentsOf, choosePod, podFolder, refuse } from "./pods.mjs";

const { positionals, values } = argumentsOf(
  argv.slice(2),
  'npm run ask -- [--pod <name>] "<question>"',
  { pod: { type: "string" } },
  1,
);
const pod = await openPod(podFolder(await choosePod(values.pod)));
let rows;
try {
  rows = await pod.ask(positionals[0]);
} catch (error) {
  await pod.close();
  refuse(error.message);
}
await pod.close();
for (const row of rows) stdout.write(`${JSON.stringify(row)}\n`);
