import { type CompiledBridge, type Spawn, Waiting } from "../wasm-bridge.js";

/** The package's module compiled from its URL, beside the URL of its glue module. */
export async function compiledBridge(
  glue: string,
  wasm: string,
): Promise<CompiledBridge> {
  return { glue, module: await WebAssembly.compileStreaming(fetch(wasm)) };
}

/** Each instance in a Web Worker of its own. */
export function inWebWorker(compiled: CompiledBridge): Spawn {
  return () => {
    const worker = new Worker(new URL("./wasm-worker.js", import.meta.url), {
      type: "module",
    });
    const waiting = new Waiting();
    worker.onmessage = (event) => waiting.answered(event.data);
    worker.onerror = (event) => {
      waiting.lost(new Error(event.message));
      worker.terminate();
    };
    worker.postMessage({ compiled });
    return Promise.resolve({
      call: (request, transfer) =>
        waiting.send(
          (message) => worker.postMessage(message, transfer),
          request,
        ),
      end: () => {
        worker.terminate();
        waiting.lost(new Error("the worker was ended"));
      },
    });
  };
}
