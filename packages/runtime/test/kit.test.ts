import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  podAddressesIn,
  snapshotFaults,
  usedByNoActivity,
} from "../src/kit.js";
import { iri, relativeTurtle, type Triple } from "../src/rdf.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { Shapes } from "../src/shapes.js";
import { cleosReplay, copied } from "./cleo.js";
import { vocabulary } from "./vocabulary.js";

const PROV = "http://www.w3.org/ns/prov#";
const RDF_TYPE = iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const newStore = () => new OxigraphStore();
const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * A runtime passes a kit when a replay of its story passes checks 2 to 6 of `runtime/the-kit.feature`, none of which an
 * example can state. Each check returns its faults, one sentence for each thing wrong, and passes when it returns none.
 * @rule runtime/the-kit.feature Check 3
 * @rule runtime/the-kit.feature Check 4
 * @rule runtime/the-kit.feature Check 6
 * @rule runtime/naming.feature N14
 */
describe("Checking a replayed kit · kitChecks(), shapeFaults(), snapshotFaults(), podAddressesIn()", () => {
  /**
   * Check 3 reads every file of the pod against the vocabulary's shapes, and holds to a rule no shape states: a subject
   * of `prov:used` is a `prov:Activity`.
   */
  describe("usedByNoActivity(terms, triples)", () => {
    const subject = iri("urn:example:subject");
    let terms: readonly Triple[];

    before(async () => {
      terms = (await Shapes.read(await vocabulary(), newStore)).terms;
    });

    const used = (typeOfSubject?: string): Triple[] =>
      [
        [subject, iri(`${PROV}used`), iri("urn:example:thing")],
        ...(typeOfSubject === undefined
          ? []
          : [[subject, RDF_TYPE, iri(typeOfSubject)]]),
      ] as unknown as Triple[];

    it("reports a subject of `prov:used` that no class of the vocabulary makes a `prov:Activity`", () => {
      assert.deepEqual(usedByNoActivity(terms, used("urn:example:Judgment")), [
        "<urn:example:subject> has prov:used and is no prov:Activity",
      ]);
    });

    it("reports a subject of `prov:used` that has no type", () => {
      assert.deepEqual(usedByNoActivity(terms, used()), [
        "<urn:example:subject> has prov:used and is no prov:Activity",
      ]);
    });

    it("accepts a subject of `prov:used` typed only by a subclass of `prov:Activity` the vocabulary declares", () => {
      assert.deepEqual(
        usedByNoActivity(
          terms,
          used("https://ns.cascadeprotocol.org/cascade#MatcherRun"),
        ),
        [],
      );
    });
  });

  /**
   * Check 4 holds each act's snapshot to the rule of `runtime/naming.feature` N14, over the replay of Cleo's import,
   * entry session and matcher run, and holds the last snapshot's set hash to the files the pod lists of its set.
   */
  describe("snapshotFaults(replayed, layout, newStore)", () => {
    const failing =
      "N14: the last snapshot's set hash is not the set hash of the files the pod lists of its set";
    let faults: (
      changes?: Record<string, Uint8Array | undefined>,
    ) => Promise<string[]>;
    let record: string;

    before(async () => {
      const { local, replayed } = await cleosReplay();
      faults = async (changes) =>
        snapshotFaults(
          changes === undefined
            ? replayed
            : { ...replayed, pod: await copied(replayed.pod, changes) },
          local.layout,
          newStore,
        );
      const first = replayed.steps
        .flatMap(({ wrote }) => wrote)
        .find((path) => path.startsWith("records/"));
      assert.ok(first !== undefined, "no step of the replay wrote a record");
      record = first;
    });

    it("returns no fault for a replay of an import, an entry session and a matcher run", async () => {
      assert.deepEqual(await faults(), []);
    });

    it("reports a file of the set that is missing from the pod, and the last set hash as wrong", async () => {
      assert.deepEqual(await faults({ [record]: undefined }), [
        failing,
        `N14: ${record}, of the set the snapshots hash, is missing from the pod`,
      ]);
    });

    it("reports the last set hash as wrong for a file of the set whose bytes changed", async () => {
      const found = await faults({ [record]: bytes("# changed\n") });
      assert.ok(found.includes(failing), found.join("\n"));
    });
  });

  /**
   * Check 6 holds that no view the runtime wrote holds the pod's address, by what `podAddressesIn()` finds in a view's
   * bytes.
   */
  describe("podAddressesIn(bytes, address)", () => {
    it("returns each IRI the bytes write that begins with the address, a prefix's among them, in the order written", () => {
      assert.deepEqual(
        podAddressesIn(
          bytes(`@prefix pod: <https://pod.example/clinical/> .
<https://pod.example/clinical/allergies.ttl#ab> <urn:example:p> pod:x .`),
          "https://pod.example/",
        ),
        [
          "https://pod.example/clinical/",
          "https://pod.example/clinical/allergies.ttl#ab",
        ],
      );
    });

    it("returns nothing for a relative reference or a name under another address", () => {
      assert.deepEqual(
        podAddressesIn(
          bytes(`<> a <urn:example:View> .
<#ab> <urn:example:p> <urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53> .
<#cd> <urn:example:p> <https://other.example/clinical/x> .`),
          "https://pod.example/",
        ),
        [],
      );
    });
  });

  describe("given a view written relative to itself by `relativeTurtle()`", () => {
    const folder = "https://pod.example/clinical/";
    const view = `${folder}variant-interpretations.ttl`;
    const variants = `${folder}variants.ttl`;
    const p = iri("urn:example:p");
    const written = relativeTurtle(
      [
        [iri(`${view}#ab`), p, iri(`${variants}#cd`)],
        [iri(view), p, iri("https://other.example/x")],
        [iri(view), p, iri(folder)],
        [iri(view), p, iri(`${folder}a:b`)],
        [iri(view), p, iri(`${folder}notes.ttl`)],
      ],
      view,
      [view, variants],
    );

    it("writes another view's entry as a relative reference", () => {
      assert.match(
        new TextDecoder().decode(written),
        /^<#ab> \S+ <variants\.ttl#cd> \.$/m,
      );
    });

    it("writes in full every other IRI under the pod's address, which `podAddressesIn()` then returns", () => {
      assert.deepEqual(podAddressesIn(written, "https://pod.example/"), [
        folder,
        `${folder}a:b`,
        `${folder}notes.ttl`,
      ]);
    });
  });
});
