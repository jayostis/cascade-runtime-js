import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { type Files, MemoryFiles } from "@cascade-runtime/runtime";
import { findRoot } from "@cascade-runtime/runtime/node";
import { agentFiles, SEARCH_FILE, type SearchRow } from "../src/agents.js";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { PagesContext } from "../src/hub/context.js";
import { bridgeTermsSection } from "../src/hub/bridge-terms.js";
import { termHref, termId } from "../src/links.js";
import { buildTree, type Section } from "../src/sections.js";
import {
  BRIDGE_TERMS_PAGE,
  bridgeTermReference,
  TERMS_PAGE,
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

const text = (value: string) => new TextEncoder().encode(value);

async function fixture(): Promise<Files> {
  const files = new MemoryFiles(TREE);
  await files.write("vocab/bridge.ttl", text(ONTOLOGY));
  await files.write("shapes/bridge.shapes.ttl", text(SHAPES));
  await files.write("shapes/facts.shapes.ttl", text(MORE_SHAPES));
  return files;
}

/** The markup of the entry whose heading carries the id. */
function entry(page: string, id: string): string {
  const found = page
    .split('<section class="term"')
    .slice(1)
    .map((part) => part.split("</section>")[0] ?? "")
    .find((part) => part.includes(` id="${id}"`));
  assert.ok(found !== undefined, `no entry has the id ${id}`);
  return found;
}

/**
 * The Bridge's own vocabulary has a page beside the term reference: an entry for each term `vocab/bridge.ttl` of
 * cascade-bridge-spec declares, and the Bridge's shapes that use it, with the component the term reference is made with.
 */
describe("The Bridge's terms · bridgeTermReference(), bridgeTermsSection", () => {
  let page: string;

  before(async () => {
    page = await bridgeTermReference(await fixture(), PLAIN);
  });

  describe("`bridgeTermReference()`", () => {
    it("gives each term of `bridge.ttl` an entry at an anchor of its own, a term copied from elsewhere too", () => {
      const { ids } = readPage(page);
      for (const iri of [
        ADAPTER,
        PROFILE,
        REQUIRES,
        SPARQL,
        LIFT_TEST,
        FOREIGN,
      ])
        assert.ok(ids.has(termId(iri)), `no anchor for ${iri}`);
      assert.ok(!ids.has(BRIDGE), "the ontology is no entry");
    });

    it("shows a term's label, comment, domain and range, the domain and range as links to their entries", () => {
      const shown = readPage(entry(page, termId(REQUIRES)));
      assert.match(shown.said, /requires profile/);
      assert.match(shown.said, /owl:ObjectProperty/);
      assert.ok(shown.hrefs.includes(termHref(ADAPTER, "")), "its domain");
      assert.ok(shown.hrefs.includes(termHref(PROFILE, "")), "its range");
      assert.match(
        readPage(entry(page, termId(ADAPTER))).said,
        /The root entity of an adapter package's RO-Crate\./,
      );
    });

    it("shows the shapes of any of the Bridge's shape files that use a term, with their messages", () => {
      const { said } = readPage(entry(page, termId(REQUIRES)));
      assert.match(said, /bridge:AdapterShape/);
      assert.match(said, /A required profile is a bridge:Profile\./);
      assert.match(
        readPage(entry(page, termId(LIFT_TEST))).said,
        /bridge:LiftTestShape checks each bridge:LiftTest/,
      );
    });

    it("says no shape checks a class none uses", () => {
      assert.match(
        readPage(entry(page, termId(PROFILE))).said,
        /No shape checks it\./,
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
      assert.ok(!/No query names it/.test(page));
      assert.ok(!/No rule names it/.test(page));
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
      relative = await bridgeTermReference(files, PLAIN);
    });

    it("names each by its file and its own name, at an anchor of that name", () => {
      const { ids, said } = readPage(relative);
      assert.ok(ids.has("bridge.shapes.ttl#Act"));
      assert.ok(ids.has("facts.shapes.ttl#Fact"));
      assert.match(said, /facts\.shapes\.ttl#Fact checks each bridge:LiftTest/);
      assert.match(said, /bridge\.shapes\.ttl#Act checks each bridge:Adapter/);
    });

    it("shows no address of the repository's tree for a shape, nor for `sh:prefixes <>`", () => {
      assert.equal(relative.split(`${TREE}shapes/`).length, 1);
      assert.match(readPage(relative).said, /prefixes facts\.shapes\.ttl/);
    });
  });

  describe("`bridgeTermsSection`", () => {
    let tree: ReadonlyMap<string, Uint8Array>;
    let rows: SearchRow[];

    before(async () => {
      const files = await fixture();
      const ctx = {
        root: "",
        log: () => undefined,
        bridgeSpec: async () => ({ files, commit: "abc123" }),
        chrome: PLAIN,
      } as unknown as PagesContext;
      ({ tree } = await buildTree({
        sections: [bridgeTermsSection],
        ctx,
        front: (rows) => hubFiles([], rows, PLAIN),
        finishers: [agentFiles],
      }));
      rows = JSON.parse(
        new TextDecoder().decode(tree.get(SEARCH_FILE)),
      ) as SearchRow[];
    });

    it("writes the page at `terms/bridge.html`, beside the term reference's", () => {
      assert.equal(BRIDGE_TERMS_PAGE, "terms/bridge.html");
      assert.ok(tree.has(BRIDGE_TERMS_PAGE));
      assert.notEqual(BRIDGE_TERMS_PAGE, TERMS_PAGE);
    });

    it("links it from the front page", () => {
      const front = readPage(new TextDecoder().decode(tree.get(FRONT_PAGE)));
      assert.ok(front.hrefs.includes(BRIDGE_TERMS_PAGE));
    });

    it("lists each of its terms in `search.json` as a term, at its anchor", () => {
      const terms = rows
        .filter(
          ({ kind, path }) =>
            kind === "term" && path.startsWith(BRIDGE_TERMS_PAGE),
        )
        .map(({ path }) => path);
      assert.ok(terms.includes(`${BRIDGE_TERMS_PAGE}#bridge:Adapter`));
      assert.ok(terms.includes(`${BRIDGE_TERMS_PAGE}#bridge:requiresProfile`));
      assert.ok(terms.includes(`${BRIDGE_TERMS_PAGE}#oa:hasSource`));
    });

    it("lists the page itself in `llms.txt`", () => {
      assert.match(
        new TextDecoder().decode(tree.get("llms.txt")),
        /terms\/bridge\.html/,
      );
    });

    it("lists no term the term reference already describes, so that page stays the first answer for it", async () => {
      const files = await fixture();
      const ctx = {
        root: "",
        log: () => undefined,
        bridgeSpec: async () => ({ files, commit: "abc123" }),
        chrome: PLAIN,
      } as unknown as PagesContext;
      const reference: Section<PagesContext> = {
        path: TERMS_PAGE,
        title: "Cascade terms",
        want: "conformance",
        build: async () =>
          new Map([
            [
              TERMS_PAGE,
              text(`<h3 id="oa:hasSource"><code>oa:hasSource</code></h3>\n`),
            ],
          ]),
        rows: async () => [],
      };
      const built = await buildTree({
        sections: [reference, bridgeTermsSection],
        ctx,
        front: (rows) => hubFiles([], rows, PLAIN),
        finishers: [agentFiles],
      });
      const paths = (
        JSON.parse(
          new TextDecoder().decode(built.tree.get(SEARCH_FILE)),
        ) as SearchRow[]
      )
        .filter(({ kind }) => kind === "term")
        .map(({ path }) => path);
      assert.ok(paths.includes(`${TERMS_PAGE}#oa:hasSource`));
      assert.ok(!paths.includes(`${BRIDGE_TERMS_PAGE}#oa:hasSource`));
      assert.ok(paths.includes(`${BRIDGE_TERMS_PAGE}#bridge:Adapter`));
    });
  });

  describe("given the Bridge's vocabulary itself", () => {
    const SPEC = join(
      findRoot(dirname(fileURLToPath(import.meta.url))),
      "..",
      "cascade-bridge-spec",
    );

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
