import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkInput as main, Refusal } from "cascade-runtime";
import { checkInput, type Input, type Schema } from "cascade-runtime/check";

const SCHEMA: Schema = {
  type: "object",
  properties: { person: { type: "string" } },
  required: ["person"],
  additionalProperties: false,
};

describe("the check subpath on Node", () => {
  it("is the main entry's checkInput", () => {
    assert.equal(checkInput, main);
  });

  it("accepts an input that fits the schema", () => {
    const given: Input = { person: "x" };
    checkInput(SCHEMA, given);
  });

  it("refuses one that does not with the runtime's Refusal", () => {
    assert.throws(
      () => checkInput(SCHEMA, {}),
      (error: unknown) =>
        error instanceof Refusal && /person is required/.test(error.message),
    );
  });
});
