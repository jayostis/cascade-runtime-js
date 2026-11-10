import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { Graph } from "../src/graph.js";
import {
  type MatcherRule,
  matcherRules,
  originsJoining,
} from "../src/matcher.js";
import { documentName } from "../src/names.js";
import { blank, iri, literal, type Term, type Triple } from "../src/rdf.js";
import { CASCADE, Refusal } from "../src/step.js";
import { vocabulary } from "./vocabulary.js";

const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** The check an error is a `Refusal` whose sentence matches. */
const refusal = (pattern: RegExp) => (error: unknown) => {
  assert.ok(error instanceof Refusal, String(error));
  assert.match(error.message, pattern);
  return true;
};

/** A row of the rule list: the comparison it names by its path, and the hash of the file `hashOf` names. */
async function row(
  name: string,
  justification: string,
  query: string,
  hashOf = query,
): Promise<Triple[]> {
  const files = await vocabulary();
  const bytes = await files.read(`queries/${hashOf}`);
  assert.ok(bytes, hashOf);
  const rule = blank(name);
  return [
    [rule, iri(TYPE), iri(`${CASCADE}RuleListRow`)],
    [rule, iri(`${CASCADE}matcherRule`), iri(`${CASCADE}${justification}Rule`)],
    [rule, iri(`${CASCADE}justifiedAs`), iri(CASCADE + justification)],
    [
      rule,
      iri(`${CASCADE}appliesToClass`),
      iri(`${CASCADE}ProblemOrDiagnosis`),
    ],
    [rule, iri(`${CASCADE}queryPath`), literal(query)],
    [rule, iri(`${CASCADE}queryHash`), iri(await documentName(bytes))],
  ];
}

/**
 * The matcher's rules arrive as a table, the rule list: each row names a comparison, a query the vocabulary ships under
 * `queries/matcher/`, and that query's hash. Before a run the matcher checks every row, and refuses the run sooner than
 * run a query the vocabulary did not ship.
 * @rule runtime/matcher.feature M5
 * @rule runtime/matcher.feature M11
 */
describe("Refusing a rule list a run cannot trust · matcherRules(), originsJoining()", () => {
  describe("matcherRules(rows, vocabulary)", () => {
    let files: Awaited<ReturnType<typeof vocabulary>>;
    let sameCode: Triple[];

    before(async () => {
      files = await vocabulary();
      sameCode = await row("a", "SameCode", "matcher/same-code.rq");
    });

    it("returns a rule for a row that names a query under `matcher/` and its hash", async () => {
      assert.equal((await matcherRules(new Graph(sameCode), files)).length, 1);
    });

    it("throws Refusal for a query path that leaves `matcher/` through `..`", async () => {
      await assert.rejects(
        matcherRules(
          new Graph(
            await row(
              "a",
              "SameCode",
              "matcher/../lenses/everyday.rq",
              "lenses/everyday.rq",
            ),
          ),
          files,
        ),
        refusal(
          /names matcher\/\.\.\/lenses\/everyday\.rq, which is not under matcher\//,
        ),
      );
    });

    it("throws Refusal for a query path written with a backslash", async () => {
      await assert.rejects(
        matcherRules(
          new Graph(
            await row(
              "a",
              "SameCode",
              "matcher/..\\lenses\\everyday.rq",
              "lenses/everyday.rq",
            ),
          ),
          files,
        ),
        refusal(/which is not under matcher\//),
      );
    });

    it("throws Refusal for two rows that give one justification", async () => {
      await assert.rejects(
        matcherRules(
          new Graph([
            ...sameCode,
            ...(await row("b", "SameCode", "matcher/same-code-and-date.rq")),
          ]),
          files,
        ),
        refusal(/two rules of the rule list give one justification/),
      );
    });

    it("throws Refusal for a row with no query hash", async () => {
      await assert.rejects(
        matcherRules(
          new Graph(
            sameCode.filter(
              ([, predicate]) => predicate.value !== `${CASCADE}queryHash`,
            ),
          ),
          files,
        ),
        refusal(/gives 0 cascade:queryHash, not one/),
      );
    });

    it("throws Refusal for a row that reads two table kinds", async () => {
      await assert.rejects(
        matcherRules(
          new Graph([
            ...sameCode,
            ...["VaccineGroups", "CodeNames"].map((kind): Triple => [
              blank("a"),
              iri(`${CASCADE}tableKind`),
              iri(CASCADE + kind),
            ]),
          ]),
          files,
        ),
        refusal(/reads 2 table kinds, not one/),
      );
    });
  });

  describe("originsJoining(rule, rows, origins)", () => {
    const kindless: MatcherRule = {
      term: CASCADE + "SameMappedCodeRule",
      justification: CASCADE + "SameMappedCode",
      appliesTo: new Set([CASCADE + "ProblemOrDiagnosis"]),
      query: "matcher/same-mapped-code.rq",
      hash: "ni:///sha-256;x",
    };
    const rule: MatcherRule = { ...kindless, kind: `${CASCADE}CodeMappings` };
    const version = "urn:example:mappings-2";
    const loaded = new Set([version]);
    const joins = (origin?: string): Map<string, Term> =>
      new Map<string, Term>([
        ["record", iri("urn:example:a")],
        ["other", iri("urn:example:b")],
        ...(origin === undefined ? [] : [["origin", iri(origin)] as const]),
      ]);

    it("returns, for each pair, the table versions whose rows join it", () => {
      assert.deepEqual(
        [...originsJoining(rule, [joins(version)], loaded).values()],
        [loaded],
      );
    });

    it("throws Refusal for a row that cites no table version, under a rule that reads a table", () => {
      assert.throws(
        () => originsJoining(rule, [joins()], loaded),
        refusal(/by no table, not by a table version it reads/),
      );
    });

    it("throws Refusal for a row that cites a table version the run did not read", () => {
      assert.throws(
        () => originsJoining(rule, [joins("urn:example:mappings-1")], loaded),
        refusal(/by urn:example:mappings-1, not by a table version it reads/),
      );
    });

    it("throws Refusal for a row that cites a table version, under a rule that reads none", () => {
      assert.throws(
        () => originsJoining(kindless, [joins(version)], new Set([""])),
        refusal(/by urn:example:mappings-2, not by a table version it reads/),
      );
    });
  });
});
