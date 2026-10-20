import { type Spawn, Waiting } from "../wasm-bridge.js";

/** The Bridge's WebAssembly module, compiled from its URL. */
export function compiledBridge(
  wasm: string | URL,
): Promise<WebAssembly.Module> {
  return WebAssembly.compileStreaming(fetch(wasm));
}

/** Each instance in a Web Worker of its own: the one at `worker`, else the one beside this module. */
export function inWebWorker(module: WebAssembly.Module, worker?: URL): Spawn {
  return () => {
    const started =
      worker === undefined
        ? new Worker(new URL("./wasm-worker.js", import.meta.url), {
            type: "module",
          })
        : new Worker(worker, { type: "module" });
    const waiting = new Waiting();
    started.onmessage = (event) => waiting.answered(event.data);
    started.onerror = (event) => {
      waiting.lost(new Error(event.message));
      started.terminate();
    };
    started.postMessage({ module });
    return Promise.resolve({
      call: (request, transfer) =>
        waiting.send(
          (message) => started.postMessage(message, transfer),
          request,
        ),
      end: () => {
        started.terminate();
        waiting.lost(new Error("the worker was ended"));
      },
    });
  };
}
