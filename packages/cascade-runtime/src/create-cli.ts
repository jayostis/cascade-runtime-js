#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { create, npmInstall, npmRunModel } from "./create.js";

async function question(text: string): Promise<string> {
  const reading = createInterface({ input: stdin, output: stdout });
  try {
    return await reading.question(text);
  } finally {
    reading.close();
  }
}

async function offerModel(folder: string): Promise<boolean> {
  const answer = (await question("\nAdd a chat with a model? (y/N) "))
    .trim()
    .toLowerCase();
  return (answer === "y" || answer === "yes") && (await npmRunModel(folder));
}

process.exitCode = await create(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  ...(stdin.isTTY
    ? {
        ask: () => question("A name for the app's folder: "),
        model: offerModel,
      }
    : {}),
  install: npmInstall,
  tables: async (pods, phase) => {
    const { setUpTables } = await import("./node/kits.js");
    await setUpTables(pods, phase);
  },
  load: async (kit, folder) => {
    const { replayKit } = await import("./node/kits.js");
    await replayKit(kit, folder);
  },
});
