#!/usr/bin/env node
// `cascade-evals <command>`: the harness's commands. Every command prints JSON on stdout, except `pod`, which prints
// what the tool answered, and `report`, which prints the page it wrote.
import { argv, exit, stderr, stdout } from "node:process";
import { checkKey } from "./checks.js";
import { caseIds, prepare } from "./cases.js";
import { finish, recordRun } from "./record.js";
import { judgePackets } from "./judging.js";
import { planRun } from "./plan.js";
import { podCommand } from "./pod-client.js";
import { recordHistory } from "./history.js";
import { buildSite } from "./site.js";

const USAGE = `usage: cascade-evals <command>

  cases                                   the cases there are
  prepare <case>                          make a case's downloads and pod (once per input)
  check-key <case>                        check every claim of the case's key against its downloads
  plan --config <file|tier> [--run <id>]  a run's jobs, what is reused, and its estimate against the cap
  pod --run <dir> --job <id> <tool> [<json input>]
                                          the pod arm's one command: a cascade-mcp tool, logged to the run
  meter --run <dir>                       what the run has spent (from its transcripts) and which jobs may start
  judges --run <dir>                      the blind packets for the run's judges
  finish --run <dir>                      checks, grades, scores and results.json
  record-history <run dir>                copy a finished run into history/
  report [<run dir> | --history] [--out <dir>]
                                          the report site
`;

const print = (value: unknown): void => {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
}

async function main(args: string[]): Promise<void> {
  const command = args.shift();
  const log = (line: string) => stderr.write(`${line}\n`);
  switch (command) {
    case "cases":
      return print(await caseIds());
    case "prepare":
      return print(await prepare(args[0] ?? "", log));
    case "check-key":
      return print(await checkKey(args[0] ?? "", log));
    case "plan": {
      const config = option(args, "config") ?? "smoke";
      const run = option(args, "run");
      return print(await planRun(config, run, log));
    }
    case "pod": {
      const run = option(args, "run");
      const job = option(args, "job");
      if (run === undefined || job === undefined) break;
      stdout.write(await podCommand(run, job, args));
      return;
    }
    case "meter": {
      const run = option(args, "run");
      if (run === undefined) break;
      return print(await recordRun(run));
    }
    case "judges": {
      const run = option(args, "run");
      if (run === undefined) break;
      return print(await judgePackets(run));
    }
    case "finish": {
      const run = option(args, "run");
      if (run === undefined) break;
      return print(await finish(run, log));
    }
    case "record-history":
      if (args[0] === undefined) break;
      return print(await recordHistory(args[0]));
    case "report": {
      const out = option(args, "out");
      const history = args.includes("--history");
      const run = args.find((it) => !it.startsWith("--"));
      stdout.write(
        `${await buildSite(history ? { history: true } : { run: run ?? "" }, out)}\n`,
      );
      return;
    }
  }
  stderr.write(USAGE);
  exit(2);
}

main(argv.slice(2)).catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
