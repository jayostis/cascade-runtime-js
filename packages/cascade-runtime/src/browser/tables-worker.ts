import { type RowsToVerify, verified } from "../rows.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<RowsToVerify>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (event) => {
  try {
    const answer = await verified(event.data);
    scope.postMessage(
      answer,
      "refused" in answer
        ? []
        : [
            answer.text,
            answer.listed,
            ...(answer.codes ? [answer.codes] : []),
          ].map((bytes) => bytes.buffer),
    );
  } catch (error) {
    scope.postMessage(
      { failed: error instanceof Error ? error.message : String(error) },
      [],
    );
  }
};
