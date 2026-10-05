import assert from "node:assert/strict";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import { arrival, matcherRules } from "../src/matcher.js";
import { documentName } from "../src/names.js";
import { blank, iri, literal, type Triple } from "../src/rdf.js";
import { REC, Refusal } from "../src/step.js";
import { vocabulary } from "./vocabulary.js";

const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

async function row(
  name: string,
  justification: string,
  query: string,
  hashOf = query,
): Promise<Triple[]> {
  const files = await vocabulary();
  const bytes = await files.read(`queries/v1-draft/${hashOf}`);
  assert.ok(bytes, hashOf);
  const rule = blank(name);
  return [
    [rule, iri(TYPE), iri(`${REC}MatcherRule`)],
    [rule, iri(`${REC}justifiedAs`), iri(JDG + justification)],
    [rule, iri(`${REC}appliesTo`), literal("Condition")],
    [rule, iri(`${REC}query`), literal(query)],
    [rule, iri(`${REC}queryHash`), iri(await documentName(bytes))],
  ];
}

test("a rule list naming a query outside matcher/, by any path, or giving one justification twice refuses the run", async () => {
  const files = await vocabulary();
  const sameCode = await row("a", "SameCode", "matcher/same-code.rq");
  assert.equal((await matcherRules(new Graph(sameCode), files)).length, 1);
  for (const rows of [
    await row(
      "a",
      "SameCode",
      "matcher/../lenses/everyday.rq",
      "lenses/everyday.rq",
    ),
    await row(
      "a",
      "SameCode",
      "matcher/..\\lenses\\everyday.rq",
      "lenses/everyday.rq",
    ),
    [
      ...sameCode,
      ...(await row("b", "SameCode", "matcher/same-code-and-date.rq")),
    ],
    sameCode.filter(([, predicate]) => predicate.value !== `${REC}queryHash`),
  ]) {
    await assert.rejects(matcherRules(new Graph(rows), files), Refusal);
  }
});

test("a first revision's time with no zone, or no time at all, refuses the run rather than aborting the replay", () => {
  assert.deepEqual(arrival("2026-05-02T09:00:00.50+01:00"), [
    "2026-05-02T08:00:00",
    "5",
  ]);
  for (const moment of ["2026-05-02T09:00:00", "tomorrow"]) {
    assert.throws(() => arrival(moment), Refusal, moment);
  }
});
