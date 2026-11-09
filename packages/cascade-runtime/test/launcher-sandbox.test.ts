import assert from "node:assert/strict";
import { test } from "node:test";
import { ConnectionFailure } from "cascade-runtime";
import {
  rethrowing,
  SandboxUnavailable,
  sandboxAnswers,
} from "./launcher-sandbox.js";

const BASE = "https://launch.example/v/r4/sim/abc/fhir";

/** What `rethrowing` threw, and whether it asked the sandbox. */
async function threw(error: unknown, answering: boolean) {
  let asked = 0;
  const thrown = await rethrowing(error, async () => {
    asked += 1;
    return answering;
  }).then(
    () => assert.fail("it did not throw"),
    (caught: unknown) => caught,
  );
  return { thrown, asked };
}

const gaveUp = new ConnectionFailure(
  "retries-exhausted",
  "https://launch.example could not be reached for Patient",
  { origin: "https://launch.example", resourceType: "Patient" },
);

test("a run that gave up after its retries is the sandbox's when the sandbox answers nothing either, and the runtime's when it answers", async () => {
  const down = await threw(gaveUp, false);
  assert.ok(down.thrown instanceof SandboxUnavailable);
  assert.match(down.thrown.message, /sandbox/i);
  assert.match(down.thrown.message, /not the runtime/i);
  assert.ok(down.thrown.message.includes(gaveUp.message));
  assert.equal(down.asked, 1);

  const up = await threw(gaveUp, true);
  assert.equal(up.thrown, gaveUp);
  assert.equal(up.asked, 1);
});

test("a failure that is not the runtime giving up after its retries stays as it was, and the sandbox is not asked", async () => {
  for (const error of [
    new ConnectionFailure("unauthorized", "answered 401"),
    new ConnectionFailure("hospital-error", "not a JSON object"),
    new ConnectionFailure("sign-in-unavailable", "no redirect URI"),
    new Error("the runtime is broken"),
    "not an error",
  ]) {
    const { thrown, asked } = await threw(error, false);
    assert.equal(thrown, error);
    assert.equal(asked, 0);
  }
});

test("the sandbox answers when its metadata is answered below 429 and 5xx, and not when it is slow, unreachable or failing", async () => {
  const seen: string[] = [];
  const answering =
    (status: number): typeof fetch =>
    async (input) => {
      seen.push(String(input));
      return new Response("{}", { status });
    };
  assert.equal(await sandboxAnswers(BASE, answering(200)), true);
  assert.equal(await sandboxAnswers(BASE, answering(404)), true);
  assert.deepEqual(seen, [`${BASE}/metadata`, `${BASE}/metadata`]);
  for (const status of [429, 500, 503])
    assert.equal(
      await sandboxAnswers(BASE, answering(status)),
      false,
      `${status}`,
    );

  const refusing: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(await sandboxAnswers(BASE, refusing), false);

  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      ),
    );
  assert.equal(await sandboxAnswers(BASE, hanging, 20), false);
});
