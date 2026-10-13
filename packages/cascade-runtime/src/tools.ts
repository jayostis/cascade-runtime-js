import { Refusal } from "@cascade-runtime/runtime";
import type { ChangeTool } from "./changes.js";

/** The tool shape MCP, WebMCP and CopilotKit share. */
export type Tool = ChangeTool;

/** What a page's `document.modelContext` offers: WebMCP's `registerTool`, a tool going when its signal aborts. */
export interface ModelContext {
  registerTool(tool: Tool, options: { signal: AbortSignal }): unknown;
}

export interface ToolRegistry {
  /**
   * Lists the tool until `options.signal` aborts, and gives it to the model context the registry was made with.
   *
   * @throws Refusal when a tool of that name is registered.
   */
  register(tool: Tool, options: { signal: AbortSignal }): void;
  /** The tools registered now, in the order they were. */
  tools(): Tool[];
}

/** A registry of the tools a page offers, given `document.modelContext` where the browser has one. */
export function toolRegistry(modelContext?: ModelContext): ToolRegistry {
  const registered = new Set<Tool>();
  return {
    register(tool, { signal }) {
      if ([...registered].some(({ name }) => name === tool.name))
        throw new Refusal(`a tool ${tool.name} is registered`);
      if (signal.aborted) return;
      modelContext?.registerTool(tool, { signal });
      registered.add(tool);
      signal.addEventListener("abort", () => registered.delete(tool), {
        once: true,
      });
    },
    tools: () => [...registered],
  };
}
