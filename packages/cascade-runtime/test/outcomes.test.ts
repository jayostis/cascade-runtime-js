import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkedOutcome, startedOutcome } from "../src/outcomes.js";
import type { Checked } from "../src/tables.js";

const FEED = "https://example.org/feed.ttl";
const HELD = [
  { label: "RxNorm", versions: [{ iri: "urn:rxnorm-2" }] },
  { label: "CVX", versions: [{ iri: "urn:cvx-1" }] },
];
const none = { feed: FEED, kept: [], refused: [] };

describe("checkedOutcome", () => {
  const cases: [string, Checked[], boolean, RegExp[], RegExp[]][] = [
    [
      "says none newer when nothing is",
      [none],
      false,
      [/^none newer$/],
      [/not reached/],
    ],
    [
      "says how many newer versions it kept, and of what",
      [{ ...none, kept: ["urn:rxnorm-2"] }],
      false,
      [/^kept 1 newer version \(RxNorm\)$/],
      [/none newer|package's tables/],
    ],
    [
      "pluralises two kept, naming both",
      [{ ...none, kept: ["urn:rxnorm-2", "urn:cvx-1"] }],
      false,
      [/kept 2 newer versions \(RxNorm, CVX\)/],
      [],
    ],
    [
      "says the feed was not reached, and the tables are used, when it is offline",
      [{ ...none, later: `${FEED} could not be read: fetch failed` }],
      false,
      [/^not reached; the package's tables are used$/],
      [/example\.org/, / in \d+ s/],
    ],
    [
      "says how long it waited when the time ran out",
      [{ ...none, later: "The operation was aborted due to timeout" }],
      true,
      [/^not reached in 10 s; the package's tables are used$/],
      [/aborted/],
    ],
    [
      "does not say the feed was not reached when a download failed after it answered",
      [{ ...none, later: "https://example.org/rx.ttl could not be read: x" }],
      false,
      [/a newer version could not be read now; tried again next start/],
      [/not reached|none newer|package's tables/],
    ],
    [
      "says a download failed beside a version it kept",
      [
        {
          ...none,
          kept: ["urn:cvx-1"],
          later: "https://example.org/rx.ttl answered 500",
        },
      ],
      false,
      [/kept 1 newer version \(CVX\).*could not be read now/],
      [/package's tables/],
    ],
    [
      "counts the versions it refused",
      [{ ...none, refused: [{ version: "urn:x", reason: "no" }] }],
      false,
      [/^none newer, 1 refused$/],
      [],
    ],
  ];

  for (const [what, checked, aborted, say, never] of cases)
    it(what, () => {
      const line = checkedOutcome(checked, HELD, aborted);
      for (const phrase of say) assert.match(line, phrase);
      for (const phrase of never) assert.doesNotMatch(line, phrase);
    });
});

describe("startedOutcome", () => {
  it("says the tables were already there when none was copied", () => {
    assert.equal(startedOutcome(0, []), "already there");
  });

  it("says how many tables were copied and how much", () => {
    assert.equal(startedOutcome(219_400_000, HELD), "2 tables, 219 MB");
  });
});
