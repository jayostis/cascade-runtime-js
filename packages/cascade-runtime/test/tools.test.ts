import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ModelContext,
  Refusal,
  type Tool,
  toolRegistry,
} from "cascade-runtime";

const tool = (name: string): Tool => ({
  name,
  description: name,
  inputSchema: { type: "object" },
  execute: async () => name,
});

test("a registered tool is listed until its signal aborts, in the order registered; a name registered twice is refused, and a tool whose signal has aborted is never listed", () => {
  const registry = toolRegistry();
  const first = new AbortController();
  const second = new AbortController();
  registry.register(tool("a"), { signal: first.signal });
  registry.register(tool("b"), { signal: second.signal });
  assert.deepEqual(
    registry.tools().map(({ name }) => name),
    ["a", "b"],
  );
  assert.throws(
    () => registry.register(tool("a"), { signal: second.signal }),
    Refusal,
  );

  first.abort();
  assert.deepEqual(
    registry.tools().map(({ name }) => name),
    ["b"],
  );
  registry.register(tool("a"), { signal: second.signal });
  assert.deepEqual(
    registry.tools().map(({ name }) => name),
    ["b", "a"],
  );

  second.abort();
  const gone = AbortSignal.abort();
  registry.register(tool("c"), { signal: gone });
  assert.deepEqual(registry.tools(), []);
});

test("given a model context, the same tool and signal are registered there too", () => {
  const seen: { tool: Tool; signal: AbortSignal }[] = [];
  const context: ModelContext = {
    registerTool: (given, { signal }) => seen.push({ tool: given, signal }),
  };
  const registry = toolRegistry(context);
  const one = tool("a");
  const controller = new AbortController();
  registry.register(one, { signal: controller.signal });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.tool, one);
  assert.equal(seen[0]!.signal, controller.signal);
  assert.deepEqual(registry.tools(), [one]);
});
