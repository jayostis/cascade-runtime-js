import assert from "node:assert/strict";
import { describe, it } from "node:test";
import annotateFailures from "../test-launcher/failure-annotations.js";

type Event =
  Parameters<typeof annotateFailures>[0] extends AsyncIterable<infer E>
    ? E
    : never;

function fail(
  name: string,
  message: string,
  failureType = "testCodeFailure",
): Event {
  const error = Object.assign(new Error(message), { failureType });
  return {
    type: "test:fail",
    data: { name, nesting: 0, details: { error } },
  } as Event;
}

async function annotations(events: Event[]): Promise<string> {
  async function* source() {
    yield* events;
  }
  let out = "";
  for await (const chunk of annotateFailures(source())) out += chunk;
  return out;
}

/**
 * A node:test reporter for CI: it writes one GitHub `::error::` line for each failing test, so a red run's summary
 * names the test and why, not only an exit code.
 */
describe("Annotating a red run's failures · failure-annotations.ts", () => {
  describe("given a run's `test:fail` events", () => {
    it("writes one `::error::` line for a failing test, with its name and the first line of its error", async () => {
      assert.equal(
        await annotations([fail("child", "it broke\nand then more lines\n")]),
        "::error::child: it broke\n",
      );
    });

    it("writes nothing for a test that passed, for one that was skipped, and for a parent whose subtests failed", async () => {
      for (const [what, event] of [
        [
          "a test that passed",
          { type: "test:pass", data: { name: "fine", nesting: 0 } },
        ],
        [
          "a test that was skipped, which node:test reports as a pass that carries `skip`",
          {
            type: "test:pass",
            data: { name: "later", nesting: 0, skip: true },
          },
        ],
        [
          "a parent whose subtests failed",
          fail("parent", "1 subtest failed", "subtestsFailed"),
        ],
      ] as [string, Event][])
        assert.equal(
          await annotations([event, fail("real", "it broke")]),
          "::error::real: it broke\n",
          what,
        );
    });

    it("appends the next line that is not empty when the first ends in a colon, which is where an assertion says what differed", async () => {
      assert.equal(
        await annotations([
          fail("equal", "Expected values to be strictly equal:\n\n1 !== 2\n"),
        ]),
        "::error::equal: Expected values to be strictly equal: 1 !== 2\n",
      );
    });

    it("escapes a percent sign, a carriage return and a line feed as GitHub's workflow commands require, in the test's name too", async () => {
      assert.equal(
        await annotations([fail("100%\nof\rit", "50% done\r\nmore")]),
        "::error::100%25%0Aof%0Dit: 50%25 done\n",
      );
    });

    it("writes nothing for a failing test marked `todo` or `skip`, which node does not fail the run for", async () => {
      const todo = fail("todo fail", "expected to fail");
      const skipped = fail("skipped fail", "never ran");
      Object.assign(todo.data, { todo: true });
      Object.assign(skipped.data, { skip: "not now" });
      assert.equal(
        await annotations([todo, skipped, fail("real", "it broke")]),
        "::error::real: it broke\n",
      );
    });
  });
});
