import assert from "node:assert/strict";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import {
  arrival,
  joined,
  type MatcherRule,
  matcherRules,
} from "../src/matcher.js";
import { documentName } from "../src/names.js";
import { blank, iri, literal, type Term, type Triple } from "../src/rdf.js";
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

test("a rule list naming a query outside matcher/, by any path, giving one justification twice, or two table kinds for a rule, or a rule's row citing a table it does not read, refuses the run", async () => {
  const files = await vocabulary();
  const sameCode = await row("a", "SameCode", "matcher/same-code.rq");
  assert.equal((await matcherRules(new Graph(sameCode), files)).length, 1);
  const kindless: MatcherRule = {
    justification: JDG + "SameMappedCode",
    appliesTo: new Set(["Condition"]),
    query: "matcher/same-mapped-code.rq",
  };
  const rule: MatcherRule = { ...kindless, kind: `${REC}CodeMappings` };
  const version = "urn:example:mappings-2";
  const loaded = new Set([version]);
  const joins = (origin?: string): Map<string, Term> =>
    new Map<string, Term>([
      ["record", iri("urn:example:a")],
      ["other", iri("urn:example:b")],
      ...(origin === undefined ? [] : [["origin", iri(origin)] as const]),
    ]);
  assert.deepEqual(
    [...joined(rule, [joins(version)], loaded).values()],
    [loaded],
  );
  const refusals: (() => Promise<unknown>)[] = [
    async () => joined(rule, [joins()], loaded),
    async () => joined(rule, [joins("urn:example:mappings-1")], loaded),
    async () => joined(kindless, [joins(version)], new Set([""])),
  ];
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
    [
      ...sameCode,
      ...["VaccineGroups", "CodeNames"].map((kind): Triple => [
        blank("a"),
        iri(`${REC}tableKind`),
        iri(REC + kind),
      ]),
    ],
  ]) {
    refusals.push(() => matcherRules(new Graph(rows), files));
  }
  for (const refused of refusals) await assert.rejects(refused, Refusal);
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
