import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Client } from "@modelcontextprotocol/client";
import { callLogged, socketOf, stopPodServer } from "../src/pod-client.js";
import type { ToolCallRecord } from "../src/results.js";

/** A server on the socket of `job` in `folder`, run by `onConnection`; closed by the caller. */
async function listening(
  folder: string,
  job: string,
  onConnection: Parameters<typeof createServer>[1],
): Promise<Server> {
  const server = createServer(onConnection);
  await new Promise<void>((done) => server.listen(socketOf(folder, job), done));
  return server;
}

/**
 * A pod-arm session reaches its pod through one `cascade-mcp` server per job. A call through it takes the next number and
 * is logged, with its error when it throws, so that an absence can name the call that looked.
 */
describe("Calling a job's pod server · callLogged(), stopPodServer()", () => {
  describe("callLogged(client, folder, job, args, counter)", () => {
    let folder: string;
    let thrown: Error | undefined;
    let logged: ToolCallRecord[];
    const counter = { made: 0 };

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "cascade-evals-call-"));
      const client = {
        callTool: async () => {
          throw new Error("the pod went away");
        },
      } as unknown as Client;
      thrown = await callLogged(
        client,
        folder,
        "j",
        ["ask", "{}"],
        counter,
      ).then(
        () => undefined,
        (error: Error) => error,
      );
      logged = (await readFile(join(folder, "tool-calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as ToolCallRecord);
    });

    after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

    it("rejects with the tool's error when a call throws", () => {
      assert.match(thrown?.message ?? "", /pod went away/);
    });

    it("logs the call that threw under its own number, with `ok: false` and the error", () => {
      assert.equal(logged.length, 1);
      assert.deepEqual(
        [logged[0]!.job, logged[0]!.call, logged[0]!.ok, logged[0]!.error],
        ["j", 1, false, "the pod went away"],
      );
    });

    it("counts the call, so the next call takes the next number", () => {
      assert.equal(counter.made, 1);
    });
  });

  describe("given a server that takes `--stop` and never answers (`stopPodServer()`)", () => {
    it(
      'rejects with "did not stop" once the limit passes, and does not hang',
      {
        timeout: 5_000,
      },
      async () => {
        const folder = await mkdtemp(join(tmpdir(), "cascade-evals-stop-"));
        const open: { destroy(): void }[] = [];
        const server = await listening(folder, "silent", (connection) => {
          open.push(connection);
        });
        try {
          await assert.rejects(
            stopPodServer(folder, "silent", 300),
            /did not stop/,
          );
        } finally {
          for (const connection of open) connection.destroy();
          server.close();
          await rm(folder, { recursive: true, force: true });
        }
      },
    );
  });
});
