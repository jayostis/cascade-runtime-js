import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles, OxigraphStore } from "@cascade-runtime/runtime";
import { kindsRead } from "../src/tables/feed-check.js";

test("a kind the vocabulary does not declare is not read, though its rule list or a page names it, so its series is neither verified nor packed", async () => {
  const vocabulary = new MemoryFiles("urn:test:vocabulary/");
  const write = (path: string, text: string) =>
    vocabulary.write(path, new TextEncoder().encode(text));
  await write(
    "ontologies/cascade.ttl",
    `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
cascade:VaccineGroups a cascade:TableKind .
cascade:CodeNames a cascade:TableKind ; cascade:readByAppPages true .
cascade:NdcDrugs cascade:readByAppPages true .
`,
  );
  await write(
    "runtime/rule-list/rules.ttl",
    `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
<urn:test:rule-1> cascade:tableKind cascade:VaccineGroups .
<urn:test:rule-2> cascade:tableKind cascade:RetiredKind .
`,
  );
  assert.deepEqual(
    [...(await kindsRead({ vocabulary, newStore: () => new OxigraphStore() }))]
      .map((kind) => kind.replace(/^.*#/, ""))
      .sort(),
    ["CodeNames", "VaccineGroups"],
  );
});
