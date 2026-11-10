import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The public route is `tablesBeside(pods, phase)`, which copies about 200 MB and reads the feeds over the network before it
// says either line.
import { checkedOutcome, startedOutcome } from "../src/outcomes.js";
import { CHECK_ON_OPEN_MS, type Checked } from "../src/tables.js";

const FEED = "https://example.org/feed.ttl";
const HELD = [
  { label: "RxNorm", versions: [{ iri: "urn:rxnorm-2" }] },
  { label: "CVX", versions: [{ iri: "urn:cvx-1" }] },
];
const none = { feed: FEED, kept: [], refused: [] };
const checkedLine = (checked: Checked[], aborted = false) =>
  checkedOutcome(checked, HELD, aborted);
const SECONDS = CHECK_ON_OPEN_MS / 1000;

describe("Keeping reference tables up to date · tablesBeside(), tables.check()", () => {
  describe("when the copy of the package's tables is reported", () => {
    it("says `already there` when nothing was copied", () => {
      assert.equal(startedOutcome(0, []), "already there");
    });

    it("says how many tables were copied and how many megabytes", () => {
      assert.equal(startedOutcome(219_400_000, HELD), "2 tables, 219 MB");
    });
  });

  describe("when the check for newer tables is reported", () => {
    it("says `none newer` when the feed answered and listed nothing newer", () => {
      assert.equal(checkedLine([none]), "none newer");
    });

    it("says how many newer versions were kept, and of which tables", () => {
      assert.equal(
        checkedLine([{ ...none, kept: ["urn:rxnorm-2"] }]),
        "kept 1 newer version (RxNorm)",
        "one kept",
      );
      assert.equal(
        checkedLine([{ ...none, kept: ["urn:rxnorm-2", "urn:cvx-1"] }]),
        "kept 2 newer versions (RxNorm, CVX)",
        "two kept",
      );
    });

    it("says `not reached`, and that the package's tables are used, when the feed did not answer", () => {
      assert.equal(
        checkedLine([
          { ...none, later: `${FEED} could not be read: fetch failed` },
        ]),
        "not reached; the package's tables are used",
      );
    });

    it("says `not reached` with the seconds it waited when the check's time ran out", () => {
      assert.equal(
        checkedLine(
          [{ ...none, later: "The operation was aborted due to timeout" }],
          true,
        ),
        `not reached in ${SECONDS} s; the package's tables are used`,
      );
    });

    it("says that a newer version could not be read now, and never `not reached`, when the feed answered and a download failed", () => {
      const failed =
        "a newer version could not be read now; tried again next start";
      assert.equal(
        checkedLine([
          { ...none, later: "https://example.org/rx.ttl could not be read: x" },
        ]),
        failed,
        "a download that failed",
      );
      assert.equal(
        checkedLine([
          {
            ...none,
            kept: ["urn:cvx-1"],
            later: "https://example.org/rx.ttl answered 500",
          },
        ]),
        `kept 1 newer version (CVX), ${failed}`,
        "beside a kept version",
      );
    });

    it("counts the versions it refused", () => {
      assert.equal(
        checkedLine([
          { ...none, refused: [{ version: "urn:x", reason: "no" }] },
        ]),
        "none newer, 1 refused",
      );
    });
  });
});
