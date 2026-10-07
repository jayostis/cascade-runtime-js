// `npm run pod:load -- <kit> [--through <step>] [--as <name>]`, `npm run pod:new <name>`, `npm run pod:reset <name>`,
// `npm run reset`.
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { argv, stdout } from "node:process";
import { openPod } from "cascade-runtime";
import { replayKit } from "cascade-runtime/fixtures";
import {
  argumentsOf,
  checkName,
  podFolder,
  podNames,
  PODS,
  refuse,
} from "./pods.mjs";

/** The kits whose pods the app was made with. */
const KITS = ["alex-rivera", "priya-natarajan"];

const [command, ...args] = argv.slice(2);

/** A kit's story, as the package carries it, replayed into a new pod. */
async function load() {
  const usage = "npm run pod:load -- <kit> [--through <step>] [--as <name>]";
  const { positionals, values } = argumentsOf(
    args,
    usage,
    { through: { type: "string" }, as: { type: "string" } },
    1,
  );
  const [kit] = positionals;
  const name = checkName(values.as ?? kit);
  const folder = podFolder(name);
  if (existsSync(folder))
    refuse(
      `the pod ${name} exists already: remove it with \`npm run pod:reset ${name}\`, or load under another name with \`-- --as <name>\``,
    );
  let steps;
  try {
    steps = await replayKit(
      kit,
      folder,
      values.through === undefined ? {} : { through: values.through },
    );
  } catch (error) {
    refuse(error.message);
  }
  for (const { step, kind, wrote, refused } of steps) {
    const files = wrote.length === 0 ? "nothing" : wrote.join(", ");
    stdout.write(
      `${step} (${kind}) wrote ${files}${refused === undefined ? "" : `; refused: ${refused}`}\n`,
    );
  }
  stdout.write(
    `\nLoaded the pod ${name}. Start the app with \`npm start\` and open http://127.0.0.1:3000/\n`,
  );
}

/** An empty pod, to bring a person's own downloads into. */
async function create() {
  const { positionals } = argumentsOf(args, "npm run pod:new <name>", {}, 1);
  const name = checkName(positionals[0]);
  if (existsSync(podFolder(name))) refuse(`the pod ${name} exists already`);
  const pod = await openPod(podFolder(name));
  await pod.close();
  stdout.write(`Made the empty pod ${name}.\n`);
}

async function reset() {
  const { positionals } = argumentsOf(args, "npm run pod:reset <name>", {}, 1);
  const name = checkName(positionals[0]);
  if (!existsSync(podFolder(name))) refuse(`there is no pod ${name}`);
  await rm(podFolder(name), { recursive: true, force: true });
  stdout.write(`Removed the pod ${name}. If the app is running, restart it.\n`);
}

/** Every pod removed and the kits' pods loaded again: the app as it was made. */
async function everything() {
  argumentsOf(args, "npm run reset", {}, 0);
  const removed = await podNames();
  await rm(PODS, { recursive: true, force: true });
  stdout.write(
    `Removed ${removed.length === 0 ? "no pod" : `the pods ${removed.join(", ")}`}.\n`,
  );
  for (const kit of KITS) {
    stdout.write(`Loading the pod ${kit}… `);
    try {
      await replayKit(kit, podFolder(kit));
    } catch (error) {
      refuse(`\nthe pod ${kit} did not load: ${error.message}`);
    }
    stdout.write("loaded.\n");
  }
  stdout.write("If the app is running, restart it.\n");
}

const commands = { load, new: create, reset, everything };
if (!Object.hasOwn(commands, command))
  refuse("usage: node pod.mjs load|new|reset|everything ...");
await commands[command]();
