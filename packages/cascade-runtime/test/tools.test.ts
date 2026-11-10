import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
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

describe("toolRegistry", () => {
  describe("registering tools", () => {
    let registry: ReturnType<typeof toolRegistry>;
    const first = new AbortController();
    const second = new AbortController();
    const listed = () => registry.tools().map(({ name }) => name);

    before(() => {
      registry = toolRegistry();
      registry.register(tool("a"), { signal: first.signal });
      registry.register(tool("b"), { signal: second.signal });
    });

    it("lists them in the order registered", () => {
      assert.deepEqual(listed(), ["a", "b"]);
    });

    it("refuses a name registered twice", () => {
      assert.throws(
        () => registry.register(tool("a"), { signal: second.signal }),
        Refusal,
      );
    });

    it("stops listing a tool when its signal aborts", () => {
      first.abort();
      assert.deepEqual(listed(), ["b"]);
    });

    it("accepts the name of a tool that has gone", () => {
      registry.register(tool("a"), { signal: second.signal });
      assert.deepEqual(listed(), ["b", "a"]);
    });

    it("never lists a tool whose signal has already aborted", () => {
      second.abort();
      registry.register(tool("c"), { signal: AbortSignal.abort() });
      assert.deepEqual(registry.tools(), []);
    });
  });

  describe("given a model context", () => {
    it("registers the same tool and signal there too", () => {
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
  });
});
