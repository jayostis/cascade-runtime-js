import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { PRONOUNS } from "cascade-runtime";
import {
  caseIds,
  loadCase,
  loadKey,
  reusesPreparedPod,
  type Case,
} from "../src/cases.js";
import { countsOf, instancesOf } from "../src/instances.js";
import { ARM_PARTS, versionOf } from "../src/prompts.js";
import type { BeyondVerdict, ItemVerdict } from "../src/results.js";
import { sessionInputsHash, splitSession } from "../src/sessions.js";

type Inputs = Parameters<typeof sessionInputsHash>[0];

/**
 * A session is not run again when a recorded one had the same inputs, and its inputs hash is how the harness tells.
 * What follows is what that hash and a prompt's version cover, since anything left out is a change that reruns nothing.
 */
describe("Reusing a session whose inputs are unchanged · sessionInputsHash(), versionOf(), reusesPreparedPod()", () => {
  describe("sessionInputsHash({ found, session, … })", () => {
    let hash: (over?: Partial<Inputs>) => string;
    let hashesBefore: string[];
    let hashesAfter: string[];

    before(async () => {
      const found = await loadCase("tamsin-vale");
      hash = (over = {}) =>
        sessionInputsHash({
          found,
          session: found.sessions[0]!,
          downloads: "d",
          arm: "pod",
          model: "m",
          effort: undefined,
          repeat: 1,
          pod: {},
          tools: ["Bash"],
          runner: "1",
          ...over,
        });
      const hashes = (it: Case) =>
        it.sessions.map((session) => hash({ found: it, session }));
      hashesBefore = hashes(found);
      const reworded = structuredClone(found);
      (reworded.sessions[1]!.questions[0] as { asks: string }).asks +=
        " Really?";
      hashesAfter = hashes(reworded);
    });

    it("returns the same hash for the same inputs", () => {
      assert.equal(hash(), hash());
    });

    it("changes for the session that asks a reworded question", () => {
      assert.notEqual(hashesAfter[1], hashesBefore[1]);
    });

    it("keeps the hash of a session that does not ask it", () => {
      assert.equal(hashesAfter[0], hashesBefore[0]);
    });

    it("changes with the tools a child is allowed", () => {
      assert.notEqual(hash({ tools: ["Bash", "Write"] }), hash());
    });

    it("changes with the runner's version", () => {
      assert.notEqual(hash({ runner: "2" }), hash());
    });

    it("changes with the downloads", () => {
      assert.notEqual(hash({ downloads: "other" }), hash());
    });

    it("changes with the pod's commits on the pod arm", () => {
      assert.notEqual(
        hash({ pod: { packages: { runtime: "abc1234" } } }),
        hash({ pod: {} }),
      );
    });

    it("keeps a records-arm session's hash when the pod's commits change", () => {
      assert.equal(
        hash({ arm: "records", pod: { packages: { runtime: "abc1234" } } }),
        hash({ arm: "records", pod: {} }),
      );
    });
  });

  describe("versionOf(arm, parts)", () => {
    it("changes when the arm's example changes", () => {
      assert.notEqual(
        versionOf("pod", {
          ...ARM_PARTS.pod,
          example: ARM_PARTS.pod.example + " ",
        }),
        versionOf("pod"),
      );
    });

    it("changes when the records arm's citing instructions change", () => {
      assert.notEqual(
        versionOf("records", { ...ARM_PARTS.records, cite: "changed" }),
        versionOf("records"),
      );
    });

    it("differs between the two arms", () => {
      assert.notEqual(versionOf("pod"), versionOf("records"));
    });

    it("changes with the pronouns a prompt is written with", () => {
      const first = versionOf("pod");
      const kept = PRONOUNS.her!;
      try {
        PRONOUNS.her = ["she", "Hers"];
        assert.notEqual(versionOf("pod"), first);
      } finally {
        PRONOUNS.her = kept;
      }
      assert.equal(versionOf("pod"), first, "the pronouns are put back");
    });
  });

  describe("reusesPreparedPod(kept, downloadsSha256, components, tables)", () => {
    const components = [{ repository: "r", commit: "c" }] as never;
    const kept = {
      downloadsSha256: "d",
      components,
      build: { seconds: 1, modelCalls: 0, tokens: 0, usd: 0 },
      tables: { id: "t", versions: ["v"] },
    } as never;

    it("returns true for a prepared pod of the same downloads, components and reference tables", () => {
      assert.equal(reusesPreparedPod(kept, "d", components, "t"), true);
    });

    it("returns false for a prepared pod with no build time recorded", () => {
      assert.equal(
        reusesPreparedPod(
          { ...(kept as object), build: undefined } as never,
          "d",
          components,
          "t",
        ),
        false,
      );
    });

    it("returns false for other downloads", () => {
      assert.equal(reusesPreparedPod(kept, "other", components, "t"), false);
    });

    it("returns false for other reference tables, or none recorded", () => {
      assert.equal(reusesPreparedPod(kept, "d", components, "newer"), false);
      // A pod built before it had tables is stale.
      assert.equal(
        reusesPreparedPod(
          { ...(kept as object), tables: undefined } as never,
          "d",
          components,
          "t",
        ),
        false,
      );
    });
  });
});

const call = (
  at: string,
  input: number,
  cacheCreation: number,
  cacheRead: number,
) => ({
  at,
  model: "claude-opus-5-5",
  input,
  cacheCreation,
  cacheRead,
  output: 100,
  toolCalls: [],
  usd: 0.01,
});

/**
 * A session's model calls are split at each hand-out, so a question's tokens and time stand apart from what the
 * session spent before its first question. On the records arm the files a session read before its first question are
 * read again, as cache, by every later call, and `recordsTokens` says how much of a question's cost that is.
 */
describe("Charging each question its own cost · splitSession()", () => {
  const calls = [
    call("2026-10-31T10:00:00.000Z", 5_000, 0, 0),
    call("2026-10-31T10:00:10.000Z", 10, 20_000, 5_000),
    call("2026-10-31T10:00:30.000Z", 10, 500, 25_000),
    call("2026-10-31T10:00:40.000Z", 10, 500, 25_500),
    call("2026-10-31T10:01:10.000Z", 10, 500, 26_000),
  ];
  const asked = [
    { question: "a", at: "2026-10-31T10:00:20.000Z" },
    { question: "b", at: "2026-10-31T10:01:00.000Z" },
  ];
  const ended = "2026-10-31T10:01:20.000Z";

  describe("splitSession(calls, asked, ended, arm)", () => {
    const split = splitSession(calls, asked, ended, "records");

    it("returns a part for each question, in the order they were handed out", () => {
      assert.deepEqual(Object.keys(split.questions), ["a", "b"]);
    });

    it("charges the calls before the first hand-out to the session, not to a question", () => {
      assert.equal(split.shared.calls, 2);
    });

    it("charges each later call to the question handed out last before it", () => {
      assert.equal(split.questions.a!.calls, 2);
      assert.equal(split.questions.b!.calls, 1);
    });

    it("times each question from its hand-out to the next, the last to the session's end", () => {
      assert.equal(split.questions.a!.seconds, 40);
      assert.equal(split.questions.b!.seconds, 20);
    });

    it("charges every token of the session once, across the session's part and the questions'", () => {
      const total = (part: { tokens: { total: number } }) => part.tokens.total;
      assert.equal(
        total(split.shared) +
          total(split.questions.a!) +
          total(split.questions.b!),
        calls.reduce(
          (sum, it) =>
            sum + it.input + it.cacheCreation + it.cacheRead + it.output,
          0,
        ),
      );
    });
  });

  describe('splitSession(…, "records")', () => {
    const split = splitSession(calls, asked, ended, "records");

    it("returns as the records' context what the first call after the first hand-out holds beyond the session's first call", () => {
      assert.equal(split.shared.recordsContext, 25_510 - 5_000);
    });

    it("charges each question that context once for each of its calls", () => {
      assert.equal(split.questions.a!.recordsTokens, 2 * 20_510);
      assert.equal(split.questions.b!.recordsTokens, 20_510);
    });
  });

  describe('splitSession(…, "pod")', () => {
    it("returns no records' context", () => {
      assert.equal(
        splitSession(calls, asked, ended, "pod").shared.recordsContext,
        undefined,
      );
    });
  });
});

const item = (
  id: string,
  kind: "fact" | "trap" | "gap" | "absence",
  question: string,
) => ({ id, kind, question });
const grade = (
  judge: string,
  question: string,
  items: [string, ItemVerdict][],
  beyond: BeyondVerdict[],
) => ({
  subject: "s",
  question,
  judge,
  items: items.map(([id, verdict]) => ({
    id,
    verdict,
    items: [1],
    reason: "",
  })),
  beyond: beyond.map((verdict, at) => ({ item: at + 2, verdict, why: "" })),
  chains: [],
});

/**
 * An arm's count of a key item is the verdict its judges share; where they differ it is counted split, and a question
 * the arm never answered is counted unanswered, so both arms are counted out of the same total.
 */
describe("Counting what each arm found · countsOf(), instancesOf()", () => {
  describe("countsOf(items, grades, answered)", () => {
    // Questions a and b are answered and graded by two judges; c is answered and graded by none.
    const counts = countsOf(
      [
        item("F1", "fact", "a"),
        item("T1", "trap", "a"),
        item("G1", "gap", "b"),
        item("A1", "absence", "c"),
      ],
      [
        grade(
          "j1",
          "a",
          [
            ["F1", "found"],
            ["T1", "avoided"],
          ],
          ["fair", "speculative"],
        ),
        grade(
          "j2",
          "a",
          [
            ["F1", "partly"],
            ["T1", "avoided"],
          ],
          ["fair", "contradicted"],
        ),
        grade("j1", "b", [["G1", "found"]], []),
        grade("j2", "b", [["G1", "found"]], []),
      ],
      ["a", "b", "c"],
    );

    it("counts a key item by the verdict its judges share", () => {
      assert.deepEqual(counts.expected, {
        found: 1,
        partly: 0,
        missed: 0,
        split: 1,
        ungraded: 1,
        unanswered: 0,
        of: 3,
      });
    });

    it("counts a key item its judges grade differently as split", () => {
      assert.equal(counts.expected.split, 1);
    });

    it("counts the key items of an answered question no judge graded as ungraded", () => {
      assert.equal(counts.expected.ungraded, 1);
    });

    it("counts a key item that is a trap apart, out of the traps' own total", () => {
      assert.deepEqual(counts.traps, {
        avoided: 1,
        raised: 0,
        split: 0,
        ungraded: 0,
        unanswered: 0,
        of: 1,
      });
    });

    it("counts a point beyond the key by the verdict its judges share", () => {
      assert.equal(counts.beyond.fair, 1);
    });

    it("counts a point beyond the key its judges grade differently as split", () => {
      assert.deepEqual(counts.beyond, {
        fair: 1,
        trueNotPlanted: 0,
        speculative: 0,
        contradicted: 0,
        split: 1,
      });
    });
  });

  describe("given a question the arm never answered", () => {
    const answeredA = countsOf(
      [
        item("F1", "fact", "a"),
        item("F2", "fact", "b"),
        item("T1", "trap", "b"),
      ],
      [
        {
          subject: "s",
          question: "a",
          items: [{ id: "F1", verdict: "found", items: [1], reason: "" }],
          beyond: [],
        },
      ],
      ["a"],
    );

    it("counts that question's key items as unanswered, a trap among them too", () => {
      assert.equal(answeredA.expected.unanswered, 1);
      assert.equal(answeredA.traps.unanswered, 1);
    });

    it("keeps them in the total", () => {
      assert.deepEqual(answeredA.expected, {
        found: 1,
        partly: 0,
        missed: 0,
        split: 0,
        ungraded: 0,
        unanswered: 1,
        of: 2,
      });
      assert.deepEqual(answeredA.traps, {
        avoided: 0,
        raised: 0,
        split: 0,
        ungraded: 0,
        unanswered: 1,
        of: 1,
      });
    });
  });

  describe("instancesOf(jobs, grades, checks, answers, keys)", () => {
    const job = (id: string, extra: Record<string, unknown>) =>
      ({
        id,
        case: "tamsin-vale",
        model: "claude-opus-5-5",
        repeat: 1,
        status: "done",
        estimate: { tokens: 0, usd: 0 },
        ...extra,
      }) as never;
    const judge = (id: string, usd: number | null) =>
      job(id, {
        role: "judge",
        instance: "tamsin-vale.opus-5-5.r1",
        stats: { tokens: { total: 10 }, cost: { usd } },
      });
    // The pod arm has no answers; the records arm answered question a only.
    const [instance] = instancesOf(
      [
        job("p", { role: "subject", arm: "pod" }),
        job("r", { role: "subject", arm: "records" }),
        judge("j1", 0.5),
        judge("j2", null),
      ],
      [],
      {},
      { r: { a: {} } },
      new Map([
        [
          "tamsin-vale",
          [
            { id: "F1", kind: "fact", question: "a" },
            { id: "F2", kind: "fact", question: "b" },
          ],
        ],
      ]) as never,
    );

    it("totals every key item of the case for each arm, whatever the arm answered", () => {
      assert.equal(instance!.arms.pod!.expected.of, 2);
      assert.equal(instance!.arms.records!.expected.of, 2);
    });

    it("counts as unanswered each key item of a question an arm has no answer to", () => {
      assert.equal(instance!.arms.pod!.expected.unanswered, 2);
      assert.equal(instance!.arms.records!.expected.unanswered, 1);
    });

    it("returns a judging cost of null where any judge's cost is null", () => {
      assert.equal(instance!.judging.usd, null);
    });
  });
});

describe("The cases in `cases/`, as checked in", () => {
  const cases = new Map<string, { asked: string[]; keyed: string[] }>();

  before(async () => {
    for (const id of await caseIds()) {
      const found = await loadCase(id);
      const { key } = await loadKey(id);
      cases.set(id, {
        asked: found.sessions.flatMap((it) => it.questions.map((q) => q.id)),
        keyed: key.items.map((it) => it.question),
      });
    }
  });

  describe("given every case", () => {
    it("asks each question once across its sessions", () => {
      for (const [id, { asked }] of cases)
        assert.equal(new Set(asked).size, asked.length, `${id} asks each once`);
    });

    it("asks the check-up question", () => {
      for (const [id, { asked }] of cases)
        assert.ok(
          asked.includes("checkup"),
          `${id} asks the check-up question`,
        );
    });

    it("holds a key item for every question it asks", () => {
      for (const [id, { asked, keyed }] of cases)
        for (const question of asked)
          assert.ok(
            keyed.includes(question),
            `${id}: the key has an item for ${question}`,
          );
    });

    it("holds no key item for a question it does not ask", () => {
      for (const [id, { asked, keyed }] of cases)
        for (const question of keyed)
          assert.ok(
            asked.includes(question),
            `${id}: a key item is for ${question}, which it does not ask`,
          );
    });
  });

  describe("given `tamsin-vale`", () => {
    it("asks four to six questions", () => {
      const { asked } = cases.get("tamsin-vale")!;
      assert.ok(asked.length >= 4 && asked.length <= 6, `${asked.length}`);
    });
  });
});
