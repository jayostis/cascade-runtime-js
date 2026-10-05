import { parentPort, workerData } from "node:worker_threads";
import {
  type BridgeGlue,
  type CompiledBridge,
  type Request,
  serving,
} from "../wasm-bridge.js";

const { glue, module } = workerData as CompiledBridge;
const bridge = (await import(glue)) as BridgeGlue;
bridge.initSync({ module });
const serve = serving(bridge);

parentPort?.on(
  "message",
  ({ id, request }: { id: number; request: Request }) => {
    const { reply, transfer } = serve(request);
    parentPort?.postMessage({ id, reply }, transfer);
  },
);
