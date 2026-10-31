import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/plan.js";
import { resolvePins } from "../src/pinned.js";

test("a pinned run pins the runtime and only the repositories the pod arm depends on, each at a commit", async () => {
  const { pins } = await loadConfig("baseline-pre-w3");
  assert.deepEqual(resolvePins(pins!), {
    "cascade-vocabulary": "f1ab8ed",
    "cascade-bridge-adapter-fhir-r4": "f0c1bc6",
    "cascade-bridge-adapter-ccda": "0429600",
    "cascade-bridge-rs": "b4047ec",
    "cascade-bridge-spec": "cefce33",
    "cascade-runtime-js": "bdd39e5",
  });
  assert.throws(
    () => resolvePins({ "cascade-vocabulary": "f1ab8ed" }),
    /pins cascade-runtime-js/,
  );
  assert.throws(
    () =>
      resolvePins({
        "cascade-runtime-js": "bdd39e5",
        "cascade-site": "abc1234",
      }),
    /cascade-site is no repository a run pins/,
  );
});
