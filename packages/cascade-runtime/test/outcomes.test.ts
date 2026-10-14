import assert from "node:assert/strict";
import { test } from "node:test";
import { checkedOutcome, startedOutcome } from "../src/outcomes.js";
import type { Checked } from "../src/tables.js";

const FEED = "https://example.org/feed.ttl";
const HELD = [
  { label: "RxNorm", versions: [{ iri: "urn:rxnorm-2" }] },
  { label: "CVX", versions: [{ iri: "urn:cvx-1" }] },
];
const none = { feed: FEED, kept: [], refused: [] };

test("what a check says reads as what happened, and never says a feed was not reached when it answered", () => {
  const cases: [string, Checked[], boolean, RegExp[], RegExp[]][] = [
    ["nothing newer", [none], false, [/^none newer$/], [/not reached/]],
    [
      "one kept",
      [{ ...none, kept: ["urn:rxnorm-2"] }],
      false,
      [/^kept 1 newer version \(RxNorm\)$/],
      [/none newer|package's tables/],
    ],
    [
      "two kept",
      [{ ...none, kept: ["urn:rxnorm-2", "urn:cvx-1"] }],
      false,
      [/kept 2 newer versions \(RxNorm, CVX\)/],
      [],
    ],
    [
      "the feed offline",
      [{ ...none, later: `${FEED} could not be read: fetch failed` }],
      false,
      [/^not reached; the package's tables are used$/],
      [/example\.org/, / in \d+ s/],
    ],
    [
      "the time ran out",
      [{ ...none, later: "The operation was aborted due to timeout" }],
      true,
      [/^not reached in 10 s; the package's tables are used$/],
      [/aborted/],
    ],
    [
      "a download failed after the feed answered",
      [{ ...none, later: "https://example.org/rx.ttl could not be read: x" }],
      false,
      [/a newer version could not be read now; tried again next start/],
      [/not reached|none newer|package's tables/],
    ],
    [
      "a download failed beside a kept version",
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
      "refused",
      [{ ...none, refused: [{ version: "urn:x", reason: "no" }] }],
      false,
      [/^none newer, 1 refused$/],
      [],
    ],
  ];
  for (const [what, checked, aborted, say, never] of cases) {
    const line = checkedOutcome(checked, HELD, aborted);
    for (const phrase of say) assert.match(line, phrase, what);
    for (const phrase of never) assert.doesNotMatch(line, phrase, what);
  }
});

test("what copying the tables in says is how many tables and how much, or that they were there", () => {
  assert.equal(startedOutcome(0, []), "already there");
  assert.equal(startedOutcome(219_400_000, HELD), "2 tables, 219 MB");
});
