import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

describe("rethrowing", () => {
  describe("given a run that gave up after its retries", () => {
    it("throws the sandbox's failure when the sandbox answers nothing either", async () => {
      const down = await threw(gaveUp, false);
      assert.ok(down.thrown instanceof SandboxUnavailable);
      assert.match(down.thrown.message, /sandbox/i);
      assert.match(down.thrown.message, /not the runtime/i);
      assert.ok(down.thrown.message.includes(gaveUp.message));
      assert.equal(down.asked, 1);
    });

    it("throws the runtime's failure when the sandbox answers", async () => {
      const up = await threw(gaveUp, true);
      assert.equal(up.thrown, gaveUp);
      assert.equal(up.asked, 1);
    });
  });

  describe("given a run that gave up on a status", () => {
    it("throws the runtime's failure on 429s without asking the sandbox", async () => {
      const rateLimited = new ConnectionFailure(
        "retries-exhausted",
        "https://launch.example answered 429 to every try for Patient",
        {
          origin: "https://launch.example",
          status: 429,
          resourceType: "Patient",
        },
      );
      const limited = await threw(rateLimited, false);
      assert.equal(limited.thrown, rateLimited);
      assert.equal(limited.asked, 0);
    });

    it("throws the sandbox's failure on 5xx", async () => {
      const failing = new ConnectionFailure(
        "retries-exhausted",
        "https://launch.example answered 503 to every try for Patient",
        {
          origin: "https://launch.example",
          status: 503,
          resourceType: "Patient",
        },
      );
      const down = await threw(failing, false);
      assert.ok(down.thrown instanceof SandboxUnavailable);
      assert.equal(down.asked, 1);
    });
  });

  it("leaves any other failure as it was, without asking the sandbox", async () => {
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
});

describe("sandboxAnswers", () => {
  const answering =
    (status: number, seen: string[] = []): typeof fetch =>
    async (input) => {
      seen.push(String(input));
      return new Response("{}", { status });
    };

  it("asks the sandbox's metadata and is true when it answers 200 or 404", async () => {
    const seen: string[] = [];
    assert.equal(await sandboxAnswers(BASE, answering(200, seen)), true);
    assert.equal(await sandboxAnswers(BASE, answering(404, seen)), true);
    assert.deepEqual(seen, [`${BASE}/metadata`, `${BASE}/metadata`]);
  });

  it("is true when it answers 429", async () => {
    assert.equal(await sandboxAnswers(BASE, answering(429)), true);
  });

  it("is false when it fails with 5xx", async () => {
    for (const status of [500, 503])
      assert.equal(
        await sandboxAnswers(BASE, answering(status)),
        false,
        `${status}`,
      );
  });

  it("is false when it is unreachable", async () => {
    const refusing: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal(await sandboxAnswers(BASE, refusing), false);
  });

  it("is false when it is slow", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        ),
      );
    assert.equal(await sandboxAnswers(BASE, hanging, 20), false);
  });
});
