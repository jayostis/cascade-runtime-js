import assert from "node:assert/strict";
import { test } from "node:test";
import { noteHref, ruleHref, termHref } from "../src/links.js";
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
});
