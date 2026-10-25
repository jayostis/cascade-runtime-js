import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveWith, vocabularyBuild } from "../src/build.js";
import type { CorePod } from "../src/core-pod.js";
import { MemoryFiles } from "../src/files.js";
import { importersNamed } from "../src/importers.js";
import { localVocabulary, thisRuntime } from "../src/node/runtime.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { type Perform, PERFORMERS, Replay } from "../src/replay.js";
import type { Happened, Step } from "../src/story.js";
import { ROOT } from "./vocabulary.js";

const CLEO = "urn:uuid:e3b7a9c2-4d16-4f85-9a3e-7c1b5d9f2e48";
const ADDRESS = "https://pod.example/";
const ME = `${ADDRESS}profile/card.ttl#me`;
/** The profile of the patient Cleo's export names, which her About in the matcher's rules claims. */
const PROFILE = "urn:uuid:dccb6776-d640-88e5-a7b3-7e2e1b860abe";
const FOLDER = "runtime/scripted-input/cleo/";
/** Tamsin's two pulls from one server, a year apart, which revise her records; the first also with no names, so a later version, its name in lower case, brings a record its first. */
const TAMSIN = "conformance/tamsin-vale/scripted-input/tamsin/";
const IMPORTS = [
  [
    "export",
    "downloads/first-export/apple_health_export",
    "bridge/first-export",
  ],
  [
    "export-again",
    "downloads/first-export/apple_health_export",
    "bridge/second-import",
  ],
  ["pull-2024", "downloads/north-2024-02", "bridge/E2"],
  ["pull-2024-unnamed", "downloads/north-2024-02", "bridge/E2-unnamed"],
  ["pull-2025", "downloads/north-2025-02", "bridge/E3"],
] as const;
/** Version 2 of the ingredient map in Cleo's tables; version 1 is the one her pod is created with. */
const MAP_2 = "ni:///sha-256;SFsendQJt_qOBLkrFOY_bAzqXh0YthSRPeWsdVqTyOM";
/** Codes Cleo's export and the rules' entries already hold, which the matcher joins by code and by mapped code. */
const CODES = [
  "https://ns.cascadeprotocol.org/codes/rxnorm/7980",
  "https://ns.cascadeprotocol.org/codes/rxnorm/733",
  "https://ns.cascadeprotocol.org/codes/rxnorm/2670",
  "https://ns.cascadeprotocol.org/codes/rxnorm/10180",
  "http://snomed.info/id/373270004",
];
const PREFIXES = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;
/** How many stories, and steps in each: a few in CI; set CASCADE_RANDOM_SEEDS to run more. */
const SEEDS = Number(process.env["CASCADE_RANDOM_SEEDS"] ?? 8);
const FIRST_SEED = Number(process.env["CASCADE_RANDOM_FIRST_SEED"] ?? 1);
const STEPS = Number(process.env["CASCADE_RANDOM_STEPS"] ?? 20);

/** Mulberry32: the same seed draws the same story. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Draw {
  readonly #next: () => number;
  constructor(seed: number) {
    this.#next = random(seed);
  }
  below(n: number): number {
    return Math.floor(this.#next() * n);
  }
  chance(p: number): boolean {
    return this.#next() < p;
  }
  pick<T>(all: readonly T[]): T {
    const found = all[this.below(all.length)];
    if (found === undefined) throw new Error("nothing to pick from");
    return found;
  }
  uuid(): string {
    const hex = Array.from({ length: 32 }, () =>
      this.below(16).toString(16),
    ).join("");
    return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
  }
}

async function column(pod: CorePod, query: string): Promise<string[]> {
  const { rows } =
    await pod.select(`PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
PREFIX prov: <http://www.w3.org/ns/prov#>
${query}`);
  return [
    ...new Set(rows.flatMap((row) => row.get("found")?.value ?? [])),
  ].sort();
}

function judgment(
  iri: string,
  verdict: string,
  members: readonly string[],
  at: string,
  more = "",
): string {
  return `${PREFIXES}
<${iri}> a cascade:Judgment ;
  cascade:verdict cascade:${verdict} ;
  prov:hadMember ${members.map((member) => `<${member}>`).join(" , ")} ;${more}
  prov:wasAttributedTo <${ME}> ;
  prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <${ME}> ; prov:hadRole cascade:PatientRole ] ;
  prov:generatedAtTime "${at}"^^xsd:dateTime .
<${ME}> a prov:Person .
`;
}

/**
 * A story drawn from the seed: Cleo's export and Tamsin's pulls, entries of allergies sharing codes (some versions with
 * no name), the matcher, a person's Same, Different (some typing a member, as an app may), Before, Erroneous, About and ClockDiscounted, retractions of her judgments and of
 * the matcher's assertions, version 2 of the ingredient map, and a second writer whose files, claims made under the
 * older map among them, each writer receives. Each judgment is written when its step is performed, from what the pod
 * then holds.
 */
async function story(seed: number) {
  const local = await localVocabulary(ROOT);
  const source = new MemoryFiles("https://story.example/");
  for (const path of await local.files.list(FOLDER)) {
    const bytes = await local.files.read(path);
    if (bytes !== undefined) await source.write(path, bytes);
  }
  for (const path of await local.files.list(TAMSIN)) {
    const bytes = await local.files.read(path);
    if (bytes !== undefined)
      await source.write(
        FOLDER + path.slice(TAMSIN.length),
        path.includes("/bridge/E3/")
          ? new TextEncoder().encode(
              new TextDecoder()
                .decode(bytes)
                .replace(
                  /(cascade:(?:drugName|testName) ")(.)/g,
                  (_all, before: string, first: string) =>
                    before + first.toLowerCase(),
                ),
            )
          : bytes,
      );
  }
  for (const path of await source.list(`${FOLDER}bridge/E2/`)) {
    const bytes = await source.read(path);
    if (bytes === undefined) continue;
    const text = new TextDecoder()
      .decode(bytes)
      .replace(/\tcascade:drugName "[^"]*" ;\n/g, "")
      .replace(/ cascade:testName "[^"]*" ;/g, "");
    await source.write(
      path.replace("/bridge/E2/", "/bridge/E2-unnamed/"),
      new TextEncoder().encode(text),
    );
  }
  const draw = new Draw(seed);
  const written = new Map<string, (pod: CorePod) => Promise<string>>();
  const retracted = new Set<string>();
  const log: string[] = [];
  const write = (path: string, text: string) =>
    source.write(`${FOLDER}${path}`, new TextEncoder().encode(text));

  const judge: Perform = async (pod, step, side) => {
    const { happened } = step;
    if (happened.kind !== "judgment") throw new Error("no judgment");
    const make = written.get(happened.file);
    if (make === undefined) throw new Error(`no ${happened.file}`);
    const text = await make(pod);
    if (text === "") return pod.refuse("nothing to judge");
    log.push(`${step.name}:\n${text}`);
    await write(happened.file, text);
    return (PERFORMERS.judgment as Perform)(pod, step, side);
  };
  const build = await vocabularyBuild(local.files, local.layout);
  const newStore = () => new OxigraphStore();
  const replaying = new Replay({
    story: { address: ADDRESS, subject: CLEO, steps: [] },
    source,
    vocabulary: local.files,
    folder: FOLDER.slice(0, -1),
    title: "random",
    pod: new MemoryFiles(ADDRESS),
    layout: local.layout,
    newStore,
    runtime: await thisRuntime(),
    importers: importersNamed(local.config.importers),
    performers: { ...PERFORMERS, judgment: judge },
    build: {
      lens: local.config.lens,
      derive: deriveWith(build),
      incremental: build,
      verify: true,
    },
  });

  let time = Date.parse("2026-03-01T09:00:00Z");
  const steps: Step[] = [];
  const own: string[][] = [[], []];
  const imported = [new Set<string>(), new Set<string>()];
  const referenced = [false, false];
  let writers = 1;
  const perform = async (name: string, happened: Happened, writer: number) => {
    time += (1 + draw.below(20 * 24)) * 3_600_000;
    const step: Step = {
      name,
      when: new Date(time).toISOString(),
      happened,
      ...(writer === 0 ? {} : { writer }),
    };
    steps.push(step);
    try {
      await replaying.perform(step);
    } catch (error) {
      const why = (error as { cause?: unknown }).cause ?? error;
      const story = steps
        .map(({ name: each, writer: w }) => `  ${each}${w ? " (second)" : ""}`)
        .join("\n");
      throw new Error(
        `seed ${seed}, step ${steps.length} (${name}), after:\n${story}\n${log.join("\n")}\n${why instanceof Error ? why.message : String(why)}`,
        { cause: error },
      );
    }
    const { stopped } = replaying.replayed();
    assert.equal(stopped?.why, undefined, `seed ${seed}, step ${name}`);
  };

  await perform("pod", { kind: "creation" }, 0);
  const counts = { refused: 0 };
  for (let index = 0; index < STEPS; index++) {
    const writer = writers > 1 && draw.chance(0.35) ? 1 : 0;
    const name = `s${index}`;
    const at = new Date(time + 60_000).toISOString();
    const moves: (() => Promise<void> | undefined)[] = [];
    const add = (weight: number, move: () => Promise<void> | undefined) => {
      for (let i = 0; i < weight; i++) moves.push(move);
    };
    for (const [which, exported, converted] of IMPORTS)
      if (!imported[writer]?.has(which))
        add(3, async () => {
          imported[writer]?.add(which);
          own[writer]?.push(`${name}-${which}`);
          await perform(
            `${name}-${which}`,
            { kind: "import", export: exported, converted },
            writer,
          );
        });
    add(5, async () => {
      const outputs = 1 + draw.below(2);
      let text = `${PREFIXES}
<${draw.uuid()}> a prov:Activity ;
  rdfs:label "entered in the Cascade app" ;
  prov:qualifiedAssociation [ prov:agent <${ME}> ; prov:hadRole cascade:PatientRole ] .
`;
      for (let output = 0; output < outputs; output++) {
        const named = draw.chance(0.7)
          ? `cascade:allergen "${draw.pick(["Allergen", "allergen"])} ${draw.below(1000)}" ;`
          : "";
        text += `<urn:cascade:output-${output}> a cascade:AllergyOrIntolerance .
<urn:cascade:output-${output}-version> prov:specializationOf <urn:cascade:output-${output}> ;
  ${named} cascade:allergenCode <${draw.pick(CODES)}> ;
  cascade:patient <${CLEO}> .
`;
      }
      await write(`entries/${name}.ttl`, text);
      log.push(`${name}:\n${text}`);
      own[writer]?.push(`${name}-entry`);
      await perform(
        `${name}-entry`,
        { kind: "entry", file: `entries/${name}.ttl` },
        writer,
      );
    });
    const ownSteps = own[writer] ?? [];
    if (ownSteps.length > 0)
      add(3, () =>
        perform(
          `${name}-matcher`,
          draw.chance(0.2)
            ? { kind: "matcher" }
            : { kind: "matcher", takes: draw.pick(ownSteps) },
          writer,
        ),
      );
    if (!referenced[writer])
      add(1, async () => {
        referenced[writer] = true;
        await perform(
          `${name}-map-2`,
          { kind: "reference", name: MAP_2 },
          writer,
        );
      });
    if (writers === 1)
      add(4, async () => {
        writers = 2;
        await perform(`${name}-writer`, { kind: "writer" }, 1);
      });
    if (writers > 1)
      add(2, () =>
        perform(`${name}-sync`, { kind: "sync", from: 1 - writer }, writer),
      );
    const judgmentMove = (
      label: string,
      weight: number,
      make: (pod: CorePod, iri: string) => Promise<string>,
    ) =>
      add(weight, async () => {
        const iri = draw.uuid();
        const file = `judgments/${name}.ttl`;
        written.set(file, async (pod) => {
          const text = await make(pod, iri);
          if (text === "") counts.refused++;
          return text;
        });
        await perform(`${name}-${label}`, { kind: "judgment", file }, writer);
      });
    const records = (pod: CorePod) =>
      column(
        pod,
        `SELECT ?found WHERE { ?revision cascade:revisionOf ?found FILTER NOT EXISTS { ?found a cascade:PatientProfile } FILTER NOT EXISTS { ?found a cascade:Server } }`,
      );
    for (const verdict of ["Same", "Different"])
      judgmentMove(verdict, 2, async (pod, iri) => {
        const all = await records(pod);
        if (all.length < 2) return "";
        const one = draw.pick(all);
        const two = draw.pick(all.filter((record) => record !== one));
        const typed = draw.chance(0.3)
          ? `<${one}> a cascade:Record .
`
          : "";
        return judgment(iri, verdict, [one, two], at) + typed;
      });
    judgmentMove("Before", 2, async (pod, iri) => {
      const twice = await column(
        pod,
        `SELECT ?found WHERE { ?a cascade:revisionOf ?found . ?b cascade:revisionOf ?found FILTER (?a != ?b) }`,
      );
      if (twice.length === 0) return "";
      const record = draw.pick(twice);
      const revisions = await column(
        pod,
        `SELECT ?found WHERE { ?found cascade:revisionOf <${record}> }`,
      );
      const earlier = draw.pick(revisions);
      const later = draw.pick(revisions.filter((each) => each !== earlier));
      return judgment(
        iri,
        "Before",
        [earlier, later],
        at,
        `\n  cascade:earlierMember <${earlier}> ;`,
      );
    });
    judgmentMove("Erroneous", 1, async (pod, iri) => {
      const all = await records(pod);
      if (all.length === 0) return "";
      const record = draw.pick(all);
      const versions = await column(
        pod,
        `SELECT ?found WHERE { ?found prov:specializationOf <${record}> }`,
      );
      return judgment(
        iri,
        "Erroneous",
        [record],
        at,
        `\n  prov:used <${draw.pick(versions)}> ;`,
      );
    });
    judgmentMove("About", 2, async (pod, iri) => {
      const profiles = [
        PROFILE,
        ...(await column(
          pod,
          `SELECT ?found WHERE { ?version prov:specializationOf ?record ; cascade:patient ?found FILTER (?found != <${CLEO}>) }`,
        )),
      ];
      return judgment(
        iri,
        "About",
        [draw.pick(profiles)],
        at,
        `\n  cascade:subject <${CLEO}> ;\n  cascade:basis cascade:OwnerStatement ;`,
      );
    });
    if (ownSteps.length > 0)
      judgmentMove("ClockDiscounted", 1, async (_pod, iri) =>
        judgment(
          iri,
          "ClockDiscounted",
          [`urn:cascade:act-of-step:${draw.pick(ownSteps)}`],
          at,
        ),
      );
    add(2, async () => {
      const file = `judgments/${name}.ttl`;
      written.set(file, async (pod) => {
        const assertions = await column(
          pod,
          `SELECT ?found WHERE { ?found cascade:assertedClaim ?claim }`,
        );
        const mine = await column(
          pod,
          `SELECT ?found WHERE { ?found a cascade:Judgment ; prov:wasAttributedTo <${ME}> }`,
        );
        const open = [...mine, ...assertions].filter(
          (each) => !retracted.has(each),
        );
        if (open.length === 0) {
          counts.refused++;
          return "";
        }
        const target = draw.pick(open);
        retracted.add(target);
        return `${PREFIXES}
<${draw.uuid()}> a prov:Activity ;
  prov:invalidated <${target}> ;
  prov:wasAssociatedWith <${ME}> ;
  prov:startedAtTime "${at}"^^xsd:dateTime .
<${ME}> a prov:Person .
`;
      });
      await perform(`${name}-retraction`, { kind: "judgment", file }, writer);
    });
    await draw.pick(moves)();
  }
  return { steps, counts };
}

test("after every step of stories drawn at random, the build kept across steps holds what a build of the whole pod holds (C8)", async () => {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
    const started = performance.now();
    const { steps, counts } = await story(seed);
    if (process.env["CASCADE_RANDOM_SEEDS"] !== undefined)
      console.log(
        `seed ${seed}: ${steps.length} steps, ${counts.refused} with nothing to judge, ${Math.round(performance.now() - started)} ms`,
      );
  }
});
