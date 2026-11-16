import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  changesIn,
  connect,
  findChanges,
  loopbackSignIn,
  openPod,
  type Pod,
  pull,
  serverReport,
} from "cascade-runtime";
import { cascadeRuntime } from "cascade-runtime/vite";
import { kitStory, replayKit } from "cascade-runtime/fixtures";
import { podReads } from "cascade-runtime/tools/node";
import { popupSignIn } from "../src/browser/sign-in.js";
import { answersToPublish, samplesToPublish } from "../src/node/published.js";
import "./offline.js";

/** The message of what a call throws or rejects with, an async call's refusal and a sync call's alike. */
const refusedWith = async (call: () => unknown): Promise<string> => {
  try {
    await call();
  } catch (error) {
    assert.ok(error instanceof TypeError, String(error));
    return error.message;
  }
  return assert.fail("the call took the option");
};

describe("Refusing an option a call does not know · import(), openPod(), connect(), pull(), serverReport(), findChanges(), samplesToPublish()", () => {
  let pod: Pod;

  before(async () => {
    pod = await openPod();
  });

  after(async () => {
    await pod.close();
  });

  describe("given a key no call takes", () => {
    const calls: [string, (options: never) => unknown][] = [
      ["openPod", (options) => openPod(undefined, options)],
      ["pod.import", (options) => pod.import("x", options)],
      ["pod.connect", (options) => pod.connect({}, options)],
      ["pod.enter", (options) => pod.enter("", options)],
      ["pod.ask", (options) => pod.ask("pod/My active allergies", options)],
      ["connect", (options) => connect({} as never, {} as never, options)],
      ["serverReport", (options) => serverReport({} as never, options)],
      ["pull", (options) => pull({} as never, {} as never, options)],
      ["loopbackSignIn", (options) => loopbackSignIn(options)],
      ["popupSignIn", (options) => popupSignIn(options)],
      ["findChanges", (options) => findChanges(pod, options)],
      ["changesIn", (options) => changesIn([], [], options)],
      ["podReads", (options) => podReads({} as never, options)],
      ["cascadeRuntime", (options) => cascadeRuntime(options)],
      ["replayKit", (options) => replayKit("alex-rivera", "x", options)],
      ["kitStory", (options) => kitStory("alex-rivera", options)],
      ["samplesToPublish", (options) => samplesToPublish(options)],
      [
        "answersToPublish",
        (options) => answersToPublish({} as never, new Map(), options),
      ],
    ];

    for (const [name, call] of calls)
      it(`throws from \`${name}\`, naming the call and the key`, async () => {
        const message = await refusedWith(() =>
          call({ stale: true } as never),
        );
        assert.ok(message.includes(`${name} does not take`), message);
        assert.ok(message.includes("stale"), message);
      });
  });

  describe("given a key a call took under another name", () => {
    it("names the new key and the build that renamed it, for `aboutSubject` and `claim` of `pod.import()`", async () => {
      for (const old of ["aboutSubject", "claim"])
        assert.equal(
          await refusedWith(() => pod.import("x", { [old]: true } as never)),
          `pod.import does not take ${old}: it was renamed claimProfiles in build-6979c2fc.`,
        );
    });

    it("names `lookups` and the build that renamed it, for `look` of `samplesToPublish()` and `answersToPublish()`", async () => {
      for (const call of [
        (options: never) => samplesToPublish(options),
        (options: never) => answersToPublish({} as never, new Map(), options),
      ])
        assert.match(
          await refusedWith(() => call({ look: () => undefined } as never)),
          /does not take look: it was renamed lookups in build-6979c2fc.$/,
        );
    });

    it("says only that it does not take the key, for a name another call renamed", async () => {
      assert.equal(
        await refusedWith(() => pod.ask("pod/My active allergies", { claim: true } as never)),
        "pod.ask does not take claim: it takes lens.",
      );
    });
  });

  describe("given several keys the call does not take", () => {
    it("names each of them, and the keys the call takes", async () => {
      assert.equal(
        await refusedWith(() =>
          pod.import("x", { aboutSubject: true, bogus: 1 } as never),
        ),
        "pod.import does not take aboutSubject: it was renamed claimProfiles in build-6979c2fc. pod.import does not take bogus: it takes claimProfiles, match, onProgress.",
      );
    });
  });

  describe("given something that is not an options object", () => {
    it("throws, naming the call, for a string, a number, a boolean, an array and null", async () => {
      for (const given of ["match", 1, true, [], null])
        assert.match(
          await refusedWith(() => pod.enter("", given as never)),
          /^pod\.enter takes an options object/,
        );
    });
  });

  describe("given the keys a call takes, or none", () => {
    it("takes `pod.ask()` with `lens`, with none and with an empty object", async () => {
      for (const options of [{ lens: "export" }, undefined, {}])
        await pod.ask("pod/My active allergies", options as never);
    });
  });
});
