import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clock, StoryTime } from "../src/ids.js";

const VERSION_4 =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CALLS = 100;

/** The IDs one object mints in `CALLS` calls, each a version 4 `urn:uuid:` that no earlier call returned. */
function mintedBy(object: { newId(): string }): void {
  const ids = Array.from({ length: CALLS }, () => object.newId());
  for (const id of ids) assert.match(id, VERSION_4);
  assert.equal(new Set(ids).size, CALLS, "a call returned an ID again");
}

/**
 * An import, a matcher run and a sync are each named by a new random UUID, and every act says when it happened. A pod
 * takes both from one object: `clock` in use and, in a replay, a `StoryTime`, which gives the time its story's step
 * states and IDs as random as `clock`'s.
 * @rule runtime/naming.feature N7
 */
describe("Minting IDs and telling the time · clock, StoryTime", () => {
  describe("clock", () => {
    it("returns from `newId()` a version 4 `urn:uuid:` no earlier call returned", () => {
      mintedBy(clock);
    });
  });

  describe("StoryTime", () => {
    it("returns from `newId()` a version 4 `urn:uuid:` no earlier call returned", () => {
      mintedBy(new StoryTime());
    });

    it("returns from `now()` the time of the step that began last", () => {
      const story = new StoryTime();
      story.begin("2026-01-02T10:00:00Z");
      story.begin("2026-01-03T10:00:00Z");
      assert.equal(story.now(), "2026-01-03T10:00:00Z");
    });

    it("throws from `now()` before any step has begun", () => {
      assert.throws(() => new StoryTime().now(), /no step/);
    });
  });
});
