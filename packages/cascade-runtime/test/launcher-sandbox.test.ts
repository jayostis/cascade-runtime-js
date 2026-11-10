import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConnectionFailure } from "cascade-runtime";
import {
  failureToReport,
  LauncherUnavailable,
  launcherAnswers,
} from "./launcher-sandbox.js";

const BASE = "https://launch.example/v/r4/sim/abc/fhir";

const gaveUp = new ConnectionFailure(
  "retries-exhausted",
  "https://launch.example could not be reached for Patient",
  { origin: "https://launch.example", askedFor: "Patient" },
);

/** A stand-in for `launcherAnswers` that resolves to `answer` and counts how often it is asked. */
function asking(answer: boolean) {
  const asked = { times: 0 };
  return {
    asked,
    answers: async () => {
      asked.times += 1;
      return answer;
    },
  };
}

/** A `fetch` that responds to every request with `status`, noting the URLs asked for. */
function responding(status: number, urls: string[] = []): typeof fetch {
  return async (input) => {
    urls.push(String(input));
    return new Response("{}", { status });
  };
}

/**
 * The launcher check pulls from the launcher over the network every night, so a red run can be the launcher's doing
 * and not the runtime's. These two helpers of the check decide which failure a red run reports.
 */
describe("The launcher check, when the launcher itself is down", () => {
  describe("failureToReport(error, launcherAnswers)", () => {
    it("returns `LauncherUnavailable`, quoting the runtime's failure, when the runtime gave up after its retries and the launcher responds to nothing either", async () => {
      const unreachable = asking(false);
      const reported = await failureToReport(gaveUp, unreachable.answers);
      assert.ok(reported instanceof LauncherUnavailable);
      assert.match(reported.message, /launcher/i);
      assert.match(reported.message, /not the runtime/i);
      assert.ok(reported.message.includes(gaveUp.message));
      assert.equal(unreachable.asked.times, 1, "gave up with no status");

      const failing = asking(false);
      const answered503 = await failureToReport(
        new ConnectionFailure(
          "retries-exhausted",
          "https://launch.example answered 503 to every try for Patient",
          {
            origin: "https://launch.example",
            status: 503,
            askedFor: "Patient",
          },
        ),
        failing.answers,
      );
      assert.ok(answered503 instanceof LauncherUnavailable, "gave up on 503s");
      assert.equal(failing.asked.times, 1);
    });
  });

  describe("launcherAnswers(fhirBase)", () => {
    it("returns false for a 500 or a 503", async () => {
      for (const status of [500, 503])
        assert.equal(
          await launcherAnswers(BASE, responding(status)),
          false,
          `${status}`,
        );
    });

    it("returns false when the request fails, or is not back in the time allowed", async () => {
      const failing: typeof fetch = async () => {
        throw new TypeError("fetch failed");
      };
      assert.equal(await launcherAnswers(BASE, failing), false, "fails");

      const hanging: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          ),
        );
      assert.equal(await launcherAnswers(BASE, hanging, 20), false, "late");
    });
  });
});

describe("The launcher check, when the launcher responds", () => {
  describe("failureToReport(error, launcherAnswers)", () => {
    it("returns the runtime's own failure when the runtime gave up after its retries", async () => {
      const up = asking(true);
      assert.equal(await failureToReport(gaveUp, up.answers), gaveUp);
      assert.equal(up.asked.times, 1);
    });
  });

  describe("launcherAnswers(fhirBase)", () => {
    it("asks for the launcher's `metadata`", async () => {
      const urls: string[] = [];
      await launcherAnswers(BASE, responding(200, urls));
      assert.deepEqual(urls, [`${BASE}/metadata`]);
    });

    it("returns true for a response below 500, a 429 among them", async () => {
      for (const status of [200, 404, 429])
        assert.equal(
          await launcherAnswers(BASE, responding(status)),
          true,
          `${status}`,
        );
    });
  });
});

describe("The launcher check, when the runtime's failure is not one the launcher's silence explains", () => {
  describe("failureToReport(error, launcherAnswers)", () => {
    it("returns the runtime's own failure, without asking the launcher, when the runtime gave up on 429s", async () => {
      const rateLimited = new ConnectionFailure(
        "retries-exhausted",
        "https://launch.example answered 429 to every try for Patient",
        {
          origin: "https://launch.example",
          status: 429,
          askedFor: "Patient",
        },
      );
      const unasked = asking(false);
      assert.equal(
        await failureToReport(rateLimited, unasked.answers),
        rateLimited,
      );
      assert.equal(unasked.asked.times, 0);
    });

    it("returns any other failure as it was, without asking the launcher", async () => {
      const others: [string, unknown][] = [
        ["unauthorized", new ConnectionFailure("unauthorized", "answered 401")],
        [
          "hospital-error",
          new ConnectionFailure("hospital-error", "not a JSON object"),
        ],
        [
          "sign-in-unavailable",
          new ConnectionFailure("sign-in-unavailable", "no redirect URI"),
        ],
        ["a plain Error", new Error("the runtime is broken")],
        ["a string", "not an error"],
      ];
      for (const [what, error] of others) {
        const unasked = asking(false);
        assert.equal(
          await failureToReport(error, unasked.answers),
          error,
          what,
        );
        assert.equal(unasked.asked.times, 0, what);
      }
    });
  });
});
