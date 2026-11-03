import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { socketOf, stopPodServer } from "../src/pod-client.js";

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

test(
  "a pod server that accepts --stop and never answers is an error once the limit passes, not a hang",
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
