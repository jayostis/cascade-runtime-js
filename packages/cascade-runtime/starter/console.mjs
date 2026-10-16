// `npm run console -- [--pod <name>]`: Node's REPL with the pod open as `pod`, so
// `await pod.ask("pod/My active allergies")` prints its rows. `.exit` closes it.
import { argv } from "node:process";
import { start } from "node:repl";
import { Refusal } from "cascade-runtime";
import {
  argumentsOf,
  choosePod,
  openWithoutWords,
  podFolder,
  refuse,
} from "./pods.mjs";

const { values } = argumentsOf(
  argv.slice(2),
  "npm run console -- [--pod <name>]",
  { pod: { type: "string" } },
  0,
);
const name = await choosePod(values.pod);
let pod;
try {
  pod = await openWithoutWords(name, podFolder(name));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  refuse(error.message);
}
const repl = start({ prompt: `${name}> ` });
repl.context.pod = pod;
repl.on("exit", () => pod.close());
