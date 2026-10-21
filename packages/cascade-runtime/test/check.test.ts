import assert from "node:assert/strict";
import { test } from "node:test";
import { checkInput as main, Refusal } from "cascade-runtime";
import { checkInput, type Input, type Schema } from "cascade-runtime/check";

const SCHEMA: Schema = {
  type: "object",
  properties: { person: { type: "string" } },
  required: ["person"],
  additionalProperties: false,
};

test("on Node the subpath is the main entry's checkInput, and it accepts an input and refuses one with the runtime's Refusal", () => {
  assert.equal(checkInput, main);
  const given: Input = { person: "x" };
  checkInput(SCHEMA, given);
  assert.throws(
    () => checkInput(SCHEMA, {}),
    (error: unknown) =>
      error instanceof Refusal && /person is required/.test(error.message),
  );
});
