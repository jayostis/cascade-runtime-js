import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { type Files, MemoryFiles } from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { agentFiles, SEARCH_FILE, type SearchRow } from "../src/agents.js";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { PagesContext } from "../src/hub/context.js";
import { bridgeTermsSection } from "../src/hub/bridge-terms.js";
import { termHref, termId, termPage } from "../src/links.js";
import { buildTree } from "../src/sections.js";
import { termsSection } from "../src/hub/terms.js";
import {
  BRIDGE_SHAPES_PAGE,
  BRIDGE_TERMS_PAGE,
  bridgeTermPages,
  bridgeTermReference,
  bridgeTermShapes,
  queryFacts,
  TERMS_PAGE,
  termPages,
  termReference,
} from "../src/term-reference.js";
import { readPage } from "./page.js";

const TREE = "https://github.com/jayostis/cascade-bridge-spec/tree/abc123/";
const BLOB = "https://github.com/jayostis/cascade-bridge-spec/blob/abc123/";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const ADAPTER = `${BRIDGE}Adapter`;
const PROFILE = `${BRIDGE}Profile`;
const REQUIRES = `${BRIDGE}requiresProfile`;
const SPARQL = `${BRIDGE}sparql-1.1`;
const LIFT_TEST = `${BRIDGE}LiftTest`;
const FOREIGN = "http://www.w3.org/ns/oa#hasSource";

const ONTOLOGY = `@prefix bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#> .
@prefix oa: <http://www.w3.org/ns/oa#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<https://ns.cascadeprotocol.org/bridge/v1-draft#> a owl:Ontology .

bridge:Adapter a owl:Class ;
    rdfs:label "Adapter"@en ;
    rdfs:comment "The root entity of an adapter package's RO-Crate."@en .

bridge:Profile a owl:Class ;
    rdfs:label "Profile"@en .

bridge:sparql-1.1 a bridge:Profile ;
    rdfs:label "sparql-1.1"@en .

bridge:LiftTest a owl:Class ;
    rdfs:label "lift test"@en ;
    rdfs:comment "A test of a Bridge: lift bridge:input and compare the graph."@en .

bridge:requiresProfile a owl:ObjectProperty ;
    rdfs:label "requires profile"@en ;
    rdfs:domain bridge:Adapter ;
    rdfs:range bridge:Profile .

oa:hasSource a owl:ObjectProperty ;
    rdfs:isDefinedBy <http://www.w3.org/ns/oa#> .
`;

const SHAPES = `@prefix bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

bridge:AdapterShape a sh:NodeShape ;
    sh:targetClass bridge:Adapter ;
    sh:property [
        sh:path bridge:requiresProfile ;
        sh:class bridge:Profile ;
        sh:message "A required profile is a bridge:Profile."@en
    ] .
`;

const MORE_SHAPES = `@prefix bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

bridge:LiftTestShape a sh:NodeShape ;
    sh:targetClass bridge:LiftTest ;
    sh:nodeKind sh:BlankNodeOrIRI .
`;

const PROPERTIES = new Set([REQUIRES, FOREIGN]);

const text = (value: string) => new TextEncoder().encode(value);

async function fixture(): Promise<Files> {
  const files = new MemoryFiles(TREE);
  await files.write("vocab/bridge.ttl", text(ONTOLOGY));
  await files.write("shapes/bridge.shapes.ttl", text(SHAPES));
  await files.write("shapes/facts.shapes.ttl", text(MORE_SHAPES));
  return files;
}

/** The markup of the page of the term with the IRI. */
function entry(pages: ReadonlyMap<string, string>, iri: string): string {
  const found = pages.get(termPage(iri, PROPERTIES.has(iri)));
  assert.ok(found !== undefined, `no page for ${iri}`);
  return found;
}

/**
 * The Bridge's own vocabulary has a page beside the term reference, and a page for each term `vocab/bridge.ttl` of
 * cascade-bridge-spec declares, with the shapes that use it, made with the component the term reference is made with.
 */
describe("The Bridge's terms · bridgeTermReference(), bridgeTermsSection", () => {
  let page: string;
  let pages: ReadonlyMap<string, string>;

  before(async () => {
    page = await bridgeTermReference(await fixture(), PLAIN);
    pages = await bridgeTermPages(await fixture(), PLAIN, new Set());
  });

  describe("`bridgeTermPages()`", () => {
    it("gives each term of `bridge.ttl` a page, and a row of the index at its old anchor, a term copied from elsewhere too", () => {
      const { ids } = readPage(page);
      for (const iri of [
        ADAPTER,
        PROFILE,
        REQUIRES,
        SPARQL,
        LIFT_TEST,
        FOREIGN,
      ]) {
        assert.ok(ids.has(termId(iri)), `no anchor for ${iri}`);
        assert.ok(
          pages.has(termPage(iri, PROPERTIES.has(iri))),
          `no page for ${iri}`,
        );
      }
      assert.ok(pages.has("bridge/Adapter.html"));
      assert.ok(!ids.has(BRIDGE), "the ontology is no entry");
    });

    it("leaves out the terms it is told another page describes", async () => {
      const left = await bridgeTermPages(
        await fixture(),
        PLAIN,
        new Set([FOREIGN]),
      );
      assert.ok(!left.has(termPage(FOREIGN, true)));
      assert.ok(left.has(termPage(ADAPTER)));
    });

    it("links back to the Bridge's index, not the term reference's", () => {
      const { hrefs } = readPage(entry(pages, ADAPTER));
      assert.ok(hrefs.includes("../bridge.html"));
      assert.ok(!hrefs.includes("../index.html"));
    });

    it("shows a term's label, comment, domain and range, the domain and range as links to their entries", () => {
      const shown = readPage(entry(pages, REQUIRES));
      assert.match(shown.said, /requires profile/);
      assert.match(shown.said, /owl:ObjectProperty/);
      assert.ok(
        shown.hrefs.includes(termHref(ADAPTER, "../../")),
        "its domain",
      );
      assert.ok(shown.hrefs.includes(termHref(PROFILE, "../../")), "its range");
      assert.match(
        readPage(entry(pages, ADAPTER)).said,
        /The root entity of an adapter package's RO-Crate\./,
      );
    });

    it("shows the shapes of any of the Bridge's shape files that use a term, with their messages", () => {
      const { said } = readPage(entry(pages, REQUIRES));
      assert.match(said, /bridge:AdapterShape/);
      assert.match(said, /A required profile is a bridge:Profile\./);
      assert.match(
        readPage(entry(pages, LIFT_TEST)).said,
        /bridge:LiftTestShape checks each bridge:LiftTest/,
      );
    });

    it("shows a class no shape checks with no shape", () => {
      assert.doesNotMatch(
        readPage(entry(pages, PROFILE)).said,
        /shape|Shapes/i,
      );
    });

    it("lists the terms of other vocabularies the Bridge declares apart from its own", () => {
      const part = page.split('id="copied"')[1] ?? "";
      assert.ok(part.includes(`id="${termId(FOREIGN)}"`));
      assert.ok(
        !(page.split('id="copied"')[0] ?? "").includes(
          `id="${termId(FOREIGN)}"`,
        ),
      );
    });

    it("names no query and no rule, which the Bridge's vocabulary has none of", () => {
      for (const html of [page, ...pages.values()])
        assert.doesNotMatch(html, /<dt>(?:Queries|Rules)<\/dt>/);
    });

    it("links the source files at the commit it was read at", () => {
      assert.ok(page.includes(TREE));
      assert.ok(readPage(page).hrefs.includes(`${BLOB}vocab/bridge.ttl`));
    });

    it("links the term reference, which links it back", async () => {
      assert.ok(readPage(page).hrefs.includes("index.html"));
      const files = new MemoryFiles(
        "https://github.com/jayostis/cascade-vocabulary/tree/abc123/",
      );
      await files.write(
        "ontologies/cascade.ttl",
        text(
          "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .\n",
        ),
      );
      await files.write(
        "ontologies/cascade.shapes.ttl",
        text("@prefix sh: <http://www.w3.org/ns/shacl#> .\n"),
      );
      await files.write("runtime/pod-layout.ttl", text("\n"));
      assert.ok(
        readPage(await termReference(files, PLAIN)).hrefs.includes(
          "bridge.html",
        ),
      );
    });
  });

  describe("given shapes named with relative IRIs in two files", () => {
    const RELATIVE = (name: string, target: string, extra = "") =>
      `@prefix bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

<#${name}> a sh:NodeShape ;${extra}
    sh:targetClass bridge:${target} .
`;
    let relative: string;
    let index: string;
    let shapes: string;

    before(async () => {
      const files = new MemoryFiles(TREE);
      await files.write("vocab/bridge.ttl", text(ONTOLOGY));
      await files.write(
        "shapes/bridge.shapes.ttl",
        text(RELATIVE("Act", "Adapter")),
      );
      await files.write(
        "shapes/facts.shapes.ttl",
        text(RELATIVE("Fact", "LiftTest", "\n    sh:prefixes <> ;")),
      );
      await files.write(
        "shapes/loose.shapes.ttl",
        text(RELATIVE("Loose", "NoEntry")),
      );
      index = await bridgeTermReference(files, PLAIN);
      shapes = await bridgeTermShapes(files, PLAIN);
      relative = [
        index,
        shapes,
        ...(await bridgeTermPages(files, PLAIN, new Set())).values(),
      ].join("\n");
    });

    it("names each by its file and its own name, at an anchor of that name on the page of the class it checks", () => {
      const { ids, said } = readPage(relative);
      assert.ok(ids.has("bridge.shapes.ttl#Act"));
      assert.ok(ids.has("facts.shapes.ttl#Fact"));
      assert.match(said, /facts\.shapes\.ttl#Fact checks each bridge:LiftTest/);
      assert.match(said, /bridge\.shapes\.ttl#Act checks each bridge:Adapter/);
    });

    it("keeps each shape's anchor on the index, on the row of the class it is at home on", () => {
      const { ids } = readPage(index);
      assert.ok(ids.has("bridge.shapes.ttl#Act"));
      assert.ok(ids.has("facts.shapes.ttl#Fact"));
    });

    it("puts the one no class has a row for on the shapes' page, which the index links, and not on the index", () => {
      assert.ok(readPage(shapes).ids.has("loose.shapes.ttl#Loose"));
      assert.ok(!readPage(index).ids.has("loose.shapes.ttl#Loose"));
      assert.ok(readPage(index).hrefs.includes("bridge-shapes/index.html"));
      assert.doesNotMatch(index, /class="shape"/);
    });

    it("shows no address of the repository's tree for a shape, nor for `sh:prefixes <>`", () => {
      assert.equal(relative.split(`${TREE}shapes/`).length, 1);
      assert.match(readPage(relative).said, /prefixes facts\.shapes\.ttl/);
    });
  });

  describe("given an unhomed shape named with an absolute IRI", () => {
    it("keeps its full IRI under its heading", async () => {
      const files = new MemoryFiles(TREE);
      await files.write("vocab/bridge.ttl", text(ONTOLOGY));
      await files.write(
        "shapes/loose.shapes.ttl",
        text(`@prefix bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

bridge:LooseShape a sh:NodeShape ;
    sh:targetClass bridge:NoEntry .
`),
      );
      const page = await bridgeTermShapes(files, PLAIN);
      assert.match(
        page,
        /<p class="iri">https:\/\/ns\.cascadeprotocol\.org\/bridge\/v1-draft#LooseShape<\/p>/,
      );
    });
  });

  describe("`bridgeTermsSection`", () => {
    /** A vocabulary that declares `oa:hasSource` when `declaring`, which the Bridge's ontology also declares. */
    async function cascade(declaring: boolean): Promise<Files> {
      const vocabulary = new MemoryFiles(
        "https://github.com/jayostis/cascade-vocabulary/tree/abc123/",
      );
      await vocabulary.write(
        "ontologies/cascade.ttl",
        text(`@prefix oa: <http://www.w3.org/ns/oa#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .
${declaring ? "oa:hasSource a owl:ObjectProperty .\n" : ""}`),
      );
      await vocabulary.write(
        "ontologies/cascade.shapes.ttl",
        text("@prefix sh: <http://www.w3.org/ns/shacl#> .\n"),
      );
      await vocabulary.write("runtime/pod-layout.ttl", text("\n"));
      return vocabulary;
    }

    async function built(declaring: boolean) {
      const files = await fixture();
      const vocabulary = await cascade(declaring);
      const ctx = {
        root: "",
        log: () => undefined,
        bridgeSpec: async () => ({ files, commit: "abc123" }),
        vocabulary: async () => ({ files: vocabulary, builtFrom: [], at: "" }),
        chrome: PLAIN,
      } as unknown as PagesContext;
      const { tree } = await buildTree({
        sections: [termsSection, bridgeTermsSection],
        ctx,
        front: (rows) => hubFiles([], rows, PLAIN),
        finishers: [agentFiles],
      });
      const rows = JSON.parse(
        new TextDecoder().decode(tree.get(SEARCH_FILE)),
      ) as SearchRow[];
      return { tree, rows };
    }

    let tree: ReadonlyMap<string, Uint8Array>;
    let rows: SearchRow[];

    before(async () => {
      ({ tree, rows } = await built(false));
    });

    it("writes the page at `terms/bridge.html`, beside the term reference's", () => {
      assert.equal(BRIDGE_TERMS_PAGE, "terms/bridge.html");
      assert.ok(tree.has(BRIDGE_TERMS_PAGE));
      assert.notEqual(BRIDGE_TERMS_PAGE, TERMS_PAGE);
    });

    it("writes the page of the shapes other shapes use at `terms/bridge-shapes/`, beside the term reference's own", () => {
      assert.equal(BRIDGE_SHAPES_PAGE, "terms/bridge-shapes/index.html");
      assert.ok(tree.has(BRIDGE_SHAPES_PAGE));
      assert.ok(tree.has("terms/shapes/index.html"));
    });

    it("links it from the front page", () => {
      const front = readPage(new TextDecoder().decode(tree.get(FRONT_PAGE)));
      assert.ok(front.hrefs.includes(BRIDGE_TERMS_PAGE));
    });

    it("writes a page for each of its terms, and lists each in `search.json` as a term at its page", () => {
      const terms = rows
        .filter(({ kind }) => kind === "term")
        .map(({ path }) => path);
      assert.ok(terms.includes("terms/bridge/Adapter.html"));
      assert.ok(terms.includes("terms/bridge/properties/requiresProfile.html"));
      assert.ok(terms.includes("terms/oa/properties/hasSource.html"));
      for (const path of terms) assert.ok(tree.has(path), path);
    });

    it("lists a term's name and its label in `search.json`", () => {
      const adapter = rows.find(
        ({ path }) => path === "terms/bridge/Adapter.html",
      );
      assert.equal(adapter?.title, "bridge:Adapter");
      assert.equal(adapter?.label, "Adapter");
    });

    it("lists the page itself in `llms.txt`", () => {
      assert.match(
        new TextDecoder().decode(tree.get("llms.txt")),
        /terms\/bridge\.html/,
      );
    });

    it("writes no page for a term the term reference describes, so that page is the one answer for it", async () => {
      const both = await built(true);
      const paths = both.rows
        .filter(({ kind }) => kind === "term")
        .map(({ path }) => path);
      assert.equal(
        paths.filter((path) => path === "terms/oa/properties/hasSource.html")
          .length,
        1,
      );
      assert.ok(paths.includes("terms/bridge/Adapter.html"));
      assert.match(
        new TextDecoder().decode(
          both.tree.get("terms/oa/properties/hasSource.html"),
        ),
        /Cascade terms/,
      );
    });
  });

  describe("given the Bridge's vocabulary itself", () => {
    const SPEC = join(
      findRoot(dirname(fileURLToPath(import.meta.url))),
      "..",
      "cascade-bridge-spec",
    );

    it("writes no two pages of the vocabulary's and the Bridge's at paths that differ only by case, when the checkouts are beside this one", async (t) => {
      const root = findRoot(dirname(fileURLToPath(import.meta.url)));
      let bridge: MemoryFiles;
      let vocabulary: Files;
      try {
        ({ files: vocabulary } = await localVocabulary(root));
        bridge = new MemoryFiles(TREE);
        await bridge.write(
          "vocab/bridge.ttl",
          text(await readFile(join(SPEC, "vocab", "bridge.ttl"), "utf8")),
        );
        for (const name of await readdir(join(SPEC, "shapes")))
          if (name.endsWith(".shapes.ttl"))
            await bridge.write(
              `shapes/${name}`,
              text(await readFile(join(SPEC, "shapes", name), "utf8")),
            );
      } catch {
        t.skip(
          "no cascade-vocabulary and cascade-bridge-spec beside this checkout",
        );
        return;
      }
      const { terms } = await queryFacts(vocabulary);
      const paths = [
        ...(await termPages(vocabulary, PLAIN)).keys(),
        ...(await bridgeTermPages(bridge, PLAIN, terms)).keys(),
      ];
      assert.ok(paths.length > 600, `${paths.length} pages`);
      const seen = new Map<string, string>();
      for (const path of paths) {
        const other = seen.get(path.toLowerCase());
        assert.equal(other, undefined, `${path} and ${other}`);
        seen.set(path.toLowerCase(), path);
      }
    });

    it("gives every term of `bridge.ttl` an anchor, when the checkout is beside this one", async (t) => {
      let source: string;
      try {
        source = await readFile(join(SPEC, "vocab", "bridge.ttl"), "utf8");
      } catch {
        t.skip("no cascade-bridge-spec beside this checkout");
        return;
      }
      const files = new MemoryFiles(TREE);
      await files.write("vocab/bridge.ttl", text(source));
      for (const name of await readdir(join(SPEC, "shapes")))
        if (name.endsWith(".shapes.ttl"))
          await files.write(
            `shapes/${name}`,
            text(await readFile(join(SPEC, "shapes", name), "utf8")),
          );
      const { ids } = readPage(await bridgeTermReference(files, PLAIN));
      const declared = [
        ...source.matchAll(/^(bridge:[A-Za-z0-9_.-]+)\s+a\s/gm),
      ].map(([, name]) => name ?? "");
      assert.ok(declared.length > 100);
      assert.deepEqual(
        declared.filter((name) => !ids.has(name)),
        [],
      );
    });
  });
});
