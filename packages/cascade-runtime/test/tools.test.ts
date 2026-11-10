import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

const namesIn = (registry: ReturnType<typeof toolRegistry>) =>
  registry.tools().map(({ name }) => name);

/**
 * `toolRegistry()` keeps the list of tools a web page offers a model, each until the `AbortSignal` it was registered
 * with aborts. Given the browser's model context (`document.modelContext`), it registers each tool there too.
 */
describe("Offering tools to a model in a web page · toolRegistry()", () => {
  describe("register(tool, { signal })", () => {
    it("lists tools in the order they were registered", () => {
      const registry = toolRegistry();
      registry.register(tool("a"), { signal: new AbortController().signal });
      registry.register(tool("b"), { signal: new AbortController().signal });
      assert.deepEqual(namesIn(registry), ["a", "b"]);
    });

    it("throws `Refusal` for a name that is already listed", () => {
      const registry = toolRegistry();
      const { signal } = new AbortController();
      registry.register(tool("a"), { signal });
      assert.throws(() => registry.register(tool("a"), { signal }), Refusal);
    });

    it("removes a tool when its signal aborts", () => {
      const registry = toolRegistry();
      const first = new AbortController();
      registry.register(tool("a"), { signal: first.signal });
      registry.register(tool("b"), { signal: new AbortController().signal });
      first.abort();
      assert.deepEqual(namesIn(registry), ["b"]);
    });

    it("accepts a name again once the tool that had it is removed", () => {
      const registry = toolRegistry();
      const first = new AbortController();
      registry.register(tool("a"), { signal: first.signal });
      registry.register(tool("b"), { signal: new AbortController().signal });
      first.abort();
      registry.register(tool("a"), { signal: new AbortController().signal });
      assert.deepEqual(namesIn(registry), ["b", "a"]);
    });

    it("ignores a tool whose signal has already aborted", () => {
      const registry = toolRegistry();
      registry.register(tool("c"), { signal: AbortSignal.abort() });
      assert.deepEqual(registry.tools(), []);
    });
  });

  describe("given a model context", () => {
    it("passes each tool and its signal to the context's `registerTool`", () => {
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
