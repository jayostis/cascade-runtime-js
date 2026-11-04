import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  addressesOf,
  sharedPageOf,
  type Named,
  noteHref,
  ruleHref,
  termHref,
} from "../src/links.js";
import { renderMarkdown } from "../src/markdown.js";

test("a term's link keeps its prefix in the anchor, so copied terms do not collide with ours, and takes the base of whichever page holds the term reference", () => {
  const cases: [string, string, string][] = [
    ["http://xmlns.com/foaf/0.1/name", "terms/", "terms/#foaf:name"],
    ["http://purl.org/pav/version", "terms/", "terms/#pav:version"],
    [
      "http://www.w3.org/ns/prov#wasDerivedFrom",
      "../",
      "../#prov:wasDerivedFrom",
    ],
    ["http://www.w3.org/ns/solid/terms#account", "", "#solid:account"],
    [
      "https://ns.cascadeprotocol.org/cascade#name",
      "terms/",
      "terms/#cascade:name",
    ],
    [
      "https://ns.cascadeprotocol.org/bridge/v1-draft#Source",
      "terms/",
      "terms/#bridge:Source",
    ],
    [
      "http://www.w3.org/2004/02/skos/core#prefLabel",
      "terms/",
      "terms/#skos:prefLabel",
    ],
    [
      "http://www.w3.org/2004/02/skos/core#Concept",
      "terms/",
      "terms/#skos:Concept",
    ],
    ["http://www.w3.org/2002/07/owl#sameAs", "terms/", "terms/#owl:sameAs"],
    [
      "http://purl.obolibrary.org/obo/BFO_0000050",
      "terms/",
      "terms/#obo:BFO_0000050",
    ],
    ["http://rdfs.org/ns/void#inDataset", "terms/", "terms/#void:inDataset"],
    [
      "https://w3id.org/sssom/mapping_justification",
      "terms/",
      "terms/#sssom:mapping_justification",
    ],
    ["http://www.w3.org/ns/org#identifier", "terms/", "terms/#org:identifier"],
    ["http://www.w3.org/ns/dcat#Dataset", "terms/", "terms/#dcat:Dataset"],
    [
      "http://example.org/a b#c",
      "terms/",
      "terms/#http%3A%2F%2Fexample.org%2Fa%20b%23c",
    ],
  ];
  for (const [iri, base, href] of cases)
    assert.equal(termHref(iri, base), href);
  assert.notEqual(
    termHref("http://xmlns.com/foaf/0.1/name", "terms/"),
    termHref("https://ns.cascadeprotocol.org/cascade#name", "terms/"),
  );
});

test("a rule links to its feature's page and its number's anchor, a note to its file on GitHub, and no helper links the namespace host, which does not resolve", () => {
  assert.equal(
    ruleHref("runtime/matcher.feature", "R19", "spec/"),
    "spec/matcher.html#r19",
  );
  assert.equal(
    ruleHref("conformance/alex-rivera/alex-rivera.feature", "Check 3", ""),
    "alex-rivera.html#check-3",
  );
  const blob = "https://github.com/jayostis/cascade-vocabulary/blob/abc123";
  assert.equal(
    noteHref("decisions/identity.md", blob),
    `${blob}/decisions/identity.md`,
  );
  assert.equal(
    noteHref("decisions/identity.md", `${blob}/`),
    `${blob}/decisions/identity.md`,
  );
  assert.equal(
    noteHref("/decisions/identity.md", blob),
    `${blob}/decisions/identity.md`,
  );
  for (const where of [
    "http://ns.cascadeprotocol.org/terms/",
    "https://ns.cascadeprotocol.org",
    "HTTPS://NS.CASCADEPROTOCOL.ORG/x",
  ])
    assert.throws(
      () => termHref("http://xmlns.com/foaf/0.1/name", where),
      /ns\.cascadeprotocol\.org/,
      where,
    );
  const host = "https://ns.cascadeprotocol.org/";
  assert.throws(
    () => termHref("http://xmlns.com/foaf/0.1/name", host),
    /ns\.cascadeprotocol\.org/,
  );
  assert.throws(
    () => ruleHref("runtime/matcher.feature", "R1", `${host}spec/`),
    /ns\.cascadeprotocol\.org/,
  );
  assert.throws(
    () => noteHref("decisions/identity.md", host),
    /ns\.cascadeprotocol\.org/,
  );
});

test("a page's address is its kind's folder and its name as a slug; things that share one each add the start of their IRI's digest, whatever order they come in", async () => {
  const named = (
    iri: string,
    name: string,
    folder = "records",
    fallback = "record",
  ): Named => ({ iri, folder, name, fallback });
  const things = [
    named("urn:a", "Allergy · Peanuts · own entry"),
    named("urn:b", "Condition · Asthma"),
    named("urn:c", "Condition · Asthma"),
    named("urn:d", "Condition · Asthma", "entries", "entry"),
    named("urn:e", "Café · Crème brûlée"),
    named("urn:f", "· · ·"),
    named("urn:g", "Con"),
    named("urn:h", `${"x".repeat(70)} ${"y".repeat(70)}`),
    named("urn:i", "condition asthma"),
  ];
  const addresses = await addressesOf(things);
  const digest = (iri: string) =>
    createHash("sha256").update(iri).digest("hex").slice(0, 8);
  assert.deepEqual(
    addresses,
    new Map([
      ["urn:a", "records/allergy-peanuts-own-entry.html"],
      ["urn:b", `records/condition-asthma--${digest("urn:b")}.html`],
      ["urn:c", `records/condition-asthma--${digest("urn:c")}.html`],
      ["urn:d", "entries/condition-asthma.html"],
      ["urn:e", "records/cafe-creme-brulee.html"],
      ["urn:f", "records/record.html"],
      ["urn:g", "records/con-record.html"],
      ["urn:h", `records/${"x".repeat(70)}.html`],
      ["urn:i", `records/condition-asthma--${digest("urn:i")}.html`],
    ]),
  );
  assert.deepEqual(await addressesOf([...things].reverse()), addresses);
  assert.deepEqual(await addressesOf([]), new Map());
});

test("a name is cut at 120 characters only where the cut leaves it apart from the others: Priya's two fluticasone records keep the date that tells them apart", async () => {
  const label = (received: string) =>
    `Medication · fluticasone propionate 50 MCG/ACTUAT Nasal Spray · Fernhill Family Clinic · received ${received}`;
  const [may, august] = [label("2025-05-20"), label("2025-08-12")];
  const addresses = await addressesOf([
    { iri: "urn:may", folder: "records", name: may, fallback: "record" },
    { iri: "urn:august", folder: "records", name: august, fallback: "record" },
    {
      iri: "urn:long",
      folder: "records",
      name: "z".repeat(150),
      fallback: "record",
    },
  ]);
  assert.equal(
    addresses.get("urn:may"),
    "records/medication-fluticasone-propionate-50-mcg-actuat-nasal-spray-fernhill-family-clinic-received-2025-05-20.html",
  );
  assert.equal(
    addresses.get("urn:august"),
    "records/medication-fluticasone-propionate-50-mcg-actuat-nasal-spray-fernhill-family-clinic-received-2025-08-12.html",
  );
  assert.equal(addresses.get("urn:long"), `records/${"z".repeat(120)}.html`);
  const [one, two] = await addressesOf([
    {
      iri: "urn:1",
      folder: "records",
      name: `${"w ".repeat(70)}1`,
      fallback: "record",
    },
    {
      iri: "urn:2",
      folder: "records",
      name: `${"w ".repeat(70)}2`,
      fallback: "record",
    },
  ]).then((found) => [found.get("urn:1"), found.get("urn:2")]);
  assert.ok(one?.endsWith("-w-1.html") && two?.endsWith("-w-2.html"));
});

test("the plain address of things that share a name is the page that lists them, not the address of one of them", () => {
  assert.equal(
    sharedPageOf("records/condition-asthma--0a1b2c3d.html"),
    "records/condition-asthma.html",
  );
  assert.equal(sharedPageOf("records/condition-asthma.html"), undefined);
});

test("Markdown renders blocks and GFM tables, and shows raw HTML as text", () => {
  const html = renderMarkdown(
    "# Title\n\nA `code` span and a [link](https://example.org/).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ttl\nx:a x:b x:c .\n```\n\n<script>alert(1)</script>\n",
  ).text;
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.org\/">link<\/a>/);
  assert.match(html, /<table>[\s\S]*<td>1<\/td>/);
  assert.match(
    html,
    /<pre><code class="language-ttl">x:a x:b x:c \.\n<\/code><\/pre>/,
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(renderMarkdown("").text, "");
  const scripted = renderMarkdown(
    "[x](javascript:alert(1)) [y](data:text/html,a) [ok](../a.md) [web](http://example.org/)",
  ).text;
  assert.ok(!/javascript:|data:/i.test(scripted), scripted);
  assert.match(scripted, /<a href="\.\.\/a\.md">ok<\/a>/);
  assert.match(scripted, /<a href="http:\/\/example\.org\/">web<\/a>/);
});
