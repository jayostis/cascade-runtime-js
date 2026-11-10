import { KeptBuild } from "../src/incremental.js";

/**
 * Counts the steps a replay with `build.verify` rebuilt in part: the pod calls `KeptBuild.verify` once after each. The
 * count is a number and not `node:test`'s `mock.method`, which keeps every call's arguments, here a whole build of the pod
 * each, for as long as the mock lives. One replay at a time may count. Call `stop()` when the replays are done.
 */
export function countRebuildsInPart(): {
  count(): number;
  stop(): void;
} {
  const original = KeptBuild.prototype.verify;
  let calls = 0;
  KeptBuild.prototype.verify = function (this: KeptBuild, whole) {
    calls += 1;
    return original.call(this, whole);
  };
  return {
    count: () => calls,
    stop: () => {
      KeptBuild.prototype.verify = original;
    },
  };
}
