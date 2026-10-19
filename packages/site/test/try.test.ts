import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pod, Tables } from "cascade-runtime/published";
import { tryLooks } from "../src/node/try.js";

test("a first-paint lookup that fails at the site build fails the build, naming each failure", async () => {
  const down = new Error("the tables are down");
  const pod = { ask: async () => [] } as unknown as Pod;
  const tables = {
    about: async () => {
      throw down;
    },
    held: async () => [],
  } as unknown as Tables;
  await assert.rejects(tryLooks(pod, tables), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [down]);
    return true;
  });
});
