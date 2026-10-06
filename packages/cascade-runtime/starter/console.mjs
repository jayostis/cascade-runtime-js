// `npm run console -- [--pod <name>]`: Node's REPL with the pod open as `pod`, so
// `await pod.ask("pod/My active allergies")` prints its rows. `.exit` closes it.
import { argv } from "node:process";
import { start } from "node:repl";
import { openPod } from "cascade-runtime";
import { argumentsOf, choosePod, podFolder } from "./pods.mjs";

const { values } = argumentsOf(
  argv.slice(2),
  "npm run console -- [--pod <name>]",
  { pod: { type: "string" } },
  0,
);
const name = await choosePod(values.pod);
const pod = await openPod(podFolder(name));
const repl = start({ prompt: `${name}> ` });
repl.context.pod = pod;
repl.on("exit", () => pod.close());
