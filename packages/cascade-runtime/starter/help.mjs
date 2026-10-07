// `npm run help`: every script of package.json, in its order, with what it does; a script with no line here shows its
// name alone.
import { readFile } from "node:fs/promises";
import { stdout } from "node:process";
import { URL } from "node:url";

const SAID = {
  help: ["npm run help", "this list"],
  start: [
    "npm start",
    "serve the app, then open the address it prints; stop it with Ctrl+C",
  ],
  dev: ["npm run dev", "serve the app, restarting it whenever a file is saved"],
  reset: [
    "npm run reset",
    "remove every pod and load Alex's and Priya's again, as when the app was made",
  ],
  "pod:load": [
    "npm run pod:load -- <kit> [--through <step>] [--as <name>]",
    "load a kit's pod: alex-rivera or priya-natarajan",
  ],
  "pod:new": ["npm run pod:new <name>", "make an empty pod"],
  "pod:reset": ["npm run pod:reset <name>", "remove one pod and all it holds"],
  "kit:export": [
    "npm run kit:export -- <kit> <download>",
    "copy one of a kit's downloads into this folder, as its person saved it",
  ],
  ask: [
    'npm run ask -- [--pod <name>] "<question>"',
    "print a question's rows, as pod/My active allergies",
  ],
  console: [
    "npm run console -- [--pod <name>]",
    "open Node's prompt with the pod as `pod`",
  ],
};

const { scripts } = JSON.parse(
  await readFile(new URL("package.json", import.meta.url), "utf8"),
);
const rows = Object.keys(scripts).map(
  (script) => SAID[script] ?? [`npm run ${script}`, ""],
);
const width = Math.max(...rows.map(([command]) => command.length));
stdout.write("The app's commands, run in this folder:\n\n");
for (const [command, what] of rows)
  stdout.write(`  ${command.padEnd(width)}  ${what}`.trimEnd() + "\n");
stdout.write(
  "\nAn option to a command goes after `--`, or npm keeps it for itself.\n",
);
