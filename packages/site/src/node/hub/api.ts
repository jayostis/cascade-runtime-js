import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENTS_FILE,
  API_PAGE,
  apiPages,
  INDEX_FILE,
  LLMS_FILE,
} from "../../agents.js";
import type { PagesContext } from "../../hub/context.js";
import type { Section } from "../../sections.js";

const PACKAGE = ["packages", "cascade-runtime"];

/**
 * The API page, from the package's guide and README, and the guide itself at the root as AGENTS.md. Its rows also name
 * `llms.txt`, which the finisher writes once every section is in.
 */
export const apiSection: Section<PagesContext> = {
  path: API_PAGE,
  title: "The API",
  want: "build",
  about:
    "openPod and every call of cascade-runtime, as the guide a coding agent reads.",
  source:
    "packages/cascade-runtime/guide/AGENTS.md and README.md in cascade-runtime-js",
  async build({ root }) {
    const guide = await readFile(join(root, ...PACKAGE, "guide", AGENTS_FILE));
    const readme = await readFile(join(root, ...PACKAGE, "README.md"), "utf8");
    return new Map([
      ...apiPages(guide.toString("utf8"), readme),
      [AGENTS_FILE, new Uint8Array(guide)],
    ]);
  },
  async rows() {
    return [
      {
        href: "api/",
        label: "The API: openPod and every call",
        about: "what a coding agent reads, as a page.",
      },
      {
        href: AGENTS_FILE,
        label: "The guide as a file",
        want: "agent",
        about: "AGENTS.md, what to give a coding agent.",
      },
      {
        href: LLMS_FILE,
        label: "Point an agent at this site",
        want: "agent",
        about: "llms.txt, and an index of every page as JSON.",
        also: { href: INDEX_FILE, label: INDEX_FILE },
      },
    ];
  },
};
