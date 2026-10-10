import { IN_THIS_THREAD, type RowsWork } from "../rows.js";

/** A call of `RowsWork`, by its name, with its arguments. */
export interface RowsCall {
  readonly call: keyof RowsWork;
  readonly args: readonly unknown[];
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<RowsCall>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async ({ data: { call, args } }) => {
  try {
    const answer: unknown = await (
      IN_THIS_THREAD[call] as (...args: readonly unknown[]) => Promise<unknown>
    )(...args);
    scope.postMessage(
      { answer },
      (answer instanceof Uint8Array
        ? [answer]
        : Object.values(answer as object).filter(
            (value) => value instanceof Uint8Array,
          )
      ).map((bytes: Uint8Array) => bytes.buffer),
    );
  } catch (error) {
    scope.postMessage(
      { failed: error instanceof Error ? error.message : String(error) },
      [],
    );
  }
};
