import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { type Files, MemoryFiles, readText } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, type Triple } from "../src/rdf.js";
import {
  CODES,
  linesAbout,
  References,
  rowsByCode,
  tableTerms,
  type TableTerms,
} from "../src/references.js";
import { CASCADE, Refusal } from "../src/step.js";
import { vocabulary } from "./vocabulary.js";

const RECORDS = "ontologies/cascade.ttl";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const URI_SPACE = "http://rdfs.org/ns/void#uriSpace";
const PAGE_TEMPLATE = `${CASCADE}codePageUrlTemplate`;
const newStore = (): OxigraphStore => new OxigraphStore();

/**
 * Reference tables are a folder: `references.ttl`, the list of each series and its versions, and one file of rows for each
 * version. `References` reads them for the matcher, and `tableTerms` reads from the vocabulary which code systems there
 * are and how each kind of table is found by code.
 */
describe("Reading reference tables from a folder · References.of(), References.rows(), tableTerms(), linesAbout()", () => {
  describe("References.rows(version)", () => {
    const rules = "f32ebeea-4ed7-4da7-b08c-031dc619538e";
    const folder = "runtime/scripted-input/hana/tables/app/";
    let files: Awaited<ReturnType<typeof vocabulary>>;
    let empty: References;
    let shared: References;
    let story: MemoryFiles;

    const ruleCount = async (rows: Promise<Triple[]>) =>
      new Graph(await rows).subjects(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        iri(`${CASCADE}RuleListRow`),
      ).length;
    const refusal = (pattern: RegExp) => (error: unknown) =>
      error instanceof Refusal && pattern.test(error.message);
    const references = () => References.of(story, folder, newStore, files);

    before(async () => {
      files = await vocabulary();
      const source = new MemoryFiles("https://story.example/");
      await source.write(
        "references/references.ttl",
        new TextEncoder().encode(""),
      );
      empty = await References.of(source, "references/", newStore);
      story = new MemoryFiles(files.iri);
      await story.write(
        `${folder}references.ttl`,
        (await files.read(`${folder}references.ttl`)) ?? new Uint8Array(),
      );
      shared = await references();
    });

    it("throws Refusal for a version whose name gives no file name", async () => {
      for (const version of [
        "https://example.org/tables/v2",
        "ni:///sha-256;not*base64",
      ])
        await assert.rejects(empty.rows(version), refusal(/./), version);
    });

    it("throws Refusal, naming the folder, for a version the folder has no file of", async () => {
      await assert.rejects(
        shared.rows(`urn:uuid:${rules.replace("f", "e")}`),
        refusal(
          /runtime\/scripted-input\/hana\/tables\/app\/ holds no rows for/,
        ),
      );
    });

    it("returns a rule list version's rows from the vocabulary when the folder has no file of it", async () => {
      assert.ok(
        (await ruleCount((await references()).rows(`urn:uuid:${rules}`))) > 0,
      );
    });

    it("returns the folder's own file of that version when it has one", async () => {
      const own = new MemoryFiles(files.iri);
      for (const path of await story.list(""))
        await own.write(path, (await story.read(path)) ?? new Uint8Array());
      await own.write(`${folder}${rules}.ttl`, new TextEncoder().encode(""));
      assert.equal(
        await ruleCount(
          (await References.of(own, folder, newStore, files)).rows(
            `urn:uuid:${rules}`,
          ),
        ),
        0,
      );
    });
  });

  describe("linesAbout(text, subject)", () => {
    it("returns the subject's lines of sorted N-Triples, wherever they stand, and none for a subject with no line", () => {
      const subjects = ["a", "a/b", "ab", "b", "c"];
      const lines = subjects
        .flatMap((subject) => [
          `<${subject}> <p> "1" .`,
          `<${subject}> <q> "2" .`,
        ])
        .sort();
      for (const text of [`${lines.join("\n")}\n`, lines.join("\n")])
        for (const subject of [...subjects, "", "a/", "aa", "d", "0"])
          assert.deepEqual(
            linesAbout(text, subject),
            lines.filter((line) => line.startsWith(`<${subject}> `)),
            subject,
          );
    });
  });

  describe("tableTerms(vocabulary)", () => {
    let registered: {
      iri: string;
      label: string | undefined;
      uriSpace: string | undefined;
      pageTemplate?: string;
    }[];
    let terms: TableTerms;

    before(async () => {
      const files = await vocabulary();
      const registry = new Graph(
        await newStore().parse(
          await readText(files, RECORDS),
          files.iri + RECORDS,
        ),
      );
      registered = registry
        .subjects(
          "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          iri(`${CASCADE}CodeSystem`),
        )
        .map((system) => {
          const template = registry.objects(system, PAGE_TEMPLATE)[0]?.value;
          return {
            iri: system.value,
            label: registry.objects(system, RDFS_LABEL)[0]?.value,
            uriSpace: registry.objects(system, URI_SPACE)[0]?.value,
            ...(template && { pageTemplate: template }),
          };
        });
      terms = await tableTerms(files, newStore);
    });

    it("returns a code system for each one the vocabulary registers, with its label and its URI space", () => {
      assert.ok(registered.length > 0);
      assert.deepEqual(
        [...terms.codeSystems].sort((a, b) => (a.iri < b.iri ? -1 : 1)),
        registered.sort((a, b) => (a.iri < b.iri ? -1 : 1)),
      );
    });

    it("returns `uriSpaces` in the order of `codeSystems`", () => {
      assert.deepEqual(
        terms.uriSpaces,
        terms.codeSystems.map(({ uriSpace }) => uriSpace),
      );
    });

    it("returns `pageTemplate` only for a code system that has one", () => {
      assert.match(
        terms.codeSystems.find(({ iri }) => iri === `${CASCADE}ClinVar`)
          ?.pageTemplate ?? "",
        /\{code\}/,
      );
      assert.equal(
        terms.codeSystems.find(({ iri }) => iri === `${CASCADE}HGVS`)
          ?.pageTemplate,
        undefined,
      );
    });

    it("rejects with an Error that is no Refusal for a code system with no label, with no URI space, or with a page template that lacks `{code}`", async () => {
      const system = (what: string): string =>
        `@prefix cascade: <${CASCADE}> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix void: <http://rdfs.org/ns/void#> .
cascade:Broken a cascade:CodeSystem ; ${what} .`;
      for (const [broken, why] of [
        [system('void:uriSpace "urn:test:broken/"'), "no label"],
        [system('rdfs:label "Broken"@en'), "no URI space"],
        [
          system(
            'rdfs:label "Broken"@en ; void:uriSpace "urn:test:broken/" ; cascade:codePageUrlTemplate "https://example.org/"',
          ),
          "a page template with no {code}",
        ],
      ] as const) {
        const files = new MemoryFiles("urn:test:vocabulary/");
        await files.write(RECORDS, new TextEncoder().encode(broken));
        await assert.rejects(
          tableTerms(files, newStore),
          (error: unknown) =>
            error instanceof Error &&
            !(error instanceof Refusal) &&
            error.message.includes(`${CASCADE}Broken`),
          why,
        );
      }
    });
  });
});

const CVX = "http://hl7.org/fhir/sid/cvx/";
const OWL = "http://www.w3.org/2002/07/owl#";
const SERIES = {
  groups: "urn:uuid:11111111-1111-4111-8111-111111111111",
  names: "urn:uuid:22222222-2222-4222-8222-222222222222",
  substances: "urn:uuid:33333333-3333-4333-8333-333333333333",
};
const VERSION = {
  groups: "urn:uuid:11111111-1111-4111-8111-1111111111a1",
  names: "urn:uuid:22222222-2222-4222-8222-2222222222a1",
  substances: "urn:uuid:33333333-3333-4333-8333-3333333333a1",
};
const stem = (version: string): string => version.slice("urn:uuid:".length);
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const series = (name: keyof typeof SERIES, kind: string): string =>
  `<${SERIES[name]}> a cascade:ReferenceSeries ; rdfs:label "${name}" ; cascade:tableKind cascade:${kind} ; cascade:defaultTableVersion <${VERSION[name]}> .
<${VERSION[name]}> a prov:Entity ; prov:specializationOf <${SERIES[name]}> ; pav:version "1" .`;

const INDEX = `@prefix cascade: <${CASCADE}> . @prefix prov: <http://www.w3.org/ns/prov#> . @prefix pav: <http://purl.org/pav/> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
${series("groups", "VaccineGroups")}
${series("names", "CodeNames")}
${series("substances", "SubstanceIngredients")}`;

/** Three rows that map a vaccine each to a group, sorted N-Triples: found by their source. */
const GROUP_ROWS = `${[140, 141, 150]
  .map(
    (code, at) =>
      `<urn:row:${at}> <${OWL}annotatedSource> <${CVX}${code}> .\n<urn:row:${at}> <${OWL}annotatedTarget> <urn:group:flu> .`,
  )
  .join("\n")}\n`;
/** Three rows each naming one code, sorted N-Triples: found by their own code. */
const NAME_ROWS = `${[140, 141, 150]
  .map((code) => `<${CVX}${code}> <${RDFS_LABEL}> "vaccine ${code}" .`)
  .join("\n")}\n`;
/** Three rows that map a substance each to another, found by their source or their target. */
const SUBSTANCE_ROWS = `${[
  ["a", "x"],
  ["b", "y"],
  ["c", "z"],
]
  .map(
    ([from, to], at) =>
      `<urn:sub:${at}> <${OWL}annotatedSource> <urn:code:${from}> .\n<urn:sub:${at}> <${OWL}annotatedTarget> <urn:code:${to}> .`,
  )
  .join("\n")}\n`;

const subjectsOf = (rows: readonly Triple[]): string[] =>
  [...new Set(rows.map(([subject]) => subject.value))].sort();

/**
 * A pod's records are compared with tables of hundreds of thousands of rows, so a pod reads from each version only the
 * rows its own codes find. Asked for a version's rows by a set of codes, `References.rows` returns those rows and reads no
 * more of the folder than it must.
 */
describe("Reading only the rows a pod's codes find · References.rows(), rowsByCode()", () => {
  let terms: TableTerms;
  let groupIndex: Uint8Array;
  /** The folder of the three series, with a code index beside the vaccine groups' version. */
  let folder: MemoryFiles;

  /** What `rows` is asked for: these codes, found as `terms` say. */
  const find = (...codes: string[]) => ({ codes: new Set(codes), terms });
  /** A copy of the folder, which a leaf may change. */
  const copy = async (): Promise<MemoryFiles> => {
    const made = new MemoryFiles(folder.iri);
    for (const path of await folder.list(""))
      await made.write(path, (await folder.read(path)) ?? new Uint8Array());
    return made;
  };
  /** The tables over the files, and the paths the tables read. */
  const over = (files: Files, reads: string[] = []) =>
    References.of(
      {
        iri: files.iri,
        list: (path) => files.list(path),
        write: (path, bytes) => files.write(path, bytes),
        read: (path) => {
          reads.push(path);
          return files.read(path);
        },
      },
      "",
      newStore,
      undefined,
      { canonical: true },
    );

  before(async () => {
    terms = await tableTerms(await vocabulary(), newStore);
    const found = terms.foundBy.get(`${CASCADE}VaccineGroups`) ?? [];
    const index = rowsByCode(
      await newStore().parse(GROUP_ROWS, "urn:x"),
      found,
    );
    assert.ok(index);
    groupIndex = index;
    folder = new MemoryFiles("https://tables.example/");
    await folder.write("references.ttl", enc(INDEX));
    await folder.write(`${stem(VERSION.groups)}.ttl`, enc(GROUP_ROWS));
    await folder.write(`${stem(VERSION.groups)}${CODES}`, groupIndex);
    await folder.write(`${stem(VERSION.names)}.ttl`, enc(NAME_ROWS));
    await folder.write(`${stem(VERSION.substances)}.ttl`, enc(SUBSTANCE_ROWS));
  });

  describe("rowsByCode(rows, foundBy)", () => {
    it("returns an index from each code to the rows that name it by the kind's property", () => {
      assert.deepEqual(JSON.parse(new TextDecoder().decode(groupIndex)), {
        foundBy: [`${OWL}annotatedSource`],
        rows: {
          [`${CVX}140`]: ["urn:row:0"],
          [`${CVX}141`]: ["urn:row:1"],
          [`${CVX}150`]: ["urn:row:2"],
        },
      });
    });

    it("returns no index for rows found by their own code alone", async () => {
      assert.equal(
        rowsByCode(await newStore().parse(NAME_ROWS, "urn:x"), [
          `${CASCADE}RowSubject`,
        ]),
        undefined,
      );
    });
  });

  describe("given a version whose rows are found by a property, as a vaccine group's are by its vaccine", () => {
    it("returns the rows that map the code asked, and no other row", async () => {
      const references = await over(folder);
      assert.deepEqual(
        subjectsOf(await references.rows(VERSION.groups, find(`${CVX}141`))),
        ["urn:row:1"],
      );
      assert.equal(subjectsOf(await references.rows(VERSION.groups)).length, 3);
    });

    it("returns every row when the index beside the version cannot be used", async () => {
      const unusable: [string, string, Uint8Array][] = [
        ["an index that is unreadable", VERSION.groups, enc("{")],
        [
          "an index built for no property",
          VERSION.groups,
          enc(JSON.stringify({ foundBy: [], rows: {} })),
        ],
      ];
      const substances = rowsByCode(
        await newStore().parse(SUBSTANCE_ROWS, "urn:x"),
        [`${OWL}annotatedSource`],
      );
      assert.ok(substances);
      unusable.push([
        "an index built for fewer properties than the kind is found by",
        VERSION.substances,
        substances,
      ]);
      for (const [input, version, bytes] of unusable) {
        const files = await copy();
        await files.write(`${stem(version)}${CODES}`, bytes);
        const code =
          version === VERSION.substances ? "urn:code:y" : `${CVX}141`;
        const references = await over(files);
        assert.deepEqual(
          subjectsOf(await references.rows(version, find(code))),
          subjectsOf(await references.rows(version)),
          input,
        );
      }
    });
  });

  describe("given a version whose rows are found by their own code, as a name's are", () => {
    let afterFirst: { subjects: string[]; read: string[] };
    let everything: string[];
    let everyCode: string[];
    let noRows: readonly Triple[];
    let readAgain: string[];

    before(async () => {
      const names = VERSION.names;
      const own = stem(names);
      const reads: string[] = [];
      const references = await over(folder, reads);
      const asked = find(`${CVX}141`);
      const started = reads.length;
      afterFirst = {
        subjects: subjectsOf(await references.rows(names, asked)),
        read: reads.slice(started).filter((path) => path.startsWith(own)),
      };
      const all = await references.rows(names);
      everything = subjectsOf(all);
      everyCode = subjectsOf(
        await references.rows(
          names,
          find(...subjectsOf(all), "urn:test:no-rows"),
        ),
      );
      noRows = await references.rows(names, find("urn:test:x"));
      const readsBefore = reads.length;
      await references.rows(names, asked);
      await references.rows(names, asked);
      readAgain = reads
        .slice(readsBefore)
        .filter((path) => path.startsWith(own));
    });

    it("returns the code's rows, reading the version's file once and no index", () => {
      assert.deepEqual(afterFirst.subjects, [`${CVX}141`]);
      assert.deepEqual(afterFirst.read, [`${stem(VERSION.names)}.ttl`]);
    });

    it("returns every row when every code is asked, and none for a code with no row", () => {
      assert.deepEqual(everyCode, everything, "every code");
      assert.deepEqual(noRows, [], "a code with no row");
    });

    it("reads no file at a second call", () => {
      assert.deepEqual(readAgain, []);
    });

    it("ignores an index left beside the version", async () => {
      const files = await copy();
      await files.write(
        `${stem(VERSION.names)}${CODES}`,
        enc(JSON.stringify({ foundBy: [`${CASCADE}RowSubject`], rows: {} })),
      );
      assert.deepEqual(
        subjectsOf(
          await (await over(files)).rows(VERSION.names, find(`${CVX}141`)),
        ),
        [`${CVX}141`],
      );
    });

    it("returns every row of a version written as Turtle and not as sorted lines", async () => {
      const files = await copy();
      await files.write(
        `${stem(VERSION.names)}.ttl`,
        enc(
          `@prefix cvx: <${CVX}> .\ncvx:141 <${RDFS_LABEL}> "vaccine 141" .\ncvx:140 <${RDFS_LABEL}> "vaccine 140" .`,
        ),
      );
      const found = subjectsOf(
        await (await over(files)).rows(VERSION.names, find(`${CVX}141`)),
      );
      assert.deepEqual(found, [`${CVX}140`, `${CVX}141`]);
    });
  });
});
