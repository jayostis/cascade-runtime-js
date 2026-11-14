import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { dirname, join } from "node:path";
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
  EXPLORER_BUDGET,
  EXPLORER_FILE,
  type ExplorerData,
  type ExplorerFile,
} from "../src/explorer.js";
import { PLAIN } from "../src/html.js";
import { Site, type SiteOptions } from "../src/site.js";
import { COPY } from "../src/terms.js";

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
let alex: { site: Site; data: ExplorerData };

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
  chrome: PLAIN,
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
  const alexPod = new MemoryFiles("https://pod.example/");
  await featurePod(
    vocabulary,
    "conformance/alex-rivera/alex-rivera.feature",
    alexPod,
    {},
  );
  const alexSite = await Site.build({
    ...optionsFor(alexPod, "alex-rivera"),
    kit: "alex-rivera",
  });
  alex = {
    site: alexSite,
    data: decoded((await alexSite.files()).get(EXPLORER_FILE)),
  };
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

    it("copies the manifest into the site naming the snapshot the pod's own manifest names, with prov:used", async () => {
      const own = await kit.site.options.pod.read(
        kit.site.options.layout.manifest,
      );
      const used = async (bytes: Uint8Array | undefined) =>
        (
          await new OxigraphStore().parse(
            bytes as Uint8Array,
            "https://pod.example/manifest.ttl",
          )
        )
          .filter(
            ([, predicate]) =>
              predicate.value === "http://www.w3.org/ns/prov#used",
          )
          .map(([, , snapshot]) => snapshot.value);
      assert.equal(
        (await used(own)).length,
        1,
        "the pod's manifest names a snapshot",
      );
      assert.deepEqual(
        await used(kit.built.get(`${COPY}${kit.site.options.layout.manifest}`)),
        await used(own),
      );
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
        data.log.map(({ kitSteps }) => kitSteps.map(({ name }) => name)),
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

    it("gives each example pod's kit its introduction, the first paragraph of its feature file as written, and a pod of no kit none", async () => {
      for (const { data } of [kit, alex]) {
        const written = new TextDecoder().decode(
          await vocabulary.files.read(data.kit?.feature ?? ""),
        );
        const paragraph = /^Feature:.*\r?\n((?:[ \t]+\S.*\r?\n)+)\r?\n/.exec(
          written,
        )?.[1];
        assert.ok(paragraph, `${data.kit?.feature} has no first paragraph`);
        assert.equal(
          data.kit?.introduction,
          paragraph.trim().replace(/\s*\r?\n\s*/g, " "),
        );
      }
      assert.equal(none.kit, undefined);
    });

    it("gives each kit step the sentence its Background states, without the label that names it", () => {
      const { data } = kit;
      assert.deepEqual(
        data.log.flatMap(({ kitSteps }) =>
          kitSteps.map(({ name, text }) => [name, text]),
        ),
        [
          ["E1", "a new pod for Tamsin on 2024-02-01 at 09:00"],
          ["E2", 'the pull "north-2024-02" is imported on 2024-02-01 at 09:05'],
          ["J1", 'Tamsin files the judgment "J1" on 2024-02-01 at 09:05:30'],
          ["E3", 'the pull "north-2025-02" is imported on 2025-02-01 at 09:05'],
        ],
      );
    });

    it("gives each kit case the steps of its example, with the tables they carry", () => {
      const cases = alex.data.kit?.cases ?? [];
      const first = cases.find(({ id }) => id === "P1");
      assert.ok(first?.steps?.length, "P1 has no steps");
      assert.match(first.steps[0]?.text ?? "", /^these records have/);
      assert.deepEqual(first.steps[0]?.table?.[0], [
        "record",
        "field",
        "value",
      ]);
      assert.ok(cases.every(({ steps }) => steps !== undefined));
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

    it("gives each file the terms its statements use, as indices into one list, and the prefixes that shorten them", () => {
      const { data } = kit;
      assert.equal(
        data.prefixes.cascade,
        "https://ns.cascadeprotocol.org/cascade#",
      );
      assert.deepEqual(
        data.termList,
        [...new Set(data.termList)].sort(),
        "the term list is sorted and holds each term once",
      );
      assert.ok(
        !data.termList.includes("rdf:type"),
        "rdf:type reads as everything",
      );
      for (const node of data.files)
        for (const index of node.terms ?? [])
          assert.ok(
            data.termList[index] !== undefined,
            `${node.path}: ${index}`,
          );
      const revision = data.files.find(({ kind }) => kind === "revision");
      assert.ok(revision);
      const used = (revision.terms ?? []).map((index) => data.termList[index]);
      assert.ok(used.includes("cascade:revisionOf"), used.join(" "));
      const record = data.files.find(({ kind }) => kind === "record");
      assert.ok(record);
      assert.ok(
        (record.terms ?? []).some((index) =>
          (data.termList[index] ?? "").startsWith("cascade:"),
        ),
        "a record's class is among its terms",
      );
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

  describe("given a pod built from the kit with every kind of handle", () => {
    it("resolves every handle of the kit's records to the one record file the runtime names from its inputs", () => {
      const { data } = alex;
      const handles = Object.keys(data.kit?.handles?.records ?? {});
      assert.ok(handles.length > 20, "the kit gives few handles");
      for (const handle of handles)
        assert.equal(
          data.files.filter((each) => each.handle === handle).length,
          1,
          `${handle} names no record file, or several`,
        );
      for (const handle of ["APP-ALG-PEANUT", "U-IMM-TDAP"])
        assert.equal(
          data.files.find((each) => each.handle === handle)?.kind,
          "record",
          handle,
        );
    });

    it("keeps the members of an entry that are no file of the pod, and the judgments that name them", () => {
      const { data } = alex;
      const profile = data.views
        .flatMap(({ entries }) => entries)
        .find(({ id }) => id.startsWith("clinical/patient-profile.ttl#"));
      assert.ok(profile, "no patient entry");
      assert.deepEqual(profile.members, []);
      assert.equal(profile.others?.length, 3);
      assert.ok(profile.touching.length + profile.within.length > 0);
      for (const judged of [...profile.within, ...profile.touching])
        assert.ok(
          data.files[judged]?.judgment?.others?.some((other) =>
            profile.others?.includes(other),
          ),
          `${data.files[judged]?.path} names none of the entry's members`,
        );
      for (const field of profile.fields) assert.equal(field.members.length, 3);
    });

    it("labels a stored document's bytes with the label of the document that names them", () => {
      const { data } = alex;
      const stored = data.files.filter(({ kind }) => kind === "bytes");
      assert.ok(stored.length > 0, "no bytes are stored");
      for (const node of stored) {
        const named = data.files[node.document ?? -1];
        assert.ok(named?.label, `${node.path} has no document with a label`);
        assert.equal(node.label, named.label, node.path);
      }
    });

    it("gives a materialized view the files its statements name, so that its card agrees with its Turtle", () => {
      const { data } = alex;
      const view = file(data, "clinical/allergies.ttl");
      assert.equal(view.kind, "view");
      assert.ok(view.names.length > 0, "the view names no file");
      for (const named of view.names)
        assert.ok(
          data.files[named]?.namedBy.includes(data.files.indexOf(view)),
          `${data.files[named]?.path} is not named by the view`,
        );
      assert.ok(
        JSON.stringify(data).length <= EXPLORER_BUDGET,
        "the object is over its budget",
      );
    });

    it("has each stored document name the bytes whose hash is its subject", () => {
      const { data } = alex;
      const stored = data.files.filter(({ kind }) => kind === "bytes");
      assert.ok(stored.length > 0, "no bytes are stored");
      for (const bytes of stored) {
        const at = data.files.indexOf(bytes);
        const document = data.files[bytes.document ?? -1];
        assert.ok(document, `${bytes.path} has no document`);
        assert.ok(
          document.names.includes(at),
          `${document.path} does not name ${bytes.path}`,
        );
        assert.ok(bytes.namedBy.includes(bytes.document ?? -1), bytes.path);
      }
    });

    it("names the manifest's thing as the manifest, so the pod has its creation time, and types the manifest and the card", () => {
      const { data } = alex;
      assert.match(data.pod.created ?? "", /^\d{4}-\d\d-\d\dT/);
      assert.ok(data.files[data.pod.manifest]?.types.length);
      assert.ok(data.files[data.pod.card]?.types.length);
    });

    it("tells whether each kit step was performed, apart from whether its row wrote files", () => {
      const { data } = alex;
      const performed = new Map(
        data.kit?.steps.map(({ name, performed }) => [name, performed]),
      );
      for (const name of ["E7", "E9", "M2"])
        assert.equal(performed.get(name), false, name);
      assert.equal(performed.get("E6"), true);
      for (const row of data.log)
        for (const step of row.kitSteps)
          assert.equal(step.performed, performed.get(step.name), step.name);
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

    it("reports a rule list's queryPath that leaves matcher/ as the rule's problem, resolving it as the matcher does", async () => {
      const { data, site } = matching;
      const rule = data.matcherRules.find(({ query }) => query !== undefined);
      assert.ok(rule, "no rule has a query");
      const listed = `runtime/rule-list/${fileStem(rule.version)}.ttl`;
      const changed: Files = {
        iri: vocabulary.files.iri,
        read: async (name) =>
          name === listed
            ? new TextEncoder().encode(
                `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .\n[] a cascade:RuleListRow ; cascade:matcherRule ${rule.rule} ; cascade:queryPath "../questions/pod/How many judgments count.rq" ; cascade:queryHash <${rule.hash}> .`,
              )
            : vocabulary.files.read(name),
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
      const found = altered.matcherRules.find(
        ({ rule: term }) => term === rule.rule,
      );
      assert.equal(found?.by, "path");
      assert.equal(found?.query, undefined);
      assert.match(
        found?.problem ?? "",
        /names no query under queries\/matcher\//,
      );
    });

    it("gives each lens's count of the judgments that count, and the order the build runs its derivations", () => {
      const { data, site } = matching;
      assert.ok(data.lenses.some(({ lens }) => lens === site.options.lens));
      for (const { rows, columns } of data.lenses) {
        assert.ok(rows.length > 0);
        for (const row of rows) {
          assert.equal(row.length, columns.length);
          for (const cell of row)
            assert.ok(
              !cell.startsWith("https://ns.cascadeprotocol.org/"),
              cell,
            );
        }
      }
      assert.ok(
        data.lenses.some(({ rows }) =>
          rows.some((row) => row.some((cell) => cell.startsWith("cascade:"))),
        ),
      );
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

  describe("given the check in scripts/explorer-check.mjs over a built pod", () => {
    const tree = (name: string): string => {
      const folder = join(tmpdir(), `explorer-check-${process.pid}-${name}`);
      rmSync(folder, { recursive: true, force: true });
      for (const [path, bytes] of kit.built) {
        mkdirSync(dirname(join(folder, "tamsin", path)), { recursive: true });
        writeFileSync(join(folder, "tamsin", path), bytes);
      }
      return folder;
    };
    const check = (folder: string) =>
      spawnSync(
        process.execPath,
        [join(ROOT, "scripts/explorer-check.mjs"), "--tree", folder],
        { encoding: "utf8" },
      );
    const rewrite = (
      folder: string,
      change: (data: ExplorerData) => ExplorerData,
    ): void => {
      const path = join(folder, "tamsin", EXPLORER_FILE);
      writeFileSync(
        path,
        JSON.stringify(change(JSON.parse(readFileSync(path, "utf8")))),
      );
    };

    it("passes a pod as built", () => {
      const folder = tree("whole");
      const result = check(folder);
      rmSync(folder, { recursive: true, force: true });
      assert.equal(result.status, 0, result.stderr);
    });

    it("fails a file in the pod that the object does not list", () => {
      const folder = tree("extra");
      writeFileSync(join(folder, "tamsin/pod/records/extra.ttl"), "");
      const result = check(folder);
      rmSync(folder, { recursive: true, force: true });
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /pod\/records\/extra\.ttl|records\/extra\.ttl/,
      );
    });

    it("fails a file the object lists that the pod does not hold", () => {
      const folder = tree("gone");
      const gone = [...kit.built.keys()].find((path) =>
        path.startsWith("pod/records/"),
      ) as string;
      rmSync(join(folder, "tamsin", gone));
      const result = check(folder);
      rmSync(folder, { recursive: true, force: true });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /records\//);
    });

    it("fails a record given the build as its writer, which only the files the build rewrites have", () => {
      const folder = tree("build");
      rewrite(folder, (data) => {
        const at = data.files.findIndex(({ kind }) => kind === "record");
        const record = data.files[at] as ExplorerFile;
        const row = data.log[record.writer as number];
        return {
          ...data,
          files: data.files.map((each, index) =>
            index === at ? { ...each, writer: "build" } : each,
          ),
          log: data.log.map((each) =>
            each === row
              ? { ...each, wrote: each.wrote.filter((index) => index !== at) }
              : each,
          ),
        };
      });
      const result = check(folder);
      rmSync(folder, { recursive: true, force: true });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /the build/);
    });
  });
});

/**
 * A pod's index page is the explorer: a page that holds no data of the pod, the one app every pod shares, and its
 * stylesheet. The page that said how the pod is laid out is still there, as `layout.html`.
 */
describe("The pod explorer's page · explorerPage(), Site.files()", () => {
  const text = (path: string) =>
    new TextDecoder().decode(kit.built.get(path) ?? new Uint8Array());

  it("loads the app and its stylesheet and names the data object it reads", () => {
    const page = text("index.html");
    assert.match(page, /<script src="explorer\.js">/);
    assert.match(page, /<link rel="stylesheet" href="explorer\.css">/);
    assert.match(page, /data-data="explorer\.json"/);
  });

  it("holds no statement of the pod, so that one app serves every pod", () => {
    assert.ok(!text("explorer.js").includes(kit.site.pod.address));
    assert.ok(!text("index.html").includes("pod/records/"));
  });

  it("keeps the pod's layout page under its own name, linked from the explorer's header", () => {
    assert.ok(kit.built.has("layout.html"));
    assert.match(text("index.html"), /<a href="layout\.html">/);
    assert.match(text("layout.html"), /How this pod is laid out/);
  });

  it("writes an app that parses, with no template placeholder left in it", () => {
    assert.doesNotThrow(() => new Function(text("explorer.js")));
    assert.ok(!text("explorer.js").includes("${"));
  });
});
