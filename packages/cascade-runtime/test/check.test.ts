import assert from "node:assert/strict";
import { test } from "node:test";
import { checkInput as main, Refusal } from "cascade-runtime";
import { checkInput, type Input, type Schema } from "cascade-runtime/check";

const SCHEMA: Schema = {
  type: "object",
  properties: {
    person: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 5 },
    kind: { type: "string", enum: ["a", "b"] },
  },
  required: ["person"],
  additionalProperties: false,
};

test("the subpath is the runtime's checkInput, and its refusals are the runtime's Refusal", () => {
  assert.equal(checkInput, main);
  const given: Input = { person: "x", limit: 3, kind: "a" };
  checkInput(SCHEMA, given);

  const refused: [unknown, RegExp][] = [
    [{}, /person is required/],
    [[], /must be an object/],
    [null, /must be an object/],
    ["text", /must be an object/],
    [{ person: 1 }, /must be a string/],
    [{ person: "x", limit: 1.5 }, /must be an integer/],
    [{ person: "x", limit: 0 }, /at least 1/],
    [{ person: "x", limit: 6 }, /at most 5/],
    [{ person: "x", kind: "c" }, /one of a, b/],
    [{ person: "x", other: 1 }, /not a property/],
    [{ person: "x", toString: 1 }, /not a property/],
  ];
  for (const [input, reason] of refused)
    assert.throws(
      () => checkInput(SCHEMA, input),
      (error: unknown) =>
        error instanceof Refusal && reason.test(error.message),
      JSON.stringify(input),
    );
});
