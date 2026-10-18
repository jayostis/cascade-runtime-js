import { IN_THIS_THREAD, type RowsWork } from "../rows.js";

/** A call of `RowsWork`, by its name, with its arguments, and the number its answer is sent back with. */
export interface RowsCall {
  readonly id: number;
  readonly call: keyof RowsWork;
  readonly args: readonly unknown[];
}

/** The answer to the call of that number, or why it failed. */
export type RowsAnswer =
  | { readonly id: number; readonly answer: unknown }
  | { readonly id: number; readonly failed: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<RowsCall>) => void) | null;
  postMessage(message: RowsAnswer, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

async function answered({ id, call, args }: RowsCall): Promise<void> {
  try {
    const answer: unknown = await (
      IN_THIS_THREAD[call] as (...args: readonly unknown[]) => Promise<unknown>
    )(...args);
    scope.postMessage(
      { id, answer },
      (answer instanceof Uint8Array
        ? [answer]
        : Object.values(answer as object).filter(
            (value) => value instanceof Uint8Array,
          )
      ).map((bytes: Uint8Array) => bytes.buffer),
    );
  } catch (error) {
    scope.postMessage(
      { id, failed: error instanceof Error ? error.message : String(error) },
      [],
    );
  }
}

// One call at a time, in the order they came, so only one version's rows are held whole here.
let turn = Promise.resolve();
scope.onmessage = ({ data }) => {
  turn = turn.then(() => answered(data));
};
