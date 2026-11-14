import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Files, MemoryFiles } from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { readOneFact } from "../src/one-fact.js";
import { hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { AdapterRead, PagesContext } from "../src/hub/context.js";
import { adaptersSection } from "../src/hub/adapters.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";

const FHIR_REPOSITORY =
  "https://github.com/jayostis/cascade-bridge-adapter-fhir-r4";
const CCDA_REPOSITORY =
  "https://github.com/jayostis/cascade-bridge-adapter-ccda";
const COMMIT = "4aeb5230a1b2c3d4e5f60718293a4b5c6d7e8f90";
const FHIR_TREE = `${FHIR_REPOSITORY}/tree/${COMMIT}/`;
const INDEX = "adapters/index.html";
const FHIR_PAGE = "adapters/fhir-r4/index.html";

const ONTOLOGY = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .

cascade:ProblemOrDiagnosis a owl:Class .
cascade:AllergyOrIntolerance a owl:Class .
cascade:snomedCode a owl:DatatypeProperty .
cascade:onsetDate a owl:DatatypeProperty .
cascade:allergen a owl:DatatypeProperty .
`;

const CRATE = JSON.stringify({
  "@graph": [
    {
      "@id": "./",
      "@type": ["Dataset", "bridge:Adapter"],
      identifier: "fhir-r4",
      name: "FHIR R4 JSON",
    },
  ],
});

const encoder = new TextEncoder();

const DOWNLOADS = "conformance/priya-natarajan/scripted-input/priya/downloads/";
const FHIR_ALLERGY = `${DOWNLOADS}x-e2/apple_health_export/clinical-records/AllergyIntolerance-alg-aspirin-1.json`;
const KESTREL = `${DOWNLOADS}kestrel-harbor-health-summary.xml`;
const FERNHILL = `${DOWNLOADS}fernhill-family-clinic-summary.xml`;
const RECORD = "conformance/priya-natarajan/expected/allergies.ttl";

const allergy = (
  substance: string,
  reaction: string | undefined,
) => `<observation classCode="OBS" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.7"/>
<templateId root="2.16.840.1.113883.10.20.22.4.7" extension="2014-06-09"/>
<participant typeCode="CSM"><participantRole classCode="MANU"><playingEntity classCode="MMAT">
<code code="${substance}" displayName="substance" codeSystem="2.16.840.1.113883.6.88" codeSystemName="RxNorm"/>
</playingEntity></participantRole></participant>${
  reaction === undefined
    ? ""
    : `<entryRelationship typeCode="MFST"><observation classCode="OBS" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.9"/>
<templateId root="2.16.840.1.113883.10.20.22.4.9" extension="2014-06-09"/><code code="ASSERTION" codeSystem="2.16.840.1.113883.5.4"/>
<value xsi:type="CD" code="${reaction}" displayName="Urticaria" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT"/></observation></entryRelationship>`
}</observation>`;

const ccda = (substance: string, reaction: string) =>
  allergy(substance, reaction);

/** Priya's aspirin allergy as the vocabulary's conformance folder holds it: in FHIR, in two C-CDAs, and as the record. */
const PRIYA: Readonly<Record<string, string>> = {
  [FHIR_ALLERGY]: JSON.stringify({
    resourceType: "AllergyIntolerance",
    code: {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: "1191",
          display: "aspirin",
        },
      ],
    },
    reaction: [
      {
        manifestation: [
          {
            coding: [{ system: "http://snomed.info/sct", code: "126485001" }],
          },
        ],
      },
    ],
  }),
  [KESTREL]: ccda("1191", "126485001"),
  [FERNHILL]: ccda("1191", "126485001"),
  [RECORD]: `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .

[] a cascade:AllergyOrIntolerance ;
  cascade:allergen "Aspirin" ;
  cascade:allergenCode <https://ns.cascadeprotocol.org/codes/rxnorm/1191> ;
  cascade:reactionManifestationCode <http://snomed.info/id/126485001> .
`,
};

async function adapter(
  changed: Readonly<Record<string, string>> = {},
): Promise<AdapterRead> {
  const files = new MemoryFiles(FHIR_TREE);
  await files.write(
    "ro-crate-metadata.json",
    encoder.encode(changed["ro-crate-metadata.json"] ?? CRATE),
  );
  return { repository: FHIR_REPOSITORY, files, commit: COMMIT };
}

/** What the generator writes for an adapter: a page, its data and a case, which the hub does not read. */
const EXPLORER = new Map<string, Uint8Array>([
  [
    "index.html",
    encoder.encode(
      "<!DOCTYPE html><title>fhir-r4: an adapter explorer</title>",
    ),
  ],
  ["explorer.json", encoder.encode("{}")],
  ["cases/0.json", encoder.encode("{}")],
]);

async function vocabulary(
  changed: Readonly<Record<string, string | undefined>> = {},
): Promise<Files> {
  const files = new MemoryFiles(
    "https://github.com/jayostis/cascade-vocabulary/tree/abc123/",
  );
  await files.write("ontologies/cascade.ttl", encoder.encode(ONTOLOGY));
  for (const [path, text] of Object.entries({ ...PRIYA, ...changed }))
    if (text !== undefined) await files.write(path, encoder.encode(text));
  return files;
}

async function built(
  adapters: readonly AdapterRead[],
  changed: Readonly<Record<string, string | undefined>> = {},
  explorer: PagesContext["explorer"] = async () => EXPLORER,
) {
  const files = await vocabulary(changed);
  const { tree } = await buildTree({
    sections: [adaptersSection],
    ctx: {
      adapters: async () => adapters,
      explorer,
      vocabulary: async () => ({ files, builtFrom: [], at: "2026-11-04" }),
      log: () => undefined,
      chrome: PLAIN,
    } as unknown as PagesContext,
    front: (rows) => hubFiles(["Records"], rows, PLAIN),
  });
  const read = (path: string): string => {
    const bytes = tree.get(path);
    assert.ok(bytes, `${path} is written`);
    return new TextDecoder().decode(bytes);
  };
  return Object.assign(read, { has: (path: string) => tree.has(path) });
}

const plain = (markup: string): string =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** A crate whose one node has `identifier`. */
const crate = (identifier: string) =>
  JSON.stringify({ "@graph": [{ "@id": "./", identifier, name: "X" }] });

/**
 * An adapter's explorer is generated over the adapter by cascade-bridge-spec's tooling, and the hub publishes it as it is:
 * the adapter's folder holds the explorer's files, and the hub keeps no page of its own for the adapter.
 */
describe("The hub publishes each adapter's explorer as it is · adaptersSection", () => {
  describe("with an adapter whose explorer is made", () => {
    it("writes the explorer's files under the adapter's folder, byte for byte, and no other page there", async () => {
      const read = await built([await adapter()]);
      assert.equal(
        read(FHIR_PAGE),
        new TextDecoder().decode(EXPLORER.get("index.html")),
      );
      assert.ok(read.has("adapters/fhir-r4/explorer.json"));
      assert.ok(read.has("adapters/fhir-r4/cases/0.json"));
    });
  });

  describe("with an adapter whose explorer cannot be made", () => {
    it("fails the build with the reason, though the adapter was read", async () => {
      await assert.rejects(
        built([await adapter()], {}, async () => {
          throw new Error("the explorer could not be made: rdflib is missing");
        }),
        /rdflib is missing/,
      );
    });

    it("fails the build when what was made has no page", async () => {
      await assert.rejects(
        built(
          [await adapter()],
          {},
          async () => new Map([["explorer.json", encoder.encode("{}")]]),
        ),
        /has no index\.html/,
      );
    });

    it("makes the explorers of the adapters at once, not one after the other", async () => {
      let running = 0;
      let most = 0;
      await built(
        [
          await adapter(),
          {
            ...(await adapter({ "ro-crate-metadata.json": crate("c-cda") })),
            repository: CCDA_REPOSITORY,
          },
        ],
        {},
        async () => {
          most = Math.max(most, ++running);
          await new Promise((done) => setTimeout(done, 20));
          running--;
          return EXPLORER;
        },
      );
      assert.equal(most, 2);
    });
  });

  describe("with the build told to leave the explorers out", () => {
    it("lists each adapter that was read as not available, saying so, and writes no folder for it", async () => {
      const read = await built([await adapter()], {}, async () => undefined);
      const said = plain(read(INDEX));
      assert.match(said, /Not available/);
      assert.match(said, /explorer was left out of this build/);
      assert.equal(read.has(FHIR_PAGE), false);
    });
  });

  describe("with an adapter that could not be read", () => {
    it("lists it as not available and goes on, asking for no explorer of it", async () => {
      let asked = 0;
      const read = await built(
        [{ repository: CCDA_REPOSITORY, unavailable: "the fetch failed" }],
        {},
        async () => {
          asked++;
          return EXPLORER;
        },
      );
      assert.match(plain(read(INDEX)), /the fetch failed/);
      assert.equal(asked, 0);
    });
  });

  describe("with an adapter the site cannot name a folder for", () => {
    it("lists an adapter whose identifier is a path as not available, and writes nothing in that path", async () => {
      const read = await built([
        await adapter({ "ro-crate-metadata.json": crate("../evil") }),
      ]);
      const said = plain(read(INDEX));
      assert.match(said, /Not available/);
      assert.match(said, /no identifier a folder can take its name from/);
      assert.equal(read.has("adapters/evil/index.html"), false);
      assert.equal(read.has("adapters/../evil/index.html"), false);
    });

    it("lists a second adapter with the same identifier as not available", async () => {
      const read = await built([await adapter(), await adapter()]);
      assert.match(plain(read(INDEX)), /another adapter is already fhir-r4/);
    });
  });
});

const SPEC = "https://github.com/jayostis/cascade-bridge-spec";

/**
 * A builder with one more source format to bring in asks whether that means one more engine. The adapters page answers
 * on one screen, before any adapter's detail: the problem, one allergy followed through three source forms to one
 * record, four reasons, and a card for each adapter.
 */
describe("The adapters page says what an adapter is on one screen · adaptersIndex()", () => {
  let page: ReturnType<typeof readPage>;
  let markup: string;

  before(async () => {
    const read = await built([
      await adapter(),
      { repository: CCDA_REPOSITORY, unavailable: "the fetch failed" },
    ]);
    markup = read(INDEX);
    page = readPage(markup, INDEX);
  });

  /** The text of the part of the page that starts at the element with `id`, up to the next `h2`. */
  const part = (id: string): string =>
    plain(markup.split(` id="${id}"`)[1]?.split("<h2")[0] ?? "");

  describe("with the builder's problem", () => {
    it("leads with one more source format without one more engine, and names the one Bridge", () => {
      assert.match(page.h1, /one more source format/i);
      assert.match(page.h1, /without one more engine/i);
      assert.match(page.said, /cascade-bridge-rs is the one Bridge today/);
    });
  });

  describe("with one fact in three forms", () => {
    it("holds the aspirin allergy from a FHIR resource and two C-CDAs, joined to the one record it becomes", () => {
      const said = part("one-fact-three-forms");
      assert.equal(said.match(/FHIR R4 JSON/g)?.length, 1);
      assert.equal(said.match(/C-CDA/g)?.length, 2);
      assert.equal(markup.match(/class="form"/g)?.length, 3);
      assert.equal(markup.match(/class="record"/g)?.length, 1);
      assert.ok(said.includes("1191"));
      assert.ok(said.includes("126485001"));
      assert.ok(said.includes("cascade:allergenCode"));
      assert.ok(said.includes("Aspirin"));
    });

    it("reads each value from the vocabulary's files, never from the page's own text", async () => {
      const read = await built([await adapter()], {
        [FHIR_ALLERGY]: PRIYA[FHIR_ALLERGY]?.replaceAll("1191", "7777"),
        [KESTREL]: PRIYA[KESTREL]?.replaceAll("1191", "7777"),
        [FERNHILL]: PRIYA[FERNHILL]?.replaceAll("1191", "7777"),
        [RECORD]: PRIYA[RECORD]?.replaceAll("1191", "7777"),
      });
      const said = plain(read(INDEX));
      assert.ok(said.includes("7777"));
      assert.ok(!said.includes("1191"));
    });

    it("links each source file and the record's file on GitHub at the vocabulary's commit", () => {
      const base =
        "https://github.com/jayostis/cascade-vocabulary/blob/abc123/";
      for (const path of [FHIR_ALLERGY, KESTREL, FERNHILL, RECORD])
        assert.ok(page.hrefs.includes(base + path), path);
    });

    it("fails the build when one of its files is missing", async () => {
      await assert.rejects(
        built([await adapter()], { [FERNHILL]: undefined }),
        /not in the vocabulary/,
      );
    });

    it("fails the build when a file has no code to read", async () => {
      await assert.rejects(
        built([await adapter()], { [KESTREL]: "<x/>" }),
        /no entry for RxNorm code 1191/,
      );
    });

    it("reads a C-CDA's values from the entry whose substance is the FHIR resource's, however many allergies come first", async () => {
      const read = await built([await adapter()], {
        [KESTREL]:
          allergy("7980", "271807003") +
          allergy("1191", "126485001") +
          allergy("2670", "271807003"),
      });
      const said = plain(read(INDEX));
      assert.ok(said.includes("126485001"));
      assert.ok(!said.includes("7980"));
      assert.ok(!said.includes("271807003"));
    });

    it("fails the build when that entry has no reaction, though another allergy's has one", async () => {
      await assert.rejects(
        built([await adapter()], {
          [KESTREL]: allergy("1191", undefined) + allergy("7980", "271807003"),
        }),
        /no reaction code in the entry for RxNorm code 1191/,
      );
    });

    it("labels each value with the adapter's own source path, a break allowed only after a slash", () => {
      assert.ok(markup.includes("/<wbr>ClinicalDocument/<wbr>component/<wbr>"));
      assert.ok(
        markup.includes(
          "participantRole/<wbr>playingEntity/<wbr>code/<wbr>@code",
        ),
      );
      assert.ok(markup.includes("/<wbr>code/<wbr>coding/<wbr>code"));
      assert.doesNotMatch(markup, /\(reaction\)/);
    });

    it("builds from the vocabulary's real conformance files", async () => {
      const root = findRoot(dirname(fileURLToPath(import.meta.url)));
      const { files } = await localVocabulary(root);
      const { sources, record } = await readOneFact(files);
      for (const shown of [...sources, record])
        for (const [, value] of shown.rows) assert.ok(value.length > 0);
    });
  });

  describe("with the reasons", () => {
    it("gives four, and says an adapter takes no new engine, is tested alike, accounts for every path, and there will be many", () => {
      const reasons = part("reasons");
      assert.equal(
        markup.split(' id="reasons"')[1]?.split("</ol>")[0]?.match(/<li>/g)
          ?.length,
        4,
      );
      assert.match(reasons, /no new engine/i);
      assert.match(reasons, /tested the same way/i);
      assert.match(reasons, /every source path/i);
      assert.match(reasons, /reported with its reason/i);
      assert.match(reasons, /many/i);
    });
  });

  describe("with a card for each adapter", () => {
    it("links an adapter's card to its page, with its name and a sentence", () => {
      const cards = part("adapters");
      assert.ok(cards.includes("FHIR R4 JSON"));
      assert.ok(page.hrefs.includes(FHIR_PAGE));
    });

    it("says an adapter that could not be fetched is not available, and why, with no link", () => {
      const cards = part("adapters");
      assert.match(cards, /cascade-bridge-adapter-ccda/);
      assert.match(cards, /not available/i);
      assert.ok(cards.includes("the fetch failed"));
      assert.ok(!page.hrefs.some((href) => href.startsWith("adapters/ccda")));
    });
  });

  describe("with the specification", () => {
    it("links what is in an adapter and how to write one, to the Bridge specification's adapter folder and its README", () => {
      assert.ok(page.hrefs.includes(`${SPEC}/tree/main/adapter`));
      assert.ok(page.hrefs.includes(`${SPEC}/blob/main/adapter/README.md`));
    });
  });

  describe("with figures", () => {
    it("gives no exact count of paths, cases or passes", () => {
      assert.doesNotMatch(
        page.said,
        /\d[\d,]*\s+(?:source\s+)?(?:paths?|cases?|passed|tests?)\b/i,
      );
      assert.doesNotMatch(page.said, /\b(?:paths?|cases?|passed)\s*:?\s*\d/i);
    });
  });
});
