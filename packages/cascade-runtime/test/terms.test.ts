import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as oxigraph from "oxigraph";
import {
  findRoot,
  readConfig,
  resolveVocabulary,
} from "@cascade-runtime/runtime/node";
import { codeStems, terms } from "cascade-runtime/terms";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SH = "http://www.w3.org/ns/shacl#";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

/**
 * `terms` and `codeStems` are a hand-kept copy of the vocabulary's IRIs inside the package, so an app never types
 * one. These checks hold the copy to the vocabulary.
 */
describe("Names for vocabulary terms · terms, codeStems", () => {
  const declared = new Set<string>();
  const shapesOf = new Map<string, string[]>();
  const propertiesOf = new Map<string, string[]>();
  const pathOf = new Map<string, string>();
  const systems = new Set<string>();
  const spaceOf = new Map<string, string>();

  before(async () => {
    const { folder } = await resolveVocabulary(ROOT, await readConfig(ROOT));
    const ontologies = join(folder, "ontologies");
    const add = (map: Map<string, string[]>, key: string, value: string) =>
      map.set(key, [...(map.get(key) ?? []), value]);
    for (const path of await readdir(ontologies, { recursive: true })) {
      if (!path.endsWith(".ttl")) continue;
      const shapes = path.endsWith(".shapes.ttl");
      for (const { subject, predicate, object } of oxigraph.parse(
        await readFile(join(ontologies, path), "utf8"),
        {
          format: "text/turtle",
          base_iri: pathToFileURL(join(ontologies, path)).href,
        },
      ))
        if (!shapes) {
          if (predicate.value === TYPE) {
            declared.add(subject.value);
            if (object.value === terms.CodeSystem) systems.add(subject.value);
          } else if (predicate.value === "http://rdfs.org/ns/void#uriSpace")
            spaceOf.set(subject.value, object.value);
        } else if (predicate.value === `${SH}targetClass`)
          add(shapesOf, object.value, subject.value);
        else if (predicate.value === `${SH}property`)
          add(propertiesOf, subject.value, object.value);
        else if (predicate.value === `${SH}path`)
          pathOf.set(subject.value, object.value);
    }
  });

  describe("terms", () => {
    it("holds only IRIs the vocabulary declares", () => {
      const { statusOf, ...named } = terms;
      assert.deepEqual(
        [...Object.values(named), ...Object.values(statusOf)].filter(
          (iri) => !declared.has(iri),
        ),
        [],
      );
    });

    it("names in `statusOf`, for each kind of record, a property the vocabulary's rules constrain on that kind", () => {
      for (const [kind, status] of Object.entries(terms.statusOf)) {
        const paths = (shapesOf.get(`${CASCADE}${kind}`) ?? [])
          .flatMap((shape) => propertiesOf.get(shape) ?? [])
          .map((property) => pathOf.get(property));
        assert.ok(
          paths.includes(status),
          `${kind}'s shape constrains ${status}`,
        );
      }
    });
  });

  describe("codeStems", () => {
    it("lists exactly the code systems the vocabulary declares (RxNorm, LOINC, SNOMED CT and the rest), each under its short name with the prefix its codes' IRIs start with", () => {
      assert.deepEqual(
        codeStems,
        Object.fromEntries(
          [...systems].map((system) => [
            system.slice(system.lastIndexOf("#") + 1),
            spaceOf.get(system),
          ]),
        ),
      );
    });
  });
});
