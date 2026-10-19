// `npm run ask -- [--pod <name>] "<question>"`: the question's rows, one JSON object a line.
import { argv, stdout } from "node:process";
import { Refusal } from "cascade-runtime";
import { nodeHost } from "./node-host.mjs";
import { podApi } from "./pod-api.mjs";
import { argumentsOf, choosePod, PODS, refuse } from "./pods.mjs";

const { positionals, values } = argumentsOf(
  argv.slice(2),
  'npm run ask -- [--pod <name>] "<question>"',
  { pod: { type: "string" } },
  1,
);
const name = await choosePod(values.pod);
const api = podApi(nodeHost({ folder: PODS, opensEncrypted: false }));
let rows;
try {
  ({ rows } = await api.ask({ pod: name, question: positionals[0] }));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  await api.close();
  refuse(error.message);
}
await api.close();
for (const row of rows) stdout.write(`${JSON.stringify(row)}\n`);
