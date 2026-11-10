import assert from "node:assert/strict";
import { test } from "node:test";
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

test("a failing test is one ::error:: line with its name and the first line of its error; a pass, a skip and a parent of failing subtests print nothing", async () => {
  const pass = { type: "test:pass", data: { name: "fine", nesting: 0 } };
  assert.equal(
    await annotations([
      pass as Event,
      fail("child", "it broke\nand then more lines\n"),
      fail("parent", "1 subtest failed", "subtestsFailed"),
    ]),
    "::error::child: it broke\n",
  );
});

test("an assertion's message that ends in a colon carries its next non-empty line, which holds what differed", async () => {
  assert.equal(
    await annotations([
      fail("equal", "Expected values to be strictly equal:\n\n1 !== 2\n"),
    ]),
    "::error::equal: Expected values to be strictly equal: 1 !== 2\n",
  );
});

test("percent, carriage return and line feed are escaped as GitHub's workflow commands require, in the name too", async () => {
  assert.equal(
    await annotations([fail("100%\nof\rit", "50% done\r\nmore")]),
    "::error::100%25%0Aof%0Dit: 50%25 done\n",
  );
});

test("a failing test marked todo or skip is not annotated, because node does not fail the run for it", async () => {
  const todo = fail("todo fail", "expected to fail");
  const skipped = fail("skipped fail", "never ran");
  Object.assign(todo.data, { todo: true });
  Object.assign(skipped.data, { skip: "not now" });
  assert.equal(
    await annotations([todo, skipped, fail("real", "it broke")]),
    "::error::real: it broke\n",
  );
});
