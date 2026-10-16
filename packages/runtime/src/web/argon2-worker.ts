import {
  type Argon2Request,
  type Argon2Response,
  argon2idHere,
} from "./argon2-direct.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<Argon2Request>) => void) | null;
  postMessage(message: Argon2Response, transfer: Transferable[]): void;
}
const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, secret, salt, params } = event.data;
  argon2idHere(secret, salt, params).then(
    (key) => {
      secret.fill(0);
      scope.postMessage({ id, key }, [key.buffer as ArrayBuffer]);
    },
    (error: unknown) => {
      secret.fill(0);
      scope.postMessage(
        { id, error: error instanceof Error ? error.message : String(error) },
        [],
      );
    },
  );
};
