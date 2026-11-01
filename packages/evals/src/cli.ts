#!/usr/bin/env node
// `cascade-evals <command>`: the harness's commands. Every command prints JSON on stdout, except `ask`, which prints
// the next question, `pod`, which prints what the tool answered, and `report`, which prints the page it wrote. Each command loads only its own modules, so
// the pod arm's command starts without the runtime.
import { argv, exit, stderr, stdout } from "node:process";

const USAGE = `usage: cascade-evals <command>

  cases                                   the cases there are
  prepare <case>                          make a case's downloads and pod (once per input)
  check-key <case>                        check every claim of the case's key against its downloads
  plan --config <file|tier> [--run <id>] [--brief]
                                          a run's jobs, what is reused, and its estimate against the cap
  ask --run <dir> --job <id>              a session's next question, once the last is answered
  pod --run <dir> --job <id> <tool> [<json input>]
                                          the pod arm's one command: a cascade-mcp tool, logged to the run
  meter --run <dir> [--brief] [--after-wave]
                                          what the run has spent (from its transcripts) and which jobs may start;
                                          after a wave, the jobs it handed out that left nothing fail
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

/** The tables as the folder holds them, never checked against the feeds: set once, before any pod opens. */
async function tablesFirst(): Promise<void> {
  (await import("cascade-runtime")).configureTables({ checkOnOpen: false });
}

async function main(args: string[]): Promise<void> {
  const command = args.shift();
  const log = (line: string) => stderr.write(`${line}\n`);
  switch (command) {
    case "cases":
      return print(await (await import("./cases.js")).caseIds());
    case "prepare":
      await tablesFirst();
      return print(
        await (await import("./cases.js")).prepare(args[0] ?? "", log),
      );
    case "check-key":
      await tablesFirst();
      return print(
        await (await import("./checks.js")).checkKey(args[0] ?? "", log),
      );
    case "plan": {
      await tablesFirst();
      const config = option(args, "config") ?? "smoke";
      const run = option(args, "run");
      const plan = await (await import("./plan.js")).planRun(config, run, log);
      return print(
        args.includes("--brief")
          ? {
              run: plan.run,
              folder: plan.folder,
              jobs: plan.jobs.length,
              estimate: plan.estimate,
              cap: plan.config.cap,
              fitsCap: plan.fitsCap,
              subjects: plan.config.subjects,
              judges: plan.config.judges,
            }
          : plan,
      );
    }
    case "ask": {
      const run = option(args, "run");
      const job = option(args, "job");
      if (run === undefined || job === undefined) break;
      stdout.write(`${await (await import("./sessions.js")).ask(run, job)}
`);
      return;
    }
    case "pod": {
      const run = option(args, "run");
      const job = option(args, "job");
      if (run === undefined || job === undefined) break;
      stdout.write(
        await (await import("./pod-client.js")).podCommand(run, job, args),
      );
      return;
    }
    case "pod-serve": {
      const run = option(args, "run");
      const job = option(args, "job");
      if (run === undefined || job === undefined) break;
      return (await import("./pod-client.js")).podServe(run, job);
    }
    case "meter": {
      const run = option(args, "run");
      if (run === undefined) break;
      const meter = await (
        await import("./record.js")
      ).recordRun(run, args.includes("--after-wave"));
      return print(
        args.includes("--brief")
          ? {
              ...meter,
              next: meter.next.map(({ prompt: _prompt, ...job }) => job),
            }
          : meter,
      );
    }
    case "judges": {
      const run = option(args, "run");
      if (run === undefined) break;
      return print(await (await import("./judging.js")).judgePackets(run));
    }
    case "finish": {
      await tablesFirst();
      const run = option(args, "run");
      if (run === undefined) break;
      return print(await (await import("./record.js")).finish(run, log));
    }
    case "record-history":
      if (args[0] === undefined) break;
      return print(await (await import("./history.js")).recordHistory(args[0]));
    case "report": {
      const out = option(args, "out");
      const history = args.includes("--history");
      const run = args.find((it) => !it.startsWith("--"));
      stdout.write(
        `${await (await import("./site.js")).buildSite(history ? { history: true } : { run: run ?? "" }, out)}\n`,
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
