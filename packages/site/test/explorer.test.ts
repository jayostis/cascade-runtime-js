import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Files,
  fileStem,
  MemoryFiles,
  OxigraphStore,
} from "@cascade-runtime/runtime";
import {
  featurePod,
  findRoot,
  type LocalVocabulary,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { agentFiles } from "../src/agents.js";
import {
  EXPLORER_FILE,
  type ExplorerData,
  type ExplorerFile,
} from "../src/explorer.js";
import { Site, type SiteOptions } from "../src/site.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const KIT = "tamsin-vale";
const MATCHER = "runtime/matcher.feature";
const EXAMPLE =
  "the matcher joins the pair a person called different, and not the pair a person called the same";
const decoded = (bytes: Uint8Array | undefined) =>
  JSON.parse(new TextDecoder().decode(bytes)) as ExplorerData;

let vocabulary: LocalVocabulary;
let kit: { site: Site; data: ExplorerData; built: Map<string, Uint8Array> };
let none: ExplorerData;
let matching: { site: Site; data: ExplorerData };

const optionsFor = (pod: MemoryFiles, name: string): SiteOptions => ({
  vocabulary: vocabulary.files,
  layout: vocabulary.layout,
  build: vocabulary.build,
  pod,
  lens: vocabulary.config.lens,
  defaultLens: vocabulary.config.lens,
  newStore: () => new OxigraphStore(),
  name,
  at: "2026-03-03T08:00:00Z",
  ask: `npm run ask -- ${name}`,
});

const file = (data: ExplorerData, path: string): ExplorerFile => {
  const found = data.files.find((each) => each.path === path);
  assert.ok(found, `the object lists no file ${path}`);
  return found;
};

/**
 * Tamsin's pod is the smallest kit's: a hospital's records pulled twice with one person's judgment between the pulls.
 * The matching pod joins two records a person called different, for a view entry with a judgment in it and a matcher
 * judgment with its rule. If a change to either story takes that away, the tests that need it fail on a guard.
 */
before(async () => {
  vocabulary = await localVocabulary(ROOT);
  const tamsin = new MemoryFiles("https://pod.example/");
  await featurePod(vocabulary, `conformance/${KIT}/${KIT}.feature`, tamsin, {});
  const site = await Site.build({ ...optionsFor(tamsin, KIT), kit: KIT });
  const built = await site.files();
  kit = { site, data: decoded(built.get(EXPLORER_FILE)), built };
  none = decoded(
    (await (await Site.build(optionsFor(tamsin, KIT))).files()).get(
      EXPLORER_FILE,
    ),
  );
  const joined = new MemoryFiles("https://pod.example/");
  await featurePod(vocabulary, MATCHER, joined, {
    example: EXAMPLE,
  });
  const second = await Site.build(optionsFor(joined, "matching"));
  matching = {
    site: second,
    data: decoded((await second.files()).get(EXPLORER_FILE)),
  };
});

/**
 * A pod's explorer is one fixed app over one data object, so every part of the object is computed from what the site
 * already holds for the pod, never from its pages: its files and what wrote each, its log, its kit, its views and the
 * queries that define them. The object leaves out the bodies of files, the text of queries and the rows of answers, which
 * the app fetches when a node opens.
 */
describe("The pod explorer's data · explorerData(), Site.files()", () => {
  describe("given a pod built from a kit", () => {
    it("is written beside the page, and each query of the vocabulary under queries/, never as pod.json", async () => {
      assert.ok(kit.built.has(EXPLORER_FILE));
      assert.ok(!kit.built.has("pod.json"));
      const queries = (await vocabulary.files.list("queries/")).filter((path) =>
        path.endsWith(".rq"),
      );
      assert.ok(queries.length > 0);
      for (const path of queries)
        assert.deepEqual(
          kit.built.get(path),
          await vocabulary.files.read(path),
          path,
        );
    });

    it("makes every file of the pod a node with a writer, and the files the build rewrites the build's", () => {
      const { data, site } = kit;
      assert.deepEqual(
        data.files.map(({ path }) => path),
        [...site.pod.files],
      );
      for (const [index, node] of data.files.entries()) {
        assert.ok(
          node.writer === "build" ||
            data.log[node.writer]?.wrote.includes(index),
          `${node.path} names a writer that does not list it`,
        );
      }
      for (const path of site.options.layout.rebuilt.filter((each) =>
        site.pod.files.includes(each),
      ))
        assert.equal(file(data, path).writer, "build", path);
    });

    it("walks the snapshot chain from the manifest, with a person's judgment placed by its own time", () => {
      const { data } = kit;
      assert.deepEqual(
        data.log.map(({ how }) => how),
        ["making", "snapshot", "time", "snapshot"],
      );
      assert.equal(data.log[3]?.parent, 1);
      assert.equal(data.log[1]?.parent, undefined);
      const times = data.log.slice(1).map(({ time }) => Date.parse(time ?? ""));
      assert.deepEqual(
        times,
        [...times].sort((a, b) => a - b),
      );
      assert.equal(data.pod.brokenAt, undefined);
      for (const row of data.log) assert.deepEqual(row.missing, []);
      const judgment = data.files.findIndex(({ kind }) => kind === "judgment");
      assert.equal(data.files[judgment]?.writer, 2);
      assert.equal(file(data, "profile/card.ttl").writer, 0);
    });

    it("gives a person's judgment its verdict, its members and whether it counts", () => {
      const { data } = kit;
      const judged = data.files.find(({ kind }) => kind === "judgment");
      assert.equal(judged?.judgment?.by, "person");
      assert.ok(judged?.judgment?.verdict);
      assert.equal(judged?.judgment?.counts, true);
      assert.ok((judged?.judgment?.members.length ?? 0) > 0);
      for (const member of judged?.judgment?.members ?? [])
        assert.equal(data.files[member]?.kind, "record");
    });

    it("puts the kit's steps on the rows they fall on and its cases after the step they read", () => {
      const { data } = kit;
      assert.deepEqual(
        data.kit?.steps.map(({ name, row }) => [name, row]),
        [
          ["E1", 0],
          ["E2", 1],
          ["J1", 2],
          ["E3", 3],
        ],
      );
      assert.deepEqual(
        data.log.map(({ kitSteps }) => kitSteps),
        [["E1"], ["E2"], ["J1"], ["E3"]],
      );
      const [first, second] = data.kit?.cases ?? [];
      assert.equal(first?.id, "T1");
      assert.equal(first?.after, "J1");
      assert.equal(first?.row, 2);
      assert.equal(second?.after, undefined);
      assert.equal(second?.row, 3);
      assert.ok(data.kit?.handles?.records);
    });

    it("lists a record's arrivals in time order, each revision with the version it sets", () => {
      const { data } = kit;
      const handle = Object.keys(data.kit?.handles?.records ?? {}).find(
        (name) => name.includes("METFORMIN"),
      );
      const record = data.files.find((each) => each.handle === handle);
      assert.equal(record?.arrivals?.length, 2);
      const [first, later] = record?.arrivals ?? [];
      assert.ok(Date.parse(first?.time ?? "") < Date.parse(later?.time ?? ""));
      for (const arrival of record?.arrivals ?? []) {
        assert.equal(data.files[arrival.revision]?.kind, "revision");
        assert.equal(
          data.files[arrival.revision]?.record,
          data.files.indexOf(record as ExplorerFile),
        );
        assert.equal(data.files[arrival.version ?? -1]?.kind, "version");
      }
    });

    it("describes each term it uses with the label and comment the vocabulary gives it", () => {
      const { data } = kit;
      for (const term of ["cascade:Revision", "cascade:Judgment"]) {
        assert.ok(data.terms[term]?.label, `${term} has no label`);
        assert.ok(data.terms[term]?.comment, `${term} has no comment`);
      }
      for (const node of data.files)
        for (const type of node.types)
          if (type.startsWith("cascade:"))
            assert.ok(data.terms[type], `${type} is used but not described`);
    });

    it("is listed in index.json beside the page, with the queries", async () => {
      const tree = new Map(
        [...kit.built].filter(([path]) => !path.startsWith("pod/")),
      );
      const index = JSON.parse(
        new TextDecoder().decode(
          (await agentFiles({ tree, sections: [] }, {})).get("index.json"),
        ),
      ) as { files: { path: string; kind: string }[] };
      assert.equal(
        index.files.find(({ path }) => path === EXPLORER_FILE)?.kind,
        "data",
      );
      assert.ok(
        index.files.some(({ path }) => path.startsWith("queries/")),
        "no query is listed",
      );
    });
  });

  describe("given a pod built from no kit", () => {
    it("has no kit part, and its log still comes from the pod", () => {
      assert.equal(none.kit, undefined);
      assert.equal(none.log.length, 4);
      assert.deepEqual(
        none.log.map(({ kitSteps }) => kitSteps),
        [[], [], [], []],
      );
    });
  });

  describe("given a pod in which the matcher found records to be one thing", () => {
    it("pairs each view's definition with the file it writes, and says where nothing is written", () => {
      const { data, site } = matching;
      const written = data.views.filter(
        ({ fileIndex }) => fileIndex !== undefined,
      );
      assert.ok(written.length > 0, "no view is written");
      assert.ok(
        data.views.some(({ fileIndex }) => fileIndex === undefined),
        "every view is written",
      );
      for (const view of data.views) {
        const placement = site.options.layout.built.find(
          ({ file }) => file === view.file,
        );
        assert.equal(
          data.queries[view.query]?.path,
          `queries/${placement?.writtenBy}`,
        );
        if (view.fileIndex === undefined) assert.equal(view.statements, 0);
        else
          assert.equal(
            view.statements,
            site.built.get(site.pod.address + view.file)?.statements,
          );
      }
      for (const [index, view] of data.views.entries())
        if (
          view.fileIndex !== undefined &&
          data.files[view.fileIndex]?.kind === "view"
        )
          assert.equal(data.files[view.fileIndex]?.view, index);
    });

    it("gives an entry its members, its lead, the fields its members disagree on and the judgments within it", () => {
      const { data } = matching;
      const entry = data.views
        .flatMap(({ entries }) => entries)
        .find(({ members }) => members.length >= 2);
      assert.ok(entry, "no entry joins records");
      assert.ok(entry.lead !== undefined && entry.members.includes(entry.lead));
      assert.equal(entry.members[0], entry.lead);
      assert.ok(entry.within.length > 0, "no judgment is within the entry");
      for (const judged of entry.within)
        assert.equal(data.files[judged]?.kind, "judgment");
      for (const node of entry.members)
        assert.equal(data.files[node]?.entry, entry.id);
      for (const field of entry.fields) {
        assert.equal(field.members.length, entry.members.length);
        assert.equal(
          field.disagree,
          new Set(field.members.filter((value) => value !== "")).size > 1,
          field.term,
        );
      }
    });

    it("finds the query a matcher judgment's rule runs, by the rule list's path or else by hash, and reports one that does not hash true", async () => {
      const { data, site } = matching;
      const judged = data.files.find(
        ({ judgment }) => judgment?.by === "matcher",
      );
      assert.ok(judged, "no matcher judgment");
      const rule = data.matcherRules[judged.judgment?.rule ?? -1];
      assert.ok(rule, "its rule has no row");
      assert.equal(rule.by, "hash");
      assert.equal(rule.problem, undefined);
      assert.ok(
        data.queries[rule.query ?? -1]?.path.startsWith("queries/matcher/"),
      );
      assert.ok(
        data.queries[rule.query ?? -1]?.rules?.includes(
          judged.judgment?.rule ?? -1,
        ),
      );

      const other = data.matcherRules.find(
        (each) => each !== rule && each.query !== undefined,
      );
      assert.ok(other, "the version holds one rule");
      const rows = [rule, other].map(
        (each) =>
          `[] a cascade:RuleListRow ; cascade:matcherRule ${each.rule} ; cascade:queryPath "${(data.queries[each.query ?? -1]?.path ?? "").slice("queries/".length)}" ; cascade:queryHash <${each.hash}> .`,
      );
      const listed = `runtime/rule-list/${fileStem(rule.version)}.ttl`;
      const spoiled = data.queries[other.query ?? -1]?.path;
      const changed: Files = {
        iri: vocabulary.files.iri,
        read: async (name) => {
          if (name === listed)
            return new TextEncoder().encode(
              [
                "@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .",
                ...rows,
              ].join("\n"),
            );
          const bytes = await vocabulary.files.read(name);
          return name === spoiled && bytes !== undefined
            ? new Uint8Array([...bytes, 32])
            : bytes;
        },
        write: (name, bytes) => vocabulary.files.write(name, bytes),
        list: (folder) => vocabulary.files.list(folder),
      };
      const altered = decoded(
        (
          await (
            await Site.build({ ...site.options, vocabulary: changed })
          ).files()
        ).get(EXPLORER_FILE),
      );
      const kept = altered.matcherRules.find(
        ({ rule: term }) => term === rule.rule,
      );
      const reported = altered.matcherRules.find(
        ({ rule: term }) => term === other.rule,
      );
      assert.equal(kept?.by, "path");
      assert.equal(kept?.problem, undefined);
      assert.equal(reported?.by, "path");
      assert.equal(altered.queries[reported?.query ?? -1]?.path, spoiled);
      assert.match(reported?.problem ?? "", /hashes to/);
    });

    it("gives each lens's count of the judgments that count, and the order the build runs its derivations", () => {
      const { data, site } = matching;
      assert.ok(data.lenses.some(({ lens }) => lens === site.options.lens));
      for (const { rows, columns } of data.lenses) {
        assert.ok(rows.length > 0);
        for (const row of rows) assert.equal(row.length, columns.length);
      }
      const steps = site.pipeline.get(site.options.lens) ?? [];
      const ordered = data.queries
        .filter(({ order }) => order !== undefined)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      assert.deepEqual(
        ordered.map(({ path }) => path),
        [...new Set(steps.map(({ answer }) => answer.query.path))],
      );
      for (const [index, step] of steps.entries())
        assert.equal(
          ordered[index]?.added?.reduce((sum, [, count]) => sum + count, 0),
          step.added.length,
        );
    });
  });
});
