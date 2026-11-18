import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bridgeRecord, pinOfRecord } from "../src/node/bridge-record.js";

const repository = "https://example.test/bridge";
const cache = "/cache/cascade-bridge-rs";

/**
 * The Bridge package a run from a checkout uses · findBridgePackage()
 *
 * `npm run bridge` records the build the resolver picked, whichever source it came from, and the offline tests pin to it.
 */
describe("The Bridge package a run from a checkout uses · findBridgePackage()", () => {
  it("records a sibling checkout's build with its folder, so a developer with no cached release is pinned to it", () => {
    const record = bridgeRecord(
      {
        source: "sibling",
        folder: "/dev/cascade-bridge-rs/package/dist",
        commit: "a".repeat(40),
        dirty: true,
      },
      repository,
    );
    assert.deepEqual(record, {
      repository,
      source: "sibling",
      commit: "a".repeat(40),
      folder: "/dev/cascade-bridge-rs/package/dist",
    });
    const pinned = pinOfRecord(record, cache, () => true);
    assert.equal(pinned.pin, undefined);
  });

  it("stops, saying to run npm run bridge, when a sibling's build is gone", () => {
    assert.throws(
      () =>
        pinOfRecord(
          {
            repository,
            source: "sibling",
            commit: "a",
            folder: "/gone/dist",
          },
          cache,
          () => false,
        ),
      /npm run bridge/,
    );
  });

  it("pins a release to its commit, which must be in the cache", () => {
    const record = bridgeRecord(
      { source: "release", folder: "/x", commit: "b".repeat(40), dirty: false },
      repository,
    );
    assert.deepEqual(record, {
      repository,
      source: "release",
      commit: "b".repeat(40),
    });
    assert.equal(
      pinOfRecord(record, cache, () => true).pin,
      `${repository}@${"b".repeat(40)}`,
    );
    assert.throws(() => pinOfRecord(record, cache, () => false), /not in/);
  });

  it("stops when nothing is recorded", () => {
    assert.throws(() => pinOfRecord(undefined, cache), /none is recorded/);
  });
});
