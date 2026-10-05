import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGraph } from "../src/graph.js";
import { contentName, earlierInUtc } from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";

test("a version is named from its literals as written, before any store reads them, as the Bridge spec's typed-literals vector names it", async () => {
  const xsd = "http://www.w3.org/2001/XMLSchema#";
  const { triples } = await parseGraph(
    new TextEncoder().encode(`
      <urn:cascade:this-version> <http://www.w3.org/ns/prov#specializationOf> <urn:uuid:7435b3b8-2d93-8912-9d48-940c5870dc81> ;
        <http://example.org/clinical#doseQuantity> "2.00"^^<${xsd}decimal> ;
        <http://example.org/clinical#doseNumber> "007"^^<${xsd}integer> ;
        <http://example.org/clinical#primarySource> "1"^^<${xsd}boolean> ;
        <http://example.org/clinical#seriesDoses> "3"^^<${xsd}positiveInteger> .`),
    "urn:version",
    () => new OxigraphStore(),
  );
  assert.equal(
    await contentName(triples),
    "ni:///sha-256;GfO0_0wskNIQG7q71ttc_HmzuLNjCTLTgTTw6llh9Fw",
  );
});

test("one time is earlier than another by its instant, whether or not either has a fraction of a second", () => {
  assert.ok(earlierInUtc("2026-09-01T10:00:00Z", "2026-09-01T10:00:00.5Z"));
  assert.ok(!earlierInUtc("2026-09-01T10:00:00.5Z", "2026-09-01T10:00:00Z"));
  assert.ok(earlierInUtc("2026-09-01T10:00:00.25Z", "2026-09-01T10:00:00.3Z"));
  assert.ok(
    earlierInUtc("2026-09-01T12:00:00+02:00", "2026-09-01T10:00:00.1Z"),
  );
});
