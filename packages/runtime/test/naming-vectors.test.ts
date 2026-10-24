import assert from "node:assert/strict";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import {
  assertionName,
  canonical,
  claimName,
  containedRecordName,
  documentName,
  enteredRecordName,
  findingName,
  normalisedBaseUrl,
  organizationName,
  recordFromCcdaName,
  recordFromCcdaWithoutIdName,
  recordFromDocumentName,
  recordFromServerName,
  retractionName,
  revisionName,
  serverName,
  snapshotName,
  tableRowName,
  tableVersionName,
  versionName,
  viewEntryName,
} from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { RDF, type Term, type Triple } from "../src/rdf.js";
import { Refusal } from "../src/refusal.js";
import { vocabulary } from "./vocabulary.js";

const VECTORS = "tests/vectors/naming/";
const MF = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

type Input = string | readonly string[];

function nth(inputs: readonly Input[], index: number): string {
  const input = inputs[index];
  assert.equal(typeof input, "string", `input ${index + 1} is no literal`);
  return input as string;
}

function list(inputs: readonly Input[], index: number): readonly string[] {
  const input = inputs[index];
  assert.ok(Array.isArray(input), `input ${index + 1} is no list`);
  return input as readonly string[];
}

const BY_INPUTS: Record<string, (inputs: readonly Input[]) => Promise<string>> =
  {
    RecordFromServerNamingRule: (i) =>
      recordFromServerName(nth(i, 0), nth(i, 1), nth(i, 2)),
    RecordFromDocumentNamingRule: (i) =>
      recordFromDocumentName(nth(i, 0), nth(i, 1)),
    RecordFromCcdaNamingRule: (i) =>
      recordFromCcdaName({
        custodian: { root: nth(i, 0), extension: nth(i, 1) },
        patient: { root: nth(i, 2), extension: nth(i, 3) },
        entry: { root: nth(i, 4), extension: nth(i, 5) },
      }),
    RecordFromCcdaWithoutIdNamingRule: (i) =>
      recordFromCcdaWithoutIdName({
        custodian: { root: nth(i, 0), extension: nth(i, 1) },
        patient: { root: nth(i, 2), extension: nth(i, 3) },
        entryClass: nth(i, 4),
        ...(nth(i, 5) === "" ? {} : { keyFingerprint: nth(i, 5) }),
        ...(nth(i, 6) === "" ? {} : { membersFingerprint: nth(i, 6) }),
      }),
    ContainedRecordNamingRule: (i) =>
      containedRecordName(
        nth(i, 0),
        nth(i, 1) === "" ? {} : { versionId: nth(i, 1) },
        nth(i, 2),
      ),
    EnteredRecordNamingRule: (i) =>
      enteredRecordName(nth(i, 0), Number(nth(i, 1))),
    ServerNamingRule: (i) => serverName(nth(i, 0)),
    OrganizationNamingRule: (i) =>
      i.length === 3
        ? (assert.equal(nth(i, 1), "Organization"),
          organizationName({ server: nth(i, 0), id: nth(i, 2) }))
        : organizationName({ system: nth(i, 0), value: nth(i, 1) }),
    ClaimNamingRule: (i) =>
      claimName({
        maker: nth(i, 0),
        rule: nth(i, 1),
        justification: nth(i, 2),
        members: list(i, 3),
        used: list(i, 4),
      }),
    AssertionNamingRule: (i) => assertionName(nth(i, 0), nth(i, 1)),
    RetractionNamingRule: (i) =>
      retractionName(nth(i, 0), nth(i, 1), nth(i, 2)),
    TableRowNamingRule: (i) =>
      tableRowName(
        { source: nth(i, 0), property: nth(i, 1), target: nth(i, 2) },
        i.length > 3 ? nth(i, 3) : undefined,
      ),
    ViewEntryNamingRule: (i) =>
      viewEntryName(
        nth(i, 0),
        i.slice(1).map((_, index) => nth(i, index + 1)),
      ),
    SnapshotNamingRule: (i) => {
      const first = list(i, 1);
      assert.ok(first.length <= 1, "a snapshot has at most one first parent");
      return snapshotName({
        act: nth(i, 0),
        firstParent: first[0],
        mergedParents: list(i, 2),
        setHash: nth(i, 3),
      });
    },
  };

const BY_CONTENT: Record<
  string,
  (triples: readonly Triple[]) => Promise<string>
> = {
  VersionNamingRule: versionName,
  RevisionNamingRule: revisionName,
  FindingNamingRule: findingName,
  TableVersionNamingRule: tableVersionName,
};

interface Vectors {
  readonly graph: Graph;
  readonly entries: readonly Term[];
  /** The path in the vocabulary a relative reference in the manifest resolves to. */
  readonly path: (term: Term) => string;
  readonly read: (path: string) => Promise<Uint8Array>;
}

function one(graph: Graph, subject: Term, predicate: string): Term {
  const objects = graph.objects(subject, predicate);
  assert.equal(objects.length, 1, `${subject.value} has one <${predicate}>`);
  return objects[0] as Term;
}

function items(graph: Graph, head: Term): Term[] {
  const found: Term[] = [];
  for (
    let at = head;
    at.value !== `${RDF}nil`;
    at = one(graph, at, `${RDF}rest`)
  )
    found.push(one(graph, at, `${RDF}first`));
  return found;
}

let loaded: Promise<Vectors> | undefined;

function vectors(): Promise<Vectors> {
  loaded ??= (async () => {
    const files = await vocabulary();
    const read = async (path: string): Promise<Uint8Array> => {
      const bytes = await files.read(path);
      assert.ok(bytes !== undefined, `the vocabulary holds ${path}`);
      return bytes;
    };
    const base = `${files.iri}${VECTORS}`;
    const graph = new Graph(
      await new OxigraphStore().parse(
        await read(`${VECTORS}manifest.ttl`),
        `${base}manifest.ttl`,
      ),
    );
    const [manifest] = graph.subjects(`${RDF}type`, {
      termType: "NamedNode",
      value: `${MF}Manifest`,
    });
    assert.ok(manifest !== undefined, "the manifest names itself");
    return {
      graph,
      entries: items(graph, one(graph, manifest, `${MF}entries`)),
      path: (term) => {
        assert.ok(
          term.value.startsWith(base),
          `${term.value} is a vector file`,
        );
        return `${VECTORS}${term.value.slice(base.length)}`;
      },
      read,
    };
  })();
  return loaded;
}

async function parsed(bytes: Uint8Array, base: string): Promise<Triple[]> {
  return new OxigraphStore().parse(bytes, base);
}

test("every naming vector of the vocabulary reproduces", async (t) => {
  const { graph, entries, path, read } = await vectors();
  assert.ok(entries.length > 0, "the manifest lists vectors");
  for (const [kind, count] of [
    ["NamingTest", 63],
    ["BaseUrlNormalisationTest", 15],
    ["BaseUrlRefusalTest", 23],
  ] as const) {
    const typed = `${BRIDGE}${kind}`;
    const listed = entries.filter((entry) =>
      graph.objects(entry, `${RDF}type`).some((type) => type.value === typed),
    ).length;
    assert.equal(
      listed,
      graph.subjects(`${RDF}type`, { termType: "NamedNode", value: typed })
        .length,
      `the manifest lists every ${kind}`,
    );
    assert.equal(listed, count, `the manifest holds ${count} ${kind}`);
  }
  const nameOf = (subject: Term, predicate: string): Term =>
    one(graph, one(graph, subject, predicate), `${BRIDGE}expectedName`);
  for (const entry of entries) {
    const label = one(graph, entry, `${MF}name`).value;
    await t.test(label, async () => {
      const action = one(graph, entry, `${MF}action`);
      const [type] = graph.objects(entry, `${RDF}type`);
      if (type?.value === `${BRIDGE}BaseUrlRefusalTest`) {
        assert.deepEqual(
          graph.objects(entry, `${MF}result`),
          [],
          "a refusal names no result",
        );
        const url = one(graph, action, `${CASCADE}serverBaseUrl`).value;
        assert.throws(() => normalisedBaseUrl(url), Refusal);
        return;
      }
      const result = one(graph, entry, `${MF}result`);
      if (type?.value === `${BRIDGE}BaseUrlNormalisationTest`) {
        assert.equal(
          normalisedBaseUrl(
            one(graph, action, `${CASCADE}serverBaseUrl`).value,
          ),
          one(graph, result, `${CASCADE}serverBaseUrl`).value,
        );
        return;
      }
      assert.equal(type?.value, `${BRIDGE}NamingTest`);
      const rule = one(graph, entry, `${BRIDGE}namingRule`).value;
      assert.ok(rule.startsWith(CASCADE), `${rule} is a Cascade term`);
      const local = rule.slice(CASCADE.length);
      const expected = nameOf(entry, `${MF}result`).value;
      if (local === "DocumentNamingRule") {
        const input = one(graph, action, `${BRIDGE}input`);
        assert.equal(await documentName(await read(path(input))), expected);
        return;
      }
      const byContent = BY_CONTENT[local];
      if (byContent !== undefined) {
        const input = one(graph, action, `${BRIDGE}input`);
        const triples = await parsed(await read(path(input)), input.value);
        const nquads = one(graph, result, `${BRIDGE}canonicalContent`);
        assert.equal(
          await canonical(triples),
          new TextDecoder().decode(await read(path(nquads))),
        );
        assert.equal(await byContent(triples), expected);
        return;
      }
      const byInputs = BY_INPUTS[local];
      assert.ok(byInputs !== undefined, `${local} is a rule names.ts knows`);
      const inputs = items(
        graph,
        one(graph, action, `${BRIDGE}nameInputs`),
      ).map((input): Input =>
        input.termType === "Literal"
          ? input.value
          : items(graph, input).map((item) => item.value),
      );
      assert.equal(await byInputs(inputs), expected);
    });
  }
});
