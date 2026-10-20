import type { Layout } from "@cascade-runtime/runtime";
import { type Start, viewTitles } from "../front-page.js";

const APP = "my-app";
const COMMAND = "create-cascade-app";
/** Where `create-cascade-app` is released, a `build-<commit>` pre-release for each commit of its main. */
export const STARTER_REPOSITORY =
  "https://github.com/jayostis/cascade-starter-kit";

/** The word as a shell reads it: quoted when it holds a space or a character a shell would act on. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(word)
    ? word
    : `"${word.replaceAll('"', '\\"')}"`;
}

/** The address of `create-cascade-app` in the starter kit's release of the commit. */
export function starterAddress(commit: string): string {
  return `${STARTER_REPOSITORY}/releases/download/build-${commit}/${COMMAND}-0.0.0-commit-${commit}.tgz`;
}

/** The one line that makes an app in the folder with `create-cascade-app` at the address. */
export function startLine(address: string, folder: string): string {
  return `npx --yes --package=${shellWord(address)} ${COMMAND} ${shellWord(folder)}`;
}

/** What a person gives a coding agent, started in the folder holding the made app, to build their app in it. */
export function agentPrompt(folder: string): string {
  return [
    `Build me an app on a Cascade pod. Work inside ${folder}: read its AGENTS.md first and follow it, and use only what its guide teaches.`,
    "My idea: <describe your idea in a sentence>",
  ].join("\n");
}

/** What the front page and the quick start give a newcomer, for the starter kit's release of the commit, with the example's pod. */
export function startOf(
  starterCommit: string,
  layout: Layout,
  example: string,
): Start {
  return {
    command: startLine(starterAddress(starterCommit), APP),
    app: APP,
    prompt: agentPrompt(APP),
    kinds: viewTitles(layout),
    example,
  };
}
