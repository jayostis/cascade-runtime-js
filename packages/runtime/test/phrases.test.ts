import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { compile } from "../src/phrases.js";

test("the variants and variant-interpretations views are views a step reads", async () => {
  const person = {
    name: "Test",
    subject: "urn:test:subject",
    address: "urn:test:pod/",
    folder: "test",
  };
  const compiled = await compile(
    [
      { text: "a new pod for Test on 2026-10-13 at 09:00" },
      {
        text: "the variants view holds these entries:",
        table: [["members"], ["V1"]],
      },
      { text: "the variant-interpretations view has no entry" },
    ],
    {
      vocabulary: new MemoryFiles("urn:test:vocabulary/"),
      people: new Map([["Test", person]]),
      references: () => Promise.reject(new Error("no table is read")),
    },
  );
  assert.deepEqual(
    compiled.checks.map(({ text }) => text),
    [
      "the variants view holds these entries:",
      "the variant-interpretations view has no entry",
    ],
  );
});
