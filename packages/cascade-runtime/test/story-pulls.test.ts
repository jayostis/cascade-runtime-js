import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { Story } from "@the-cascade-protocol/sandbox";
import { loadStories } from "@the-cascade-protocol/sandbox/node";
import { kitDownload } from "cascade-runtime/fixtures";
import { storyPulls } from "./story-pulls.js";

const KIT = "tamsin-vale";

const parsed = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));

describe("Tripwire: copies of the kits' data kept in other repositories", () => {
  describe("given the pulls a kit saves of a sandbox story, `tamsin-vale`", () => {
    let story: Story;
    let made: ReadonlyMap<string, Uint8Array>;

    before(async () => {
      story = (await loadStories()).find(({ pulls }) => pulls?.length)!;
      made = await storyPulls(story.patient);
    });

    it("matches, file for file, what `npm run story:pulls` makes from the demo hospital today", async () => {
      const names = story.pulls!.map(({ name }) => name);
      assert.deepEqual(
        [...made.keys()].sort(),
        names
          .flatMap((name) => [`${name}/bundle.json`, `${name}/pull.json`])
          .sort(),
      );
      for (const name of names) {
        const folder = await kitDownload(KIT, name);
        for (const file of ["bundle.json", "pull.json"])
          assert.deepEqual(
            JSON.parse(await readFile(join(folder, file), "utf8")),
            parsed(made.get(`${name}/${file}`)!),
            `${KIT} ${name}/${file}`,
          );
      }
    });
  });
});
