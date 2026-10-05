import {
  type Answer,
  type BridgeGlue,
  type CompiledBridge,
  type Request,
  serving,
} from "../wasm-bridge.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let served: Promise<(request: Request) => Answer> | undefined;

scope.onmessage = async (event) => {
  const message = event.data as
    { compiled: CompiledBridge } | { id: number; request: Request };
  if ("compiled" in message) {
    const { glue, module } = message.compiled;
    served = import(glue).then((bridge: BridgeGlue) => {
      bridge.initSync({ module });
      return serving(bridge);
    });
    return;
  }
  if (served === undefined) throw new Error("the worker was sent no Bridge");
  const { reply, transfer } = (await served)(message.request);
  scope.postMessage({ id: message.id, reply }, transfer);
};
