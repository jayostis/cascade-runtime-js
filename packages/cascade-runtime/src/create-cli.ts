#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { create, npmInstall } from "./create.js";

async function askFolder(): Promise<string> {
  const reading = createInterface({ input: stdin, output: stdout });
  try {
    return await reading.question("A name for the app's folder: ");
  } finally {
    reading.close();
  }
}

process.exitCode = await create(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  ...(stdin.isTTY ? { ask: askFolder } : {}),
  install: npmInstall,
  // Imported only when a kit is loaded, so a refused command does not wait for the runtime to load.
  load: async (kit, folder) => {
    const { replayKit } = await import("./node/kits.js");
    await replayKit(kit, folder);
  },
});
