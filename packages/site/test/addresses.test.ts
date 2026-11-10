import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, describe, it } from "node:test";
import { addressesOf, sharedPageOf, type Named } from "../src/links.js";

const named = (
  iri: string,
  name: string,
  folder = "records",
  fallback = "record",
): Named => ({ iri, folder, name, fallback });

const digest = (iri: string) =>
  createHash("sha256").update(iri).digest("hex").slice(0, 8);

/**
 * Two records of one medication that differ only in the date at the end of a name of more than 120 characters, as
 * Priya's two fluticasone records do in the starter kit: the case that found the rule against cutting them to one address.
 */
const label = (received: string) =>
  `Medication · fluticasone propionate 50 MCG/ACTUAT Nasal Spray · Fernhill Family Clinic · received ${received}`;

/**
 * A pod's site gives every record, view and view entry its own page. `addressesOf()` names each page from what the thing
 * is called, so an address can be read and does not change when the pod is built again in another order.
 */
describe("An address for each page of a pod's site · addressesOf(), sharedPageOf()", () => {
  describe("`addressesOf()`", () => {
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
      named("urn:j", "COM1"),
      named("urn:k", "Lpt1"),
      named("urn:l", "Comd"),
      named("urn:long", "z".repeat(150)),
      named("urn:may", label("2025-05-20")),
      named("urn:august", label("2025-08-12")),
      named("urn:1", `${"w ".repeat(70)}1`),
      named("urn:2", `${"w ".repeat(70)}2`),
    ];
    let addresses: ReadonlyMap<string, string>;

    before(async () => {
      addresses = await addressesOf(things);
    });

    const of = (...iris: string[]) => iris.map((iri) => addresses.get(iri));

    it("names a page by its kind's folder and its name as a slug of plain letters and digits", () => {
      assert.deepEqual(of("urn:a", "urn:e", "urn:l"), [
        "records/allergy-peanuts-own-entry.html",
        "records/cafe-creme-brulee.html",
        "records/comd.html",
      ]);
    });

    it("adds the start of the IRI's digest to each thing that shares a slug with another in its folder", () => {
      assert.deepEqual(
        of("urn:b", "urn:c", "urn:i"),
        ["urn:b", "urn:c", "urn:i"].map(
          (iri) => `records/condition-asthma--${digest(iri)}.html`,
        ),
      );
    });

    it("leaves a name alone that only a thing of another folder shares", () => {
      assert.deepEqual(of("urn:d"), ["entries/condition-asthma.html"]);
    });

    it("falls back to the kind's own word for a name with no letter or digit", () => {
      assert.deepEqual(of("urn:f"), ["records/record.html"]);
    });

    it("adds the kind's word to a name Windows gives no file, such as `con` or `com1`", () => {
      assert.deepEqual(of("urn:g", "urn:j", "urn:k"), [
        "records/con-record.html",
        "records/com1-record.html",
        "records/lpt1-record.html",
      ]);
    });

    it("cuts a slug at 120 characters, at a hyphen where there is one", () => {
      assert.deepEqual(of("urn:h", "urn:long"), [
        `records/${"x".repeat(70)}.html`,
        `records/${"z".repeat(120)}.html`,
      ]);
    });

    it("keeps a slug whole where the cut would leave two things one address", () => {
      const [may, august, one, two] = of(
        "urn:may",
        "urn:august",
        "urn:1",
        "urn:2",
      );
      assert.ok(may?.endsWith("-received-2025-05-20.html"), may);
      assert.ok(august?.endsWith("-received-2025-08-12.html"), august);
      assert.ok(one?.endsWith("-w-1.html"), one);
      assert.ok(two?.endsWith("-w-2.html"), two);
    });

    it("gives each thing the same address whatever order the things come in", async () => {
      assert.deepEqual(await addressesOf([...things].reverse()), addresses);
    });
  });

  describe("`sharedPageOf()`", () => {
    it("gives the plain address of the page that lists the things sharing a name", () => {
      assert.equal(
        sharedPageOf("records/condition-asthma--0a1b2c3d.html"),
        "records/condition-asthma.html",
      );
    });

    it("gives none for an address that is alone", () => {
      assert.equal(sharedPageOf("records/condition-asthma.html"), undefined);
    });
  });
});
