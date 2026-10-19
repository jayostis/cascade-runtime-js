import { tablesBeside } from "cascade-runtime";

/**
 * Waits for what the tables beside the pods in the folder go on doing after a pod opens: the copy, and the check on
 * open, waited for by a check queued behind it that reads nothing. A test removes the folder only after.
 */
export async function settled(pods: string): Promise<void> {
  const tables = await tablesBeside(pods);
  await Promise.all([
    tables.start(),
    tables.check({ signal: AbortSignal.abort() }),
  ]);
}
