import { ConnectionFailure } from "cascade-runtime";

/** What the live launcher check throws when the launcher, not the runtime, is down. */
export class LauncherUnavailable extends Error {
  override readonly name = "LauncherUnavailable";
}

/**
 * Whether the launcher's FHIR server answers a request of its own, outside the runtime: its `metadata`, which needs no
 * token. A request that is not answered in `timeoutMs`, fails in transport, or is answered 5xx is not an answer; a 429
 * is, since a launcher that rate-limits is up.
 */
export async function launcherAnswers(
  fhirBase: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<boolean> {
  try {
    const { status } = await fetcher(`${fhirBase}/metadata`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return status < 500;
  } catch {
    return false;
  }
}

/**
 * The failure a red run of the launcher check reports: what the check threw, unless the runtime gave up after its
 * retries and the launcher does not answer a request of its own either, which is `LauncherUnavailable`, so a red run
 * names the launcher. Any other failure, any the launcher could have answered, and any that gave up on 429s, is the
 * runtime's.
 */
export async function failureToReport(
  error: unknown,
  launcherAnswers: () => Promise<boolean>,
): Promise<unknown> {
  if (
    error instanceof ConnectionFailure &&
    error.kind === "retries-exhausted" &&
    error.status !== 429 &&
    !(await launcherAnswers())
  )
    return new LauncherUnavailable(
      `the SMART launcher's sandbox is down, not the runtime: ${error.message}, and its FHIR server answers no request of its own either`,
      { cause: error },
    );
  return error;
}
