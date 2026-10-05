import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, StoryTime } from "../src/ids.js";

const VERSION_4 =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("every new ID is a version 4 UUID that never repeats, in use and in replay alike", () => {
  const story = new StoryTime();
  const ids = Array.from({ length: 200 }, (_, index) =>
    (index % 2 ? story : clock).newId(),
  );
  for (const id of ids) assert.match(id, VERSION_4);
  assert.equal(new Set(ids).size, ids.length);
});

test("in replay the time is the time of the step that began last", () => {
  const story = new StoryTime();
  assert.throws(() => story.now(), /no step/);
  story.begin("2026-01-02T10:00:00Z");
  story.begin("2026-01-03T10:00:00Z");
  assert.equal(story.now(), "2026-01-03T10:00:00Z");
});
