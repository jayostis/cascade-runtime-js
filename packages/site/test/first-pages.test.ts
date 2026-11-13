import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  type FolderPack,
  kitsOf,
  titleOf,
  unpackFolder,
} from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import type { LocalVocabulary } from "@cascade-runtime/runtime/node";
import {
  EXAMPLES_PAGE,
  FRONT_PAGE,
  hubFiles,
  START_PAGE,
  STARTER_TRY,
  TRY_PAGE,
  viewTitles,
} from "../src/front-page.js";
import { escape } from "../src/html.js";
import { examplesSection } from "../src/hub/examples.js";
import { startSection } from "../src/hub/start.js";
import { trySection } from "../src/hub/try.js";
import { buildTree, isLocal } from "../src/sections.js";
import { agentPrompt, startOf } from "../src/node/start.js";
import { readPage } from "./page.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A kit's site as the Pages pages read it: its home page, the explorer's data, the layout page and the pod's files, which they list and pack. */
const standIn = new Map(
  [
    "index.html",
    "explorer.json",
    "layout.html",
    "pod/manifest.ttl",
    "pod/a.ttl",
    "pod/b/c.ttl",
  ].map((path) => [path, new TextEncoder().encode(path)] as const),
);

/** The tree of the Pages pages over the vocabulary's kits, built once for the tests of all of them. */
async function pagesOf(vocabulary: LocalVocabulary) {
  const kits = await kitsOf(vocabulary.files);
  assert.ok(kits.length > 0);
  const examples = await Promise.all(
    kits.map(async (kit) => ({
      folder: kit.slice(kit.lastIndexOf("/") + 1),
      title: await titleOf(vocabulary.files, kit),
      site: standIn,
    })),
  );
  const vocabularyAt = {
    name: "cascade-vocabulary",
    version: vocabulary.resolved.version,
    href: vocabulary.resolved.iri,
  };
  const built = {
    ingredients: [vocabularyAt],
    configured: [],
    at: "2026-03-03T08:00:00Z",
  };
  const start = startOf(COMMIT, vocabulary.layout, examples[0]?.folder ?? "");
  const ctx = {
    root: ROOT,
    log: () => undefined,
    vocabulary: async () => ({
      files: vocabulary.files,
      builtFrom: built.ingredients,
      at: built.at,
    }),
    report: async () => ({
      report: { results: new Map(), ranWith: [], repeated: [] },
    }),
    tests: async () => [],
    adapters: async () => [],
    examples: async () => examples,
    builtFrom: async () => built,
    start: async () => start,
  };
  const sections = [startSection, trySection, examplesSection];
  const front = (rows: Parameters<typeof hubFiles>[1]) =>
    hubFiles(viewTitles(vocabulary.layout), rows);
  return {
    examples,
    vocabularyAt,
    tree: (await buildTree({ sections, ctx, front })).tree,
    refused: () =>
      buildTree({
        sections,
        ctx: { ...ctx, start: async () => ({ ...start, example: "nobody" }) },
        front,
      }),
  };
}

const textOf = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));

/** The local links of `hrefs` that the tree does not hold. */
const missingFrom = (
  tree: ReadonlyMap<string, Uint8Array>,
  hrefs: readonly string[],
) => hrefs.filter((href) => isLocal(href) && !tree.has(href));

let vocabulary: LocalVocabulary;
let built: Awaited<ReturnType<typeof pagesOf>>;

before(async () => {
  vocabulary = await localVocabulary(ROOT);
  built = await pagesOf(vocabulary);
});

/**
 * Three sections carry a newcomer's first minutes: the quick start (`start.html`) gives one command, `examples.html`
 * lists each kit's pod, and `try/`, which moved to the starter kit, sends its old visitors on.
 */
describe("A newcomer's first pages · startSection, examplesSection, trySection", () => {
  describe("with `start.html`", () => {
    let quick: ReturnType<typeof readPage>;

    before(() => {
      quick = readPage(textOf(built.tree, START_PAGE));
    });

    it("gives the starter kit's command at the commit built, then the prompt for a coding agent", () => {
      assert.deepEqual(quick.code, [
        `npx --yes --package=https://github.com/jayostis/cascade-starter-kit/releases/download/build-${COMMIT}/create-cascade-app-0.0.0-commit-${COMMIT}.tgz create-cascade-app my-app`,
        agentPrompt("my-app"),
      ]);
    });

    it("links the front page and the starter kit's `try/`", () => {
      assert.ok(quick.hrefs.includes(FRONT_PAGE));
      assert.ok(quick.hrefs.includes(STARTER_TRY));
    });

    it("links no file the site lacks", () => {
      assert.deepEqual(missingFrom(built.tree, quick.hrefs), []);
    });

    it("refuses a kit name the vocabulary lacks", async () => {
      await assert.rejects(built.refused(), /no example nobody among the kits/);
    });
  });

  describe("with `examples.html`", () => {
    let text: string;
    let examples: ReturnType<typeof readPage>;

    before(() => {
      text = textOf(built.tree, EXAMPLES_PAGE);
      examples = readPage(text);
    });

    it("links each kit of the vocabulary, by its name, to its site", () => {
      for (const { folder, title } of built.examples)
        assert.ok(
          text.includes(`<a href="${folder}/index.html">${escape(title)}</a>`),
          title,
        );
    });

    it("links no file the site lacks", () => {
      const local = examples.hrefs.filter((href) => !/^https?:/.test(href));
      assert.ok(local.length > built.examples.length);
      assert.deepEqual(missingFrom(built.tree, local), []);
    });

    it("links the vocabulary at the commit it was built from", () => {
      assert.ok(examples.hrefs.includes(built.vocabularyAt.href));
    });
  });

  describe("with a kit's pod on the site", () => {
    /** The pod's files the site holds under `<folder>/pod/`, less the list of them. */
    const held = (folder: string) => {
      const pod = `${folder}/pod/`;
      return [...built.tree.keys()]
        .filter((path) => path.startsWith(pod) && path !== `${pod}files.json`)
        .map((path) => path.slice(pod.length))
        .sort();
    };

    it("lists in `files.json` exactly the pod's files the site holds", () => {
      for (const { folder } of built.examples) {
        assert.ok(held(folder).length > 0);
        assert.deepEqual(
          JSON.parse(textOf(built.tree, `${folder}/pod/files.json`)),
          held(folder),
          folder,
        );
      }
    });

    it("holds the same files in `pod.pack.json`", () => {
      for (const { folder } of built.examples) {
        const pack = JSON.parse(
          textOf(built.tree, `${folder}/pod.pack.json`),
        ) as FolderPack;
        assert.deepEqual([...unpackFolder(pack).keys()], held(folder), folder);
      }
    });
  });

  describe("with `try/index.html`", () => {
    let text: string;
    const here = "https://jayostis.github.io/cascade-runtime-js/try/";
    const sentFrom = async (
      registrations: string[],
      unregistered: string[],
    ): Promise<string> => {
      const script = /<script>([\s\S]*?)<\/script>/.exec(text)?.[1];
      assert.ok(script, "the page runs no script");
      return new Promise<string>((done) =>
        runInNewContext(script, {
          URL,
          setTimeout: (run: () => void) => setTimeout(run, 1),
          location: {
            href: `${here}index.html?pod=alex-rivera&entry=a1#records`,
            search: "?pod=alex-rivera&entry=a1",
            hash: "#records",
            replace: done,
          },
          navigator: {
            serviceWorker: {
              getRegistrations: async () =>
                registrations.map((scope) => ({
                  scope,
                  unregister: () => {
                    unregistered.push(scope);
                    return new Promise<never>(() => {});
                  },
                })),
            },
          },
        }),
      );
    };

    before(() => {
      text = textOf(built.tree, TRY_PAGE);
    });

    it("links the starter kit's `try/`, for a reader whose browser runs no script", () => {
      assert.ok(readPage(text).hrefs.includes(STARTER_TRY));
    });

    it("sends a visitor on with the pod, the view entry and the place they asked for", async () => {
      assert.equal(
        await sentFrom([here], []),
        `${STARTER_TRY}?pod=alex-rivera&entry=a1#records`,
      );
    });

    it("unregisters the browser's background script (a service worker) of its own folder and no other", async () => {
      const unregistered: string[] = [];
      await sentFrom(
        [here, "https://jayostis.github.io/cascade-starter-kit/try/"],
        unregistered,
      );
      assert.deepEqual(unregistered, [here]);
    });
  });
});

describe("The front page · hubFiles()", () => {
  describe("given the titles of a pod's views", () => {
    let front: ReturnType<typeof readPage>;

    before(() => {
      front = readPage(textOf(built.tree, FRONT_PAGE));
    });

    it("names each kind of record a pod holds, in the views' order", () => {
      const titles = vocabulary.layout.views.map(({ title }) => title ?? "");
      assert.ok(titles.length > 0);
      assert.ok(front.said.includes(titles.join(" ")));
    });

    it("names the two formats a pod is built from, FHIR R4 and C-CDA", () => {
      assert.ok(front.said.includes("FHIR R4"));
      assert.ok(front.said.includes("C-CDA"));
    });

    it("shows no command", () => {
      assert.deepEqual(front.code, []);
    });

    it("links no file the site lacks", () => {
      assert.deepEqual(missingFrom(built.tree, front.hrefs), []);
    });
  });
});
