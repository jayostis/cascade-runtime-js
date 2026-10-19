import { tablesBeside } from "cascade-runtime";

/** Waits for the copy of the tables beside the pods in the folder, which goes on after a pod opens. */
export async function settled(pods: string): Promise<void> {
  await (await tablesBeside(pods)).start();
}
