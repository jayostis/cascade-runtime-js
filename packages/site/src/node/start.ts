import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Start } from "../front-page.js";

const APP = "my-app";

type Address = typeof import("../../../cascade-runtime/pack/address.js");
type Create = typeof import("../../../cascade-runtime/src/create.js");

/** cascade-runtime's address and start functions, from its compiled files in the workspace, which its exports do not offer. */
export async function startFunctions(
  root: string,
): Promise<
  Pick<Address, "tarballAddress"> & Pick<Create, "startLine" | "agentPrompt">
> {
  const dist = join(root, "packages", "cascade-runtime", "dist");
  const { tarballAddress } = (await import(
    pathToFileURL(join(dist, "pack", "address.js")).href
  )) as Address;
  const { startLine, agentPrompt } = (await import(
    pathToFileURL(join(dist, "src", "create.js")).href
  )) as Create;
  return { tarballAddress, startLine, agentPrompt };
}

/** What the quick start gives a newcomer, for the release of the commit. */
export async function startOf(root: string, commit: string): Promise<Start> {
  const { tarballAddress, startLine, agentPrompt } = await startFunctions(root);
  const address = tarballAddress(commit);
  return {
    command: startLine(address, APP),
    app: APP,
    prompt: agentPrompt(APP),
  };
}
