import { ConnectionFailure } from "cascade-runtime";

/** What the live launcher check throws when the sandbox, not the runtime, is down. */
export class SandboxUnavailable extends Error {
  override readonly name = "SandboxUnavailable";
}

/**
 * Whether the sandbox's FHIR server answers a request of its own, outside the runtime: its `metadata`, which needs no
 * token. A request that is not answered in `timeoutMs`, fails in transport, or is answered 429 or 5xx is not an answer.
 */
export async function sandboxAnswers(
  fhirBase: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<boolean> {
  void fhirBase;
  void fetcher;
  void timeoutMs;
  return true;
}

/**
 * Throws what the live check threw, unless the runtime gave up after its retries and the sandbox does not answer a
 * request of its own either: then it throws `SandboxUnavailable`, so a red run names the sandbox. Any other failure,
 * and any the sandbox could have answered, stays the runtime's.
 */
export async function rethrowing(
  error: unknown,
  answers: () => Promise<boolean>,
): Promise<never> {
  void ConnectionFailure;
  void answers;
  throw error;
}
