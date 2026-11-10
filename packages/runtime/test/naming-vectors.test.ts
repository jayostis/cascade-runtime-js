import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { Graph } from "../src/graph.js";
import {
  actDescriptionName,
  matcherJudgmentAssertionName,
  canonical,
  earlierInUtc,
  fingerprint,
  matcherJudgmentName,
  containedRecordName,
  documentName,
  enteredRecordName,
  fileDigest,
  findingName,
  muhash3072,
  normalisedBaseUrl,
  organizationName,
  recordFromCcdaName,
  recordFromCcdaWithoutIdName,
  recordFromDocumentName,
  recordFromServerName,
  releaseRetractionName,
  revisionName,
  serverName,
  setHash,
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
    MatcherJudgmentNamingRule: (i) =>
      matcherJudgmentName({
        maker: nth(i, 0),
        rule: nth(i, 1),
        justification: nth(i, 2),
        members: list(i, 3),
        used: list(i, 4),
      }),
    MatcherJudgmentAssertionNamingRule: (i) =>
      matcherJudgmentAssertionName(nth(i, 0), nth(i, 1)),
    ReleaseRetractionNamingRule: (i) =>
      releaseRetractionName(nth(i, 0), nth(i, 1), nth(i, 2)),
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
      const first = list(i, 2);
      assert.ok(first.length <= 1, "a snapshot has at most one first parent");
      return snapshotName({
        act: nth(i, 0),
        description: nth(i, 1),
        firstParent: first[0],
        mergedParents: list(i, 3),
        setHash: nth(i, 4),
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

function readVectors(): Promise<Vectors> {
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

/** A URL's userinfo, host, query and fragment, each where present, split as RFC 3986's appendix B does. */
function secretParts(url: string): string[] {
  const [, authority, query, fragment] =
    /^(?:[^:/?#]+:)?(?:\/\/([^/?#]*))?[^?#]*(?:\?([^#]*))?(?:#(.*))?$/s.exec(
      url,
    ) ?? [];
  const at = authority?.lastIndexOf("@") ?? -1;
  const userinfo = at < 0 ? undefined : authority?.slice(0, at);
  const hostAndPort = authority?.slice(at + 1) ?? "";
  const close = hostAndPort.indexOf("]");
  const host = hostAndPort.startsWith("[")
    ? hostAndPort.slice(0, close < 0 ? undefined : close + 1)
    : hostAndPort.split(":")[0];
  return [userinfo, host, query, fragment].filter(
    (part): part is string => part !== undefined && part !== "",
  );
}

/** Whether the text holds the part as written, not inside a longer run of letters and digits: "userinfo" does not echo "user". */
function echoes(text: string, part: string): boolean {
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
    const before = text[at - 1] ?? "";
    const after = text[at + part.length] ?? "";
    if (!/[A-Za-z0-9]/.test(before + after)) return true;
  }
  return false;
}

async function parsed(bytes: Uint8Array, base: string): Promise<Triple[]> {
  return new OxigraphStore().parse(bytes, base);
}

/** The naming rules of one leaf's vectors, as the manifest names them under `cascade:`. */
const FROM_A_SOURCE = [
  "RecordFromServerNamingRule",
  "RecordFromDocumentNamingRule",
  "RecordFromCcdaNamingRule",
  "RecordFromCcdaWithoutIdNamingRule",
];
const CONTAINED_OR_ENTERED = [
  "ContainedRecordNamingRule",
  "EnteredRecordNamingRule",
];
const BY_NQUADS = [
  "VersionNamingRule",
  "RevisionNamingRule",
  "FindingNamingRule",
  "TableVersionNamingRule",
];
const DOCUMENT = ["DocumentNamingRule"];
const SERVER_OR_ORGANIZATION = ["ServerNamingRule", "OrganizationNamingRule"];
const JUDGMENTS = [
  "MatcherJudgmentNamingRule",
  "MatcherJudgmentAssertionNamingRule",
  "ReleaseRetractionNamingRule",
];
const ROW_OR_VIEW_ENTRY = ["TableRowNamingRule", "ViewEntryNamingRule"];
const SNAPSHOT = ["SnapshotNamingRule"];

/** Every naming rule a leaf of the first level 2 runs. */
const RULES_RUN = [
  ...FROM_A_SOURCE,
  ...CONTAINED_OR_ENTERED,
  ...BY_NQUADS,
  ...DOCUMENT,
  ...SERVER_OR_ORGANIZATION,
  ...JUDGMENTS,
  ...ROW_OR_VIEW_ENTRY,
  ...SNAPSHOT,
];

const typeOf = (vectors: Vectors, entry: Term): string | undefined =>
  vectors.graph.objects(entry, `${RDF}type`)[0]?.value;

const labelOf = (vectors: Vectors, entry: Term): string =>
  one(vectors.graph, entry, `${MF}name`).value;

/** The entries of the manifest of one type, `NamingTest`, `BaseUrlNormalisationTest` or `BaseUrlRefusalTest`. */
function entriesOfType(vectors: Vectors, kind: string): readonly Term[] {
  return vectors.entries.filter(
    (entry) => typeOf(vectors, entry) === `${BRIDGE}${kind}`,
  );
}

/** The naming vectors whose rule is one of the rules, as `cascade:` local names. */
function entriesNamedBy(
  vectors: Vectors,
  rules: readonly string[],
): readonly Term[] {
  return entriesOfType(vectors, "NamingTest").filter((entry) =>
    rules.includes(
      one(vectors.graph, entry, `${BRIDGE}namingRule`).value.slice(
        CASCADE.length,
      ),
    ),
  );
}

/** Asserts that each vector's rule, run on its inputs, gives the vector's name; each assertion's message is the vector's name. */
async function reproduceNames(
  vectors: Vectors,
  rules: readonly string[],
): Promise<void> {
  const { graph, path, read } = vectors;
  const entries = entriesNamedBy(vectors, rules);
  assert.ok(
    entries.length > 0,
    `the manifest has no vector of ${rules.join(", ")}`,
  );
  for (const entry of entries) {
    const label = labelOf(vectors, entry);
    const action = one(graph, entry, `${MF}action`);
    const result = one(graph, entry, `${MF}result`);
    const local = one(graph, entry, `${BRIDGE}namingRule`).value.slice(
      CASCADE.length,
    );
    const expected = one(graph, result, `${BRIDGE}expectedName`).value;
    if (local === "DocumentNamingRule") {
      const input = one(graph, action, `${BRIDGE}input`);
      assert.equal(
        await documentName(await read(path(input))),
        expected,
        label,
      );
      continue;
    }
    const byContent = BY_CONTENT[local];
    if (byContent !== undefined) {
      const input = one(graph, action, `${BRIDGE}input`);
      const triples = await parsed(await read(path(input)), input.value);
      const nquads = one(graph, result, `${BRIDGE}canonicalContent`);
      assert.equal(
        await canonical(triples),
        new TextDecoder().decode(await read(path(nquads))),
        `${label}: canonical N-Quads`,
      );
      assert.equal(await byContent(triples), expected, label);
      continue;
    }
    const byInputs = BY_INPUTS[local];
    assert.ok(byInputs !== undefined, `${local} is a rule names.ts knows`);
    const inputs = items(graph, one(graph, action, `${BRIDGE}nameInputs`)).map(
      (input): Input =>
        input.termType === "Literal"
          ? input.value
          : items(graph, input).map((item) => item.value),
    );
    assert.equal(await byInputs(inputs), expected, label);
  }
}

interface SnapshotVectors {
  readonly muhash3072: readonly {
    readonly name: string;
    readonly members: readonly string[];
    readonly numerator: string;
    readonly digest: string;
  }[];
  readonly setHashes: readonly {
    readonly name: string;
    readonly files: readonly SetFile[];
    readonly setHash: string;
  }[];
  readonly chains: readonly {
    readonly name: string;
    readonly snapshots: readonly {
      readonly act: string;
      readonly path: string;
      readonly file: string;
      readonly description: string;
      readonly firstParent: string | null;
      readonly mergedParents: readonly string[];
      readonly set: readonly SetFile[];
      readonly setHash: string;
      readonly name: string;
    }[];
  }[];
}

interface SetFile {
  readonly path: string;
  readonly sha256: string;
}

function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const filesOf = (files: readonly SetFile[]) =>
  files.map(({ path, sha256 }) => [path, bytesOf(sha256)] as const);

/**
 * Everything a pod holds is named by a naming rule of the vocabulary, from its content or from the inputs the rule
 * lists, so two runtimes give one thing one name. The vocabulary publishes vectors, inputs with the name each must give,
 * and every naming function of this package is held to them here.
 * @rule runtime/naming.feature N3
 * @rule runtime/naming.feature N4
 * @rule runtime/naming.feature N14
 */
describe("Naming what a pod holds · versionName(), recordFromServerName(), normalisedBaseUrl(), snapshotName()", () => {
  /**
   * The vocabulary's list of naming vectors, `tests/vectors/naming/manifest.ttl`: each vector names a rule, the
   * inputs it is given and the name it must return, or the base URL it must normalise or refuse.
   */
  describe("given the vocabulary's naming vectors (`tests/vectors/naming/manifest.ttl`)", () => {
    let vectors: Vectors;
    before(async () => {
      vectors = await readVectors();
    });

    it("has a naming function for the rule of every vector the list holds", () => {
      const { graph, entries } = vectors;
      assert.ok(entries.length > 0, "the list holds vectors");
      for (const kind of [
        "NamingTest",
        "BaseUrlNormalisationTest",
        "BaseUrlRefusalTest",
      ]) {
        const typed = `${BRIDGE}${kind}`;
        assert.equal(
          entriesOfType(vectors, kind).length,
          graph.subjects(`${RDF}type`, { termType: "NamedNode", value: typed })
            .length,
          `the manifest lists every ${kind}`,
        );
      }
      const known = [
        ...Object.keys(BY_INPUTS),
        ...Object.keys(BY_CONTENT),
        "DocumentNamingRule",
      ].sort();
      for (const entry of entriesOfType(vectors, "NamingTest")) {
        const rule = one(graph, entry, `${BRIDGE}namingRule`).value;
        assert.ok(rule.startsWith(CASCADE), `${rule} is a Cascade term`);
        assert.ok(
          known.includes(rule.slice(CASCADE.length)),
          `${labelOf(vectors, entry)}: ${rule} is a rule names.ts has no function for`,
        );
      }
      assert.deepEqual(
        [...RULES_RUN].sort(),
        known,
        "the leaves below run exactly the rules names.ts has a function for",
      );
    });

    it("returns each vector's name for a record from a server, from a document, and from a C-CDA document with an id or without", async () => {
      await reproduceNames(vectors, FROM_A_SOURCE);
    });

    it("returns each vector's name for a record contained in another, and for a record its owner entered", async () => {
      await reproduceNames(vectors, CONTAINED_OR_ENTERED);
    });

    it("returns for each vector of a version, a revision, a finding and a table version the canonical N-Quads the vector holds, and the name those give", async () => {
      await reproduceNames(vectors, BY_NQUADS);
    });

    it("returns each vector's name for a document, from its bytes", async () => {
      await reproduceNames(vectors, DOCUMENT);
    });

    it("returns each vector's name for a server and for an organization", async () => {
      await reproduceNames(vectors, SERVER_OR_ORGANIZATION);
    });

    it("returns each vector's name for a matcher judgment, an assertion of one, and a release's retraction", async () => {
      await reproduceNames(vectors, JUDGMENTS);
    });

    it("returns each vector's name for a table row and for a view entry", async () => {
      await reproduceNames(vectors, ROW_OR_VIEW_ENTRY);
    });

    it("returns each vector's name for a snapshot", async () => {
      await reproduceNames(vectors, SNAPSHOT);
    });
  });

  /** The same list's vectors of base URLs: the form a server's address is named from, or the reason it is refused. */
  describe("normalisedBaseUrl(url)", () => {
    let vectors: Vectors;
    before(async () => {
      vectors = await readVectors();
    });

    it("returns each vector's normalised form of a server's base URL", () => {
      const { graph } = vectors;
      const entries = entriesOfType(vectors, "BaseUrlNormalisationTest");
      assert.ok(entries.length > 0, "the list has no base URL to normalise");
      for (const entry of entries) {
        const action = one(graph, entry, `${MF}action`);
        const result = one(graph, entry, `${MF}result`);
        assert.equal(
          normalisedBaseUrl(
            one(graph, action, `${CASCADE}serverBaseUrl`).value,
          ),
          one(graph, result, `${CASCADE}serverBaseUrl`).value,
          labelOf(vectors, entry),
        );
      }
    });

    // No vector holds U+001F until cascade-vocabulary#371 lands; this one assertion owns it meanwhile.
    it("throws Refusal for a base URL holding U+001F", () => {
      assert.throws(() => normalisedBaseUrl("https://h/\u001f"), Refusal);
    });

    it("throws Refusal for each base URL the vectors refuse, in a sentence that repeats no part of the URL", () => {
      const { graph } = vectors;
      const entries = entriesOfType(vectors, "BaseUrlRefusalTest");
      assert.ok(entries.length > 0, "the list has no base URL to refuse");
      for (const entry of entries) {
        assert.deepEqual(
          graph.objects(entry, `${MF}result`),
          [],
          `${labelOf(vectors, entry)}: a refusal names no result`,
        );
        const url = one(
          graph,
          one(graph, entry, `${MF}action`),
          `${CASCADE}serverBaseUrl`,
        ).value;
        assert.throws(
          () => normalisedBaseUrl(url),
          (error: unknown) =>
            error instanceof Refusal &&
            error.message.length > 10 &&
            [url, ...secretParts(url)].every(
              (part) => !echoes(error.message, part),
            ),
          `${labelOf(vectors, entry)}: it is refused, saying why and echoing no part of the URL`,
        );
      }
    });
  });

  /**
   * The vocabulary's `tests/vectors/snapshot/vectors.json`: Bitcoin Core's own MuHash3072 vector, sets of files with the
   * set hash each must give, and chains of snapshots with the name each is given.
   */
  describe("given the vocabulary's snapshot vectors (`tests/vectors/snapshot/vectors.json`)", () => {
    let vectors: SnapshotVectors;
    before(async () => {
      const bytes = await (
        await vocabulary()
      ).read("tests/vectors/snapshot/vectors.json");
      assert.ok(
        bytes !== undefined,
        "the vocabulary holds the snapshot vectors",
      );
      vectors = JSON.parse(new TextDecoder().decode(bytes)) as SnapshotVectors;
    });

    it("returns Bitcoin Core's MuHash3072 digest from `muhash3072()`, and from `fileDigest()` of the vector's numerator", async () => {
      assert.ok(vectors.muhash3072.length > 0, "no MuHash3072 vector");
      for (const vector of vectors.muhash3072) {
        assert.equal(
          hexOf(await fileDigest(bytesOf(vector.numerator))),
          vector.digest,
          `${vector.name}: fileDigest()`,
        );
        assert.equal(
          hexOf(await muhash3072(vector.members.map(bytesOf))),
          vector.digest,
          `${vector.name}: muhash3072()`,
        );
      }
    });

    it("returns each vector's set hash from `setHash()`", async () => {
      assert.ok(vectors.setHashes.length > 0, "no set hash vector");
      for (const vector of vectors.setHashes)
        assert.equal(
          await setHash(filesOf(vector.files)),
          vector.setHash,
          vector.name,
        );
    });

    it("returns, for each snapshot of each chain, the vector's set hash, the name of its act's description, and its name", async () => {
      assert.ok(vectors.chains.length > 0, "no chain of snapshots");
      const store = new OxigraphStore();
      for (const chain of vectors.chains)
        for (const [index, snapshot] of chain.snapshots.entries()) {
          const label = `${chain.name}, snapshot ${index + 1}`;
          assert.equal(
            await setHash(filesOf(snapshot.set)),
            snapshot.setHash,
            `${label}: set hash`,
          );
          const triples = await store.parse(
            new TextEncoder().encode(snapshot.file),
            "https://pod.example/",
          );
          assert.equal(
            await actDescriptionName(
              triples.filter(([subject]) => subject.value !== snapshot.name),
            ),
            snapshot.description,
            `${label}: its act's description`,
          );
          const parent = snapshot.firstParent ?? undefined;
          assert.equal(
            await snapshotName({
              act: snapshot.act,
              description: snapshot.description,
              ...(parent === undefined ? {} : { firstParent: parent }),
              mergedParents: snapshot.mergedParents,
              setHash: snapshot.setHash,
            }),
            snapshot.name,
            `${label}: name`,
          );
        }
    });
  });

  /**
   * The vectors never pass an empty `versionId`; an adapter that writes `versionId: ""` must still name the record as
   * one that leaves it out.
   */
  describe("containedRecordName()", () => {
    it("reads an empty `versionId` as none, and names from `lastUpdated`", async () => {
      const named = (source: { versionId?: string; lastUpdated?: string }) =>
        containedRecordName("urn:uuid:a", source, "x");
      assert.equal(
        await named({ versionId: "", lastUpdated: "t" }),
        await named({ lastUpdated: "t" }),
      );
      assert.notEqual(
        await named({ versionId: "", lastUpdated: "t" }),
        await named({ versionId: "", lastUpdated: "u" }),
        "the name does not depend on `lastUpdated`",
      );
    });
  });

  /** As above for `keyFingerprint`: the vectors never pass an empty one, and an adapter that writes `""` must still name the
   * record as one that leaves it out. */
  describe("recordFromCcdaWithoutIdName()", () => {
    it("reads an empty `keyFingerprint` as none, and names from `membersFingerprint`", async () => {
      const entry = {
        custodian: { root: "r" },
        patient: { root: "p" },
        entryClass: "c",
        membersFingerprint: "7",
      };
      assert.equal(
        await recordFromCcdaWithoutIdName({ ...entry, keyFingerprint: "" }),
        await recordFromCcdaWithoutIdName(entry),
      );
      assert.notEqual(
        await recordFromCcdaWithoutIdName({ ...entry, keyFingerprint: "" }),
        await recordFromCcdaWithoutIdName({
          ...entry,
          membersFingerprint: "8",
        }),
        "the name does not depend on `membersFingerprint`",
      );
    });
  });

  /**
   * The C-CDA adapter works out the fingerprint of a record that has no id from its strings, and `Words` works it out
   * again for a handle; the vocabulary's vectors take it as an input and never compute it.
   */
  describe("fingerprint()", () => {
    it("returns the C-CDA adapter's fingerprint of a record's strings, in whatever order and however often each is given", async () => {
      const active = [
        "code=91936005",
        "effectiveTime=20250327120000+0000",
        "status=active",
      ];
      assert.equal(await fingerprint(active), "506034893686827", "in order");
      assert.equal(
        await fingerprint([...active].reverse().concat(active)),
        "506034893686827",
        "reversed, then given again",
      );
    });

    it('returns "0" for no strings', async () => {
      assert.equal(await fingerprint([]), "0");
    });
  });

  /** A revision is checked to revise an earlier revision of its record by the times each states, which are strings. */
  describe("earlierInUtc()", () => {
    it("returns whether the first time is the earlier instant, with a fraction of a second or an offset on either", () => {
      assert.ok(
        earlierInUtc("2026-09-01T10:00:00Z", "2026-09-01T10:00:00.5Z"),
        "no fraction before a fraction",
      );
      assert.ok(
        !earlierInUtc("2026-09-01T10:00:00.5Z", "2026-09-01T10:00:00Z"),
        "a fraction before none",
      );
      assert.ok(
        earlierInUtc("2026-09-01T10:00:00.25Z", "2026-09-01T10:00:00.3Z"),
        "two fractions",
      );
      assert.ok(
        earlierInUtc("2026-09-01T12:00:00+02:00", "2026-09-01T10:00:00.1Z"),
        "an offset against Z",
      );
    });
  });
});
