import assert from "node:assert/strict";
import { test } from "node:test";
import { ConnectionFailure } from "cascade-runtime";
import {
  failureToReport,
  LauncherUnavailable,
  launcherAnswers,
} from "./launcher-sandbox.js";

const BASE = "https://launch.example/v/r4/sim/abc/fhir";

/** What `failureToReport` gave, and how many times it asked the launcher. */
async function reportedFor(error: unknown, answering: boolean) {
  let asked = 0;
  const reported = await failureToReport(error, async () => {
    asked += 1;
    return answering;
  });
  return { reported, asked };
}

const gaveUp = new ConnectionFailure(
  "retries-exhausted",
  "https://launch.example could not be reached for Patient",
  { origin: "https://launch.example", resourceType: "Patient" },
);

test("a run that gave up after its retries is the sandbox's when the sandbox answers nothing either, and the runtime's when it answers", async () => {
  const down = await reportedFor(gaveUp, false);
  assert.ok(down.reported instanceof LauncherUnavailable);
  assert.match(down.reported.message, /sandbox/i);
  assert.match(down.reported.message, /not the runtime/i);
  assert.ok(down.reported.message.includes(gaveUp.message));
  assert.equal(down.asked, 1);

  const up = await reportedFor(gaveUp, true);
  assert.equal(up.reported, gaveUp);
  assert.equal(up.asked, 1);
});

test("a run that gave up on 429s is the runtime's, and the sandbox is not asked, while one that gave up on 5xx is the sandbox's", async () => {
  const rateLimited = new ConnectionFailure(
    "retries-exhausted",
    "https://launch.example answered 429 to every try for Patient",
    { origin: "https://launch.example", status: 429, resourceType: "Patient" },
  );
  const limited = await reportedFor(rateLimited, false);
  assert.equal(limited.reported, rateLimited);
  assert.equal(limited.asked, 0);

  const failing = new ConnectionFailure(
    "retries-exhausted",
    "https://launch.example answered 503 to every try for Patient",
    { origin: "https://launch.example", status: 503, resourceType: "Patient" },
  );
  const down = await reportedFor(failing, false);
  assert.ok(down.reported instanceof LauncherUnavailable);
  assert.equal(down.asked, 1);
});

test("a failure that is not the runtime giving up after its retries stays as it was, and the sandbox is not asked", async () => {
  for (const error of [
    new ConnectionFailure("unauthorized", "answered 401"),
    new ConnectionFailure("hospital-error", "not a JSON object"),
    new ConnectionFailure("sign-in-unavailable", "no redirect URI"),
    new Error("the runtime is broken"),
    "not an error",
  ]) {
    const { reported, asked } = await reportedFor(error, false);
    assert.equal(reported, error);
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
  assert.equal(await launcherAnswers(BASE, answering(200)), true);
  assert.equal(await launcherAnswers(BASE, answering(404)), true);
  assert.deepEqual(seen, [`${BASE}/metadata`, `${BASE}/metadata`]);
  assert.equal(await launcherAnswers(BASE, answering(429)), true);
  for (const status of [500, 503])
    assert.equal(
      await launcherAnswers(BASE, answering(status)),
      false,
      `${status}`,
    );

  const refusing: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(await launcherAnswers(BASE, refusing), false);

  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      ),
    );
  assert.equal(await launcherAnswers(BASE, hanging, 20), false);
});
