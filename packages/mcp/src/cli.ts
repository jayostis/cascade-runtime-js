#!/usr/bin/env node
// `cascade-mcp --pods <folder>`: an MCP server on stdio over the pods in the folder, for Claude Desktop, VS Code or any
// MCP client to start. stdout is the protocol; what it says of itself goes to stderr.
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit, stderr, stdin } from "node:process";
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { configureTables } from "cascade-runtime";
import { podReads, podsIn } from "cascade-runtime/tools/node";
import { podServer } from "./server.js";

const USAGE = `usage: cascade-mcp --pods <folder> [--check-tables]

  --pods <folder>   the folder whose folders are the pods, as an app keeps them
  --check-tables    check the reference tables' feeds for newer tables when the first pod opens (a network call);
                    without it, the tables the folder holds are used as they are
`;

function refuse(message: string): never {
  stderr.write(`${message}\n\n${USAGE}`);
  exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    args: argv.slice(2),
    options: {
      pods: { type: "string" },
      "check-tables": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  }));
} catch (error) {
  refuse((error as Error).message);
}
if (values.help) {
  stderr.write(USAGE);
  exit(0);
}
if (values.pods === undefined) refuse("give the pods' folder with --pods");
const folder = resolve(values.pods);
if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory())
  refuse(`${folder} is no folder`);

configureTables({ checkOnOpen: values["check-tables"] });
const reads = podReads(podsIn(folder));
const serving = serveStdio(() => podServer(reads));

stdin.on("close", async () => {
  await serving.close();
  await reads.close();
  exit(0);
});
