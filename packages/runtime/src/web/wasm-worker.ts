import {
  type Answer,
  type BridgeGlue,
  type Request,
  serving,
} from "../wasm-bridge.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/**
 * Serves the Bridge in this Web Worker, once the page sends its compiled module, from its glue: bundled in with this
 * module when the package is packed, so that nothing loads code by a URL made at run time.
 */
export function serveBridge(glue: BridgeGlue): void {
  const scope = self as unknown as WorkerScope;
  let served: ((request: Request) => Answer) | Error | undefined;
  scope.onmessage = (event) => {
    const message = event.data as
      { module: WebAssembly.Module } | { id: number; request: Request };
    if ("module" in message) {
      try {
        glue.initSync({ module: message.module });
        served = serving(glue);
      } catch (error) {
        served = error instanceof Error ? error : new Error(String(error));
      }
      return;
    }
    try {
      if (served === undefined)
        throw new Error("the worker was sent no Bridge");
      if (served instanceof Error) throw served;
      const { reply, transfer } = served(message.request);
      scope.postMessage({ id: message.id, reply }, transfer);
    } catch (error) {
      scope.postMessage(
        {
          id: message.id,
          reply: {
            ok: false,
            failure: {
              name: "BridgeError",
              kind: "bridge",
              message: error instanceof Error ? error.message : String(error),
            },
          },
        },
        [],
      );
    }
  };
}
