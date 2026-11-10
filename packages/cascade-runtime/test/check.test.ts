import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkInput as main, Refusal } from "cascade-runtime";
import { checkInput, type Input, type Schema } from "cascade-runtime/check";

const SCHEMA: Schema = {
  type: "object",
  properties: {
    person: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 20 },
    order: { type: "string", enum: ["newest", "oldest"] },
    codes: { type: "array", items: { type: "integer" } },
  },
  required: ["person"],
  additionalProperties: false,
};

/** Asserts that `checkInput` refuses `input` with the runtime's `Refusal`, its message matching `message`. */
function refuses(input: unknown, message: RegExp, what?: string): void {
  assert.throws(
    () => checkInput(SCHEMA, input),
    (error: unknown) => error instanceof Refusal && message.test(error.message),
    what,
  );
}

/**
 * `checkInput(schema, input)` holds what a model or a form gave a tool to the tool's schema, written in the few JSON
 * Schema keywords `InputSchema` names, and throws a `Refusal` that says the first thing wrong. It is also served alone
 * from the entry point `cascade-runtime/check`, with none of the runtime behind it, so a web page checks an input
 * without loading the query engine.
 */
describe("Checking a tool's input against its schema · checkInput()", () => {
  describe("checkInput(schema, input)", () => {
    it("returns nothing for an input the schema allows", () => {
      const given: Input = { person: "x" };
      assert.equal(checkInput(SCHEMA, given), undefined);
      assert.equal(
        checkInput(SCHEMA, {
          person: "x",
          limit: 20,
          order: "oldest",
          codes: [1, 2],
        }),
        undefined,
      );
    });

    it("throws `Refusal`, naming the property, when a required property is missing", () => {
      refuses({}, /person is required/);
    });

    it("throws `Refusal` for a property the schema does not name, even one every object inherits, such as `toString`", () => {
      refuses({ person: "x", colour: "red" }, /not a property/, "colour");
      refuses({ person: "x", toString: 1 }, /not a property/, "toString");
    });

    it("throws `Refusal` for a value of another type than the schema's: a number for a string, 1.5 for an integer, a string for an object", () => {
      refuses({ person: 7 }, /must be a string/, "a number for a string");
      refuses(
        { person: "x", limit: 1.5 },
        /must be an integer/,
        "1.5 for an integer",
      );
      refuses("all", /must be an object/, "a string for an object");
    });

    it("throws `Refusal` for an integer under `minimum` or over `maximum`", () => {
      refuses({ person: "x", limit: 0 }, /at least 1/, "under");
      refuses({ person: "x", limit: 21 }, /at most 20/, "over");
    });

    it("throws `Refusal` for a value that is not one of `enum`", () => {
      refuses(
        { person: "x", order: "random" },
        /must be one of newest, oldest/,
      );
    });

    it("names an item of an array by its position, as `input.codes[1]`", () => {
      refuses(
        { person: "x", codes: [1, "2"] },
        /^input\.codes\[1\] must be an integer$/,
      );
    });
  });

  describe("given the entry point `cascade-runtime/check`", () => {
    it("is, in Node, the main entry point's own `checkInput`, so it throws the same `Refusal`", () => {
      assert.equal(checkInput, main);
      assert.throws(() => checkInput(SCHEMA, {}), Refusal);
    });
  });
});
