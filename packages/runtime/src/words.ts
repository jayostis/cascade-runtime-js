import { type Files, readText } from "./files.js";
import { Graph } from "./graph.js";
import { ccdaRecordName, documentName, inUtc, recordName } from "./names.js";
import { MATCHER } from "./matcher.js";
import { iri, RDF, written } from "./rdf.js";
import { referenceIndex, versionsNumbered } from "./references.js";
import type { Replayed } from "./replay.js";
import { REC } from "./step.js";
import { selected, type Store } from "./store.js";

export const PROV = "http://www.w3.org/ns/prov#";
export const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
export const HEALTH = "https://ns.cascadeprotocol.org/health/v1#";
export const CLINICAL = "https://ns.cascadeprotocol.org/clinical/v1#";
export const PAV = "http://purl.org/pav/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const FOAF = "http://xmlns.com/foaf/0.1/";
const PIM = "http://www.w3.org/ns/pim/space#";

export const KINDS: Readonly<Record<string, string>> = {
  allergy: `${HEALTH}AllergyRecord`,
  condition: `${HEALTH}ConditionRecord`,
  immunization: `${HEALTH}ImmunizationRecord`,
  procedure: `${CLINICAL}Procedure`,
};

export const JUSTIFICATIONS: Readonly<Record<string, string>> = {
  "same code": `${JDG}SameCode`,
  "same code and date": `${JDG}SameCodeAndDate`,
  "same mapped code": `${JDG}SameMappedCode`,
  "same mapped code and date": `${JDG}SameMappedCodeAndDate`,
};

const CODES: Readonly<Record<string, (code: string) => string>> = {
  SNOMED: (code) =>
    `{ ?version ?coded <http://snomed.info/sct/${code}> } UNION { ?version <${CLINICAL}snomedCode> ${JSON.stringify(code)} }`,
  RxNorm: (code) =>
    `?version ?coded <http://www.nlm.nih.gov/research/umls/rxnorm/${code}>`,
  CVX: (code) => `?version <${HEALTH}vaccineCode> ${JSON.stringify(code)}`,
};

const NAMES = [
  `${HEALTH}allergen`,
  `${HEALTH}conditionName`,
  `${HEALTH}vaccineName`,
  `${CLINICAL}procedureName`,
];

/** A person `people.ttl` names: the pod's subject, its address, and the folder of their scripted input. */
export interface Person {
  readonly name: string;
  readonly subject: string;
  readonly address: string;
  /** The folder of the person's scripted input in the vocabulary, without a trailing slash. */
  readonly folder: string;
}

/** The people of the scripted input beside a feature file, by name. */
export async function peopleOf(
  vocabulary: Files,
  folder: string,
  parse: (turtle: string, base: string) => Promise<Graph>,
): Promise<Map<string, Person>> {
  const path = `${folder}/scripted-input/people.ttl`;
  const bytes = await vocabulary.read(path);
  const people = new Map<string, Person>();
  if (bytes === undefined) return people;
  const graph = await parse(
    new TextDecoder().decode(bytes),
    vocabulary.iri + path,
  );
  for (const subject of graph.subjects(`${FOAF}name`)) {
    const [name] = graph.objects(subject, `${FOAF}name`);
    const [address] = graph.objects(subject, `${PIM}storage`);
    if (name === undefined || address === undefined) continue;
    if (!address.value.endsWith("/"))
      throw new Error(
        `${path} gives ${name.value} the pod ${address.value}, which does not end in a slash`,
      );
    people.set(name.value, {
      name: name.value,
      subject: subject.value,
      address: address.value,
      folder: `${folder}/scripted-input/${name.value.toLowerCase()}`,
    });
  }
  return people;
}

interface Handles {
  readonly records?: Record<string, Record<string, unknown>>;
  readonly profiles?: Record<string, Record<string, unknown>>;
  readonly judgments?: Record<string, string>;
}

/** Splits a list of things in words, joined by `,`, `and` or `or`, outside quotes. */
export function listed(words: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < words.length; i++) {
    const rest = words.slice(i);
    if (words[i] === '"') quoted = !quoted;
    if (!quoted) {
      const joint = /^(, and |, or |, | and | or )/.exec(rest);
      if (joint !== null) {
        parts.push(current.trim());
        current = "";
        i += joint[0].length - 1;
        continue;
      }
    }
    current += words[i];
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== "");
}

/** Things named in words, resolved over one pod as an example reads it. */
export class Words {
  readonly #store: Store;
  readonly #replayed: Replayed;
  readonly #vocabulary: Files;
  readonly #person: Person;
  readonly #people: ReadonlyMap<string, Person>;
  readonly #handles: Handles | undefined;
  readonly #kit: string;
  #references: Promise<Graph> | undefined;
  readonly #names = new Map<string, string>();

  constructor(options: {
    readonly store: Store;
    readonly replayed: Replayed;
    readonly vocabulary: Files;
    readonly person: Person;
    readonly people: ReadonlyMap<string, Person>;
    /** The folder of the feature file, which a kit's `expected/handles.json` is under. */
    readonly folder: string;
    readonly handles?: Handles;
  }) {
    this.#store = options.store;
    this.#replayed = options.replayed;
    this.#vocabulary = options.vocabulary;
    this.#person = options.person;
    this.#people = options.people;
    this.#handles = options.handles;
    this.#kit = options.folder;
  }

  static async handlesOf(
    vocabulary: Files,
    folder: string,
  ): Promise<Handles | undefined> {
    const bytes = await vocabulary.read(`${folder}/expected/handles.json`);
    return bytes === undefined
      ? undefined
      : (JSON.parse(new TextDecoder().decode(bytes)) as Handles);
  }

  /** The words an IRI was named by in this example, or the IRI. */
  shown(name: string): string {
    return this.#names.get(name) ?? `<${name}>`;
  }

  #remember(words: string, name: string): string {
    if (!this.#names.has(name)) this.#names.set(name, words);
    return name;
  }

  #select(query: string): Promise<string[][]> {
    return selected(this.#store, query);
  }

  async #one(words: string, query: string, what = "thing"): Promise<string> {
    const found = [
      ...new Set((await this.#select(query)).map(([v]) => v ?? "")),
    ];
    if (found.length !== 1)
      throw new Error(
        `"${words}" names ${found.length === 0 ? "no" : String(found.length)} ${what}${found.length > 1 ? "s" : ""} in the pod`,
      );
    return this.#remember(words, found[0] ?? "");
  }

  #references_(): Promise<Graph> {
    this.#references ??= referenceIndex(
      this.#vocabulary,
      this.#person.folder,
      (bytes, base) => this.#store.parse(bytes, base),
    );
    return this.#references;
  }

  /** What references.ttl states about a series or a version, less the version a series ships with, each triple written. */
  async described(name: string): Promise<string[]> {
    return (await this.#references_())
      .match(iri(name))
      .filter(([, predicate]) => predicate.value !== `${REC}shipsWith`)
      .map((triple) => triple.map(written).join(" "));
  }

  /** A reference series by its label, or a version as `<label> version <version>`, as references.ttl names it. */
  async reference(words: string): Promise<string | undefined> {
    const index = await this.#references_();
    const series = index
      .subjects(`${RDFS}label`)
      .find(
        (subject) => index.objects(subject, `${RDFS}label`)[0]?.value === words,
      );
    if (series !== undefined) return this.#remember(words, series.value);
    const versioned = /^(.+) version (\S+)$/.exec(words);
    const [version] =
      versioned === null
        ? []
        : versionsNumbered(index, versioned[1] ?? "", versioned[2] ?? "");
    return version === undefined ? undefined : this.#remember(words, version);
  }

  async #handle(handle: string): Promise<string | undefined> {
    const judgment = this.#handles?.judgments?.[handle];
    if (judgment !== undefined) return judgment;
    const inputs =
      this.#handles?.records?.[handle] ?? this.#handles?.profiles?.[handle];
    if (inputs === undefined) return undefined;
    const { server, type, id, entry, position, download } = inputs;
    if (
      typeof server === "string" &&
      typeof type === "string" &&
      typeof id === "string"
    )
      return recordName([server, type, id]);
    if (typeof entry === "string" && typeof position === "number") {
      const file = entry.slice(entry.lastIndexOf("/entries/") + 1);
      const step = this.#replayed.steps.find(
        ({ step: done }) =>
          done.happened.kind === "entry" && done.happened.file === file,
      );
      if (step === undefined)
        throw new Error(
          `${handle} names the entry ${entry}, which no step made`,
        );
      return recordName([
        this.#person.subject,
        inUtc(step.step.when),
        String(position),
      ]);
    }
    if (typeof inputs.class === "string") {
      const { identifier, key } = inputs;
      if (
        (identifier !== undefined && typeof identifier !== "string") ||
        (key !== undefined &&
          (!Array.isArray(key) || key.some((part) => typeof part !== "string")))
      )
        throw new Error(
          `handles.json gives ${handle} an identifier or a key it cannot read`,
        );
      return ccdaRecordName({
        class: inputs.class,
        ...(identifier === undefined ? {} : { identifier }),
        ...(key === undefined ? {} : { key: key as string[] }),
      });
    }
    if (typeof download === "string") {
      const document = await this.#document(`${this.#kit}/${download}`);
      return this.#one(
        handle,
        `SELECT DISTINCT ?record WHERE { ?revision <${REC}revisionOf> ?record ; <${PROV}wasDerivedFrom> <${document}> }`,
        "record",
      );
    }
    throw new Error(`handles.json gives ${handle} no name inputs`);
  }

  async #document(path: string): Promise<string> {
    const bytes = await this.#vocabulary.read(path);
    if (bytes === undefined)
      throw new Error(`${this.#vocabulary.iri}${path} does not exist`);
    return documentName(bytes);
  }

  /** A record in words: a handle, or its kind with its code, its name or both, and `from <source>` where needed. */
  async record(words: string): Promise<string> {
    const handled = await this.#handle(words);
    if (handled !== undefined) return this.#remember(words, handled);
    const said =
      /^(allergy|condition|immunization|procedure)(?: (SNOMED|RxNorm|CVX) (\S+))?(?: "([^"]*)")?(?: from (\S+))?$/.exec(
        words,
      );
    if (said === null || (said[2] === undefined && said[4] === undefined))
      throw new Error(`"${words}" names no record`);
    const [, kind, system, code, name, source] = said;
    const type = KINDS[kind ?? ""] ?? "";
    const coded =
      system === undefined
        ? ""
        : `${(CODES[system] as (code: string) => string)(code ?? "")} .`;
    const named =
      name === undefined
        ? ""
        : `?version ?named ${JSON.stringify(name)} FILTER (?named IN (${NAMES.map((n) => `<${n}>`).join(", ")})) .`;
    const from =
      source === undefined
        ? ""
        : `?record <${HEALTH}sourceRecordId> ${JSON.stringify(source)} .`;
    return this.#one(
      words,
      `SELECT DISTINCT ?record WHERE { ?record a <${type}> . ?version <${PROV}specializationOf> ?record . ${coded} ${named} ${from} }`,
      "record",
    );
  }

  /** A judgment in words: a person's by its handle or its file's name, or `the matcher's <justification> of <records>`. */
  async judgment(words: string): Promise<string> {
    const handled = this.#handles?.judgments?.[words];
    if (handled !== undefined) return this.#remember(words, handled);
    const filed = /^"([^"]+)"$/.exec(words);
    if (filed !== null) {
      const path = `${this.#person.folder}/judgments/${filed[1] ?? ""}.ttl`;
      const graph = new Graph(
        await this.#store.parse(
          await readText(this.#vocabulary, path),
          this.#vocabulary.iri + path,
        ),
      );
      const [judgment] = graph.subjects(`${RDF}type`, iri(`${JDG}Judgment`));
      if (judgment === undefined) throw new Error(`${path} holds no judgment`);
      return this.#remember(words, judgment.value);
    }
    const machine = /^the matcher's (.+?) of (.+)$/.exec(words);
    const justification = JUSTIFICATIONS[machine?.[1] ?? ""];
    if (machine === null || justification === undefined)
      throw new Error(`"${words}" names no judgment`);
    const members = await Promise.all(
      listed(machine[2] ?? "").map((record) => this.record(record)),
    );
    const found = (
      await this
        .#select(`SELECT ?judgment (GROUP_CONCAT(STR(?member); separator=" ") AS ?members) WHERE {
        ?judgment <${PROV}wasAttributedTo> <${MATCHER}> ; <${JDG}justification> <${justification}> ; <${PROV}hadMember> ?member
      } GROUP BY ?judgment`)
    ).filter(
      ([, held]) =>
        (held ?? "").split(" ").sort().join(" ") ===
        [...members].sort().join(" "),
    );
    if (found.length !== 1)
      throw new Error(
        `"${words}" names ${found.length === 0 ? "no" : String(found.length)} judgment${found.length === 1 ? "" : "s"} in the pod`,
      );
    return this.#remember(words, found[0]?.[0] ?? "");
  }

  /** A version, `version N of <record>`: the record's versions are numbered in the order its revisions first name them. */
  async versions(record: string): Promise<string[]> {
    return (
      await this.#select(`SELECT ?version (MIN(?at) AS ?first) WHERE {
        ?revision <${REC}revisionOf> <${record}> ; <${REC}version> ?version ; <${PROV}generatedAtTime> ?at
      } GROUP BY ?version ORDER BY ?first`)
    ).map(([version]) => version ?? "");
  }

  /** Anything in words: a record, profile or person; a judgment; a reference series or version; a version of a record; a document. */
  async thing(words: string): Promise<string> {
    const person = this.#people.get(words);
    if (person !== undefined) return this.#remember(words, person.subject);
    const version = /^version (\d+) of (.+)$/.exec(words);
    if (version !== null) {
      const record = await this.record(version[2] ?? "");
      const found = (await this.versions(record))[Number(version[1]) - 1];
      if (found === undefined) throw new Error(`"${words}" names no version`);
      return this.#remember(words, found);
    }
    const document = /^the document (?:of (.+)|"([^"]+)")$/.exec(words);
    if (document?.[2] !== undefined)
      return this.#remember(
        words,
        await this.#document(`${this.#person.folder}/downloads/${document[2]}`),
      );
    if (document?.[1] !== undefined) {
      const record = await this.record(document[1]);
      return this.#one(
        words,
        `SELECT DISTINCT ?document WHERE {
          ?revision <${REC}revisionOf> <${record}> ; <${PROV}wasDerivedFrom> ?document .
          FILTER NOT EXISTS { ?revision <${PROV}wasRevisionOf> ?earlier }
        }`,
        "document",
      );
    }
    const reference = await this.reference(words);
    if (reference !== undefined) return reference;
    if (
      /^"[^"]+"$|^the matcher's /.test(words) ||
      this.#handles?.judgments?.[words] !== undefined
    )
      return this.judgment(words);
    return this.record(words);
  }
}
