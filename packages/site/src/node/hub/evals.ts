import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FolderFiles } from "@cascade-runtime/runtime/node";
import type { PagesContext } from "../../hub/context.js";
import type { Section } from "../../sections.js";

/** The part of the evals package that writes its report; the site package does not depend on it, so the compiled module is imported by path. */
interface Evals {
  buildSite(from: { history: true }, out: string): Promise<string>;
}

/** The eval report from the recorded runs in packages/evals/history, under evals/. */
export const evalsSection: Section<PagesContext> = {
  path: "evals/index.html",
  title: "Evals",
  want: "evals",
  about:
    "recorded runs of a model answering a person's questions from a pod, against reading her downloads in full.",
  source: "packages/evals/history in cascade-runtime-js",
  optional: true,
  async build({ root }) {
    const { buildSite } = (await import(
      pathToFileURL(join(root, "packages", "evals", "dist", "src", "site.js"))
        .href
    )) as Evals;
    const out = await mkdtemp(join(tmpdir(), "evals-site-"));
    try {
      await buildSite({ history: true }, out);
      const folder = new FolderFiles(out);
      const files = new Map<string, Uint8Array>();
      for (const path of await folder.list("")) {
        const bytes = await folder.read(path);
        if (bytes !== undefined) files.set(`evals/${path}`, bytes);
      }
      return files;
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  },
  async rows() {
    return [
      {
        href: "evals/",
        label: "How well a model answers from a pod",
        about:
          "recorded runs of a model answering a person's questions, against reading her downloads in full.",
      },
    ];
  },
};
