import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import { openPod } from "cascade-runtime";
import { Refusal } from "@cascade-runtime/runtime/refusal";
import {
  findRoot,
  FolderFiles,
  readConfig,
  resolveVocabulary,
} from "@cascade-runtime/runtime/node";
import { OxigraphStore, Shapes } from "@cascade-runtime/runtime";
import { podReads, podsIn } from "cascade-runtime/tools/node";
import {
  type Door,
  offeredTools,
  type PodReads,
  schemaOf,
  TOOLS,
} from "cascade-runtime/tools";
import {
  type Answer,
  offeredToolsOf,
  PROPOSAL_TOOLS,
  type Proposal,
  proposedTurtle,
  toolsFor,
} from "cascade-runtime/tools/propose";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWNER = "https://pod.example/profile/card.ttl#me";
const MODEL = {
  iri: "urn:uuid:4f1c0b3e-8a2d-4c57-9e61-0d7b5a3c2f19",
  label: "Test client 1.2.3",
};
const SESSION = "urn:uuid:9a7e3c51-2b84-4d06-8f1a-6c5d0e9b7a42";
const RECORD_A = "urn:uuid:19bf6db0-83b8-8973-a79a-6b36138cb69b";
const RECORD_B = "urn:uuid:df9490a2-ae95-87ef-a856-b899697aaf11";
const JUDGMENT = "urn:uuid:5e068021-5ff8-4580-8246-4f28453ace64";

const ASTHMA = `@prefix cascade: <${CASCADE}> .
@prefix prov: <${PROV}> .
<urn:cascade:output-0> a cascade:ProblemOrDiagnosis .
<urn:cascade:output-0-version> prov:specializationOf <urn:cascade:output-0> ;
  cascade:conditionName "Asthma" ;
  cascade:patient <urn:uuid:1b4e6a52-8c3f-4d71-9e0a-5f2c7d8b9a10> .
`;

const ECZEMA = `@prefix cascade: <${CASCADE}> .
@prefix prov: <${PROV}> .
<urn:cascade:output-0> a cascade:ProblemOrDiagnosis .
<urn:cascade:output-0-version> prov:specializationOf <urn:cascade:output-0> ;
  cascade:conditionName "Eczema" ;
  cascade:patient <PATIENT> .
`;

/** What each tool at ask is given, and the proposal it makes of it. */
const PROPOSING: readonly [string, Record<string, unknown>, Proposal][] = [
  [
    "propose_entry",
    { pod: "p", turtle: ASTHMA },
    { kind: "entry", turtle: ASTHMA },
  ],
  [
    "propose_judgment",
    { pod: "p", verdict: "different", members: [RECORD_A, RECORD_B] },
    { kind: "judgment", verdict: "different", members: [RECORD_A, RECORD_B] },
  ],
  [
    "propose_retraction",
    { pod: "p", judgment: JUDGMENT },
    { kind: "retraction", judgment: JUDGMENT },
  ],
];

const toolNamed = (name: string) =>
  PROPOSAL_TOOLS.find((tool) => tool.name === name)!;

/** A door whose person answers `answer`, with every question it was asked. */
function asking(answer: Answer | "throws") {
  const asked: string[] = [];
  const door: Door = {
    model: MODEL,
    ask: async (question) => {
      asked.push(question);
      if (answer === "throws") throw new Error("the client went away");
      return answer;
    },
  };
  return { asked, door };
}

/** Reads that write, recording what they are asked to; `check` is what the host answers before the person is asked. */
function writing(
  check?: (input: { pod: string; proposal: Proposal }) => Promise<unknown>,
  write?: (input: unknown) => Promise<unknown>,
) {
  const written: { pod: string; proposal: Proposal; model: unknown }[] = [];
  const reads = {
    ...(check === undefined ? {} : { check }),
    write: async (input: (typeof written)[number]) => {
      written.push(input);
      return write === undefined ? { entry: "urn:written" } : write(input);
    },
  } as unknown as PodReads;
  return { written, reads };
}

const refusal = (why: RegExp) => (error: Error) =>
  error.name === "Refusal" && why.test(error.message);

/**
 * A model proposes a write through a tool at the tier `ask`: an entry, a judgment of records, or the retraction of a
 * judgment. The tool shows the person what the call will do through its door, and writes only when the person says yes
 * to that call.
 * @rule runtime/consent.feature Y2
 */
describe("Tools a model proposes a write with · propose_entry, propose_judgment, propose_retraction", () => {
  describe("PROPOSAL_TOOLS", () => {
    it("lists three tools at the kind `WritingToAPod` and the tier `ask`, as `offeredToolsOf()` lists them", () => {
      assert.deepEqual(
        offeredToolsOf({ canAsk: true }).filter(({ tier }) => tier === "ask"),
        PROPOSING.map(([name]) => ({
          name,
          kind: `${CASCADE}WritingToAPod`,
          tier: "ask",
        })),
      );
    });

    it("is offered to a door that can ask the person and to none that cannot, and is no tool of `TOOLS`, which every door offers", () => {
      assert.deepEqual(
        toolsFor({ canAsk: false }).map(({ name }) => name),
        TOOLS.map(({ name }) => name),
      );
      assert.deepEqual(offeredToolsOf({ canAsk: false }), offeredTools());
      assert.deepEqual(
        toolsFor({ canAsk: true }).map(({ name }) => name),
        [...TOOLS, ...PROPOSAL_TOOLS].map(({ name }) => name),
      );
      assert.ok(TOOLS.every(({ tier }) => tier === "free"));
    });

    it("takes the pod's name in every one, beside its own properties", () => {
      for (const [name] of PROPOSING)
        assert.ok(schemaOf(toolNamed(name)).required?.includes("pod"), name);
    });
  });

  describe("given a door that asks the person", () => {
    for (const [name, input, proposal] of PROPOSING) {
      it(`${name} writes the proposal once, naming the model the door names, when the person says yes`, async () => {
        const { reads, written } = writing();
        const { door, asked } = asking("yes");
        const answer = await toolNamed(name).run(reads, input, door);
        assert.deepEqual(written, [{ pod: "p", proposal, model: MODEL }]);
        assert.equal(asked.length, 1);
        assert.equal((answer as { written: boolean }).written, true);
      });

      for (const said of ["no", "dismissed", "unanswered"] as const)
        it(`${name} writes nothing, and says so, when the person's answer is ${said}`, async () => {
          const { reads, written } = writing();
          const { door, asked } = asking(said);
          const answer = await toolNamed(name).run(reads, input, door);
          assert.deepEqual(written, []);
          assert.equal(asked.length, 1);
          assert.deepEqual(answer, { written: false, said });
        });

      it(`${name} writes nothing when the question fails to reach the person`, async () => {
        const { reads, written } = writing();
        await assert.rejects(
          toolNamed(name).run(reads, input, asking("throws").door),
          /the client went away/,
        );
        assert.deepEqual(written, []);
      });

      it(`${name} refuses, and writes nothing, when its door cannot ask`, async () => {
        const { reads, written } = writing();
        await assert.rejects(
          toolNamed(name).run(reads, input, { model: MODEL }),
          refusal(/cannot ask/),
        );
        await assert.rejects(
          toolNamed(name).run(reads, input),
          refusal(/cannot ask/),
        );
        assert.deepEqual(written, []);
      });

      it(`${name} refuses, and asks nothing, when its door names no model`, async () => {
        const { reads, written } = writing();
        const { asked, door } = asking("yes");
        await assert.rejects(
          toolNamed(name).run(reads, input, { ask: door.ask! }),
          refusal(/names no model/),
        );
        assert.deepEqual([asked, written], [[], []]);
      });
    }

    it("asks again for the same proposal, so a yes is for the one call it answers", async () => {
      const { reads, written } = writing();
      const { door, asked } = asking("yes");
      const [, input] = PROPOSING[0]!;
      await toolNamed("propose_entry").run(reads, input, door);
      await toolNamed("propose_entry").run(reads, input, door);
      assert.equal(asked.length, 2);
      assert.equal(written.length, 2);
    });

    it("shows the person the pod, who proposes and what will be written, before it asks", async () => {
      const shown: Record<string, RegExp[]> = {
        propose_entry: [/Test client 1\.2\.3/, /Asthma/, /\bp\b/],
        propose_judgment: [
          /different/,
          new RegExp(RECORD_A),
          new RegExp(RECORD_B),
        ],
        propose_retraction: [new RegExp(JUDGMENT), /retract/i],
      };
      for (const [name, input] of PROPOSING) {
        const { reads } = writing();
        const { door, asked } = asking("no");
        await toolNamed(name).run(reads, input, door);
        for (const part of shown[name]!) assert.match(asked[0]!, part, name);
      }
    });
  });

  describe("given a host that checks a proposal before the person is asked", () => {
    for (const [name, input] of PROPOSING) {
      it(`${name} answers { written: false, refused } and asks nothing when the check refuses`, async () => {
        const { reads, written } = writing(async () => ({
          refused: "the pod would refuse it",
        }));
        const { door, asked } = asking("yes");
        assert.deepEqual(await toolNamed(name).run(reads, input, door), {
          written: false,
          refused: "the pod would refuse it",
        });
        assert.deepEqual([asked, written], [[], []]);
      });

      it(`${name} answers { written: false, refused } when the host refuses the write after the yes`, async () => {
        const { reads } = writing(undefined, async () => {
          throw new Refusal("the pod holds no such thing");
        });
        const { door } = asking("yes");
        assert.deepEqual(await toolNamed(name).run(reads, input, door), {
          written: false,
          refused: "the pod holds no such thing",
        });
      });

      it(`${name} asks the person with the lines the check gave, and none of what the model wrote`, async () => {
        const { reads } = writing(async () => ({
          shown: ["Condition Name: Asthma"],
        }));
        const { door, asked } = asking("no");
        await toolNamed(name).run(reads, input, door);
        assert.match(asked[0]!, /Condition Name: Asthma/);
        assert.doesNotMatch(asked[0]!, /@prefix|urn:cascade:output|<urn:/);
      });
    }

    it("asks for each record of a judgment by what the host showed, not by its IRI", async () => {
      const { reads } = writing(async () => ({
        shown: ["Condition · Asthma · own entry, from Mercy Hospital"],
      }));
      const { door, asked } = asking("no");
      await toolNamed("propose_judgment").run(
        reads,
        { pod: "p", verdict: "erroneous", members: [RECORD_A] },
        door,
      );
      assert.match(asked[0]!, /Condition · Asthma · own entry/);
      assert.doesNotMatch(asked[0]!, new RegExp(RECORD_A));
    });
  });

  describe("given input its schema refuses", () => {
    it("counts a record named twice once: a Same of one record is refused before it asks", async () => {
      for (const verdict of ["same", "different"]) {
        const { reads, written } = writing();
        const { door, asked } = asking("yes");
        await assert.rejects(
          toolNamed("propose_judgment").run(
            reads,
            { pod: "p", verdict, members: [RECORD_A, RECORD_A] },
            door,
          ),
          refusal(/at least 2/),
        );
        assert.deepEqual([asked, written], [[], []]);
      }
    });

    it("proposes each record of a judgment once however often it is named", async () => {
      const { reads, written } = writing();
      await toolNamed("propose_judgment").run(
        reads,
        {
          pod: "p",
          verdict: "same",
          members: [RECORD_A, RECORD_B, RECORD_A],
        },
        asking("yes").door,
      );
      assert.deepEqual(
        (written[0]!.proposal as { members: string[] }).members,
        [RECORD_A, RECORD_B],
      );
    });

    it("refuses a judgment of no records, an unknown verdict and a member that is no IRI, before it asks", async () => {
      for (const input of [
        { pod: "p", verdict: "same", members: [] },
        { pod: "p", verdict: "similar", members: [RECORD_A, RECORD_B] },
        { pod: "p", verdict: "same", members: [RECORD_A, "two words"] },
        { pod: "p", verdict: "same", members: [RECORD_A, "a>b"] },
        { pod: "p", verdict: "same" },
      ]) {
        const { reads, written } = writing();
        const { door, asked } = asking("yes");
        await assert.rejects(
          toolNamed("propose_judgment").run(reads, input, door),
          refusal(/./),
          JSON.stringify(input),
        );
        assert.deepEqual([asked, written], [[], []]);
      }
    });

    it("refuses an entry that is empty, a retraction of no IRI and a call that names no pod, before it asks", async () => {
      for (const [name, input] of [
        ["propose_entry", { pod: "p", turtle: "" }],
        ["propose_entry", { pod: "p", turtle: "<urn:a> <urn:b> <urn:c> ." }],
        ["propose_entry", { turtle: ASTHMA }],
        ["propose_retraction", { pod: "p", judgment: "not an iri" }],
        ["propose_retraction", { pod: "p", judgment: "x>y" }],
      ] as const) {
        const { reads, written } = writing();
        const { door, asked } = asking("yes");
        await assert.rejects(
          toolNamed(name).run(reads, input, door),
          refusal(/./),
          JSON.stringify(input),
        );
        assert.deepEqual([asked, written], [[], []]);
      }
    });
  });
});

/** The statements of `text` as `subject predicate object` lines, a blank node written `_`. */
function statements(text: string): string[] {
  return oxigraph
    .parse(text, { format: "text/turtle", base_iri: "urn:test:" })
    .map((quad) =>
      [quad.subject, quad.predicate, quad.object]
        .map((term) => (term.termType === "BlankNode" ? "_" : term.value))
        .join(" "),
    );
}

/** The agents of `text`'s associations, by the role they act in. */
function associated(text: string): Record<string, string[]> {
  const quads = oxigraph.parse(text, {
    format: "text/turtle",
    base_iri: "urn:test:",
  });
  const roles: Record<string, string[]> = {};
  for (const association of quads.filter(
    (quad) => quad.predicate.value === `${PROV}qualifiedAssociation`,
  )) {
    const of = (predicate: string) =>
      quads
        .filter(
          (quad) =>
            quad.subject.equals(association.object) &&
            quad.predicate.value === predicate,
        )
        .map((quad) => quad.object.value);
    for (const role of of(`${PROV}hadRole`))
      (roles[role.replace(CASCADE, "cascade:")] ??= []).push(
        ...of(`${PROV}agent`),
      );
  }
  return roles;
}

/**
 * What a write a model proposed records, as the vocabulary's rule Y3 says: the act that wrote it has an association in
 * `cascade:ModelProposerRole` whose agent is the model, a `prov:SoftwareAgent` typed in the same file, and one in
 * `cascade:PatientRole` whose agent is the person who said yes, a `prov:Person`.
 * @rule runtime/consent.feature Y3
 */
describe("Recording a write a model proposed · proposedTurtle()", () => {
  const by = { model: MODEL, owner: OWNER, session: SESSION };

  it("gives an entry a session of the door's naming, with the model and the owner in their roles, beside the model's drafts", () => {
    const turtle = proposedTurtle({ kind: "entry", turtle: ASTHMA }, by);
    const lines = statements(turtle);
    assert.ok(
      lines.includes(`${SESSION} ${RDF_TYPE} ${CASCADE}HandEntrySession`),
    );
    assert.deepEqual(associated(turtle), {
      "cascade:ModelProposerRole": [MODEL.iri],
      "cascade:PatientRole": [OWNER],
    });
    assert.ok(lines.includes(`${MODEL.iri} ${RDF_TYPE} ${PROV}SoftwareAgent`));
    assert.ok(lines.includes(`${OWNER} ${RDF_TYPE} ${PROV}Person`));
    assert.ok(
      lines.includes(
        `urn:cascade:output-0 ${RDF_TYPE} ${CASCADE}ProblemOrDiagnosis`,
      ),
    );
    assert.ok(
      !lines.some((line) => line.startsWith(`${SESSION} ${PROV}startedAtTime`)),
      "the host gives the session its time",
    );
  });

  it("gives a judgment the person as its author, and the model's association beside the person's on its act", () => {
    const turtle = proposedTurtle(
      { kind: "judgment", verdict: "erroneous", members: [RECORD_A, RECORD_B] },
      by,
    );
    const lines = statements(turtle);
    assert.ok(
      lines.includes(
        `urn:cascade:this-judgment ${PROV}wasAttributedTo ${OWNER}`,
      ),
    );
    assert.ok(
      lines.includes(
        `urn:cascade:this-judgment ${CASCADE}verdict ${CASCADE}Erroneous`,
      ),
    );
    for (const member of [RECORD_A, RECORD_B])
      assert.ok(
        lines.includes(`urn:cascade:this-judgment ${PROV}hadMember ${member}`),
      );
    assert.deepEqual(associated(turtle), {
      "cascade:ModelProposerRole": [MODEL.iri],
      "cascade:PatientRole": [OWNER],
    });
    assert.ok(
      !lines.some((line) => line.includes(`${PROV}wasAssociatedWith`)),
      "the model is never the judgment's act's unqualified association",
    );
  });

  it("gives a retraction the person as its only unqualified association, and both roles", () => {
    const turtle = proposedTurtle(
      { kind: "retraction", judgment: JUDGMENT },
      by,
    );
    const lines = statements(turtle);
    assert.deepEqual(
      lines.filter((line) => line.includes(`${PROV}wasAssociatedWith`)),
      [`urn:cascade:this-judgment ${PROV}wasAssociatedWith ${OWNER}`],
    );
    assert.ok(
      lines.includes(
        `urn:cascade:this-judgment ${PROV}invalidated ${JUDGMENT}`,
      ),
    );
    assert.ok(
      lines.includes(`urn:cascade:this-judgment ${RDF_TYPE} ${PROV}Activity`),
    );
    assert.deepEqual(associated(turtle), {
      "cascade:ModelProposerRole": [MODEL.iri],
      "cascade:PatientRole": [OWNER],
    });
  });

  it("writes a label with a quote, a backslash and a line break in it as the one label it is", () => {
    const label = 'a "quoted" \\ name\nover two lines';
    const lines = statements(
      proposedTurtle(
        { kind: "retraction", judgment: JUDGMENT },
        { ...by, model: { ...MODEL, label } },
      ),
    );
    assert.ok(
      lines.includes(
        `${MODEL.iri} http://www.w3.org/2000/01/rdf-schema#label ${label}`,
      ),
    );
  });
});

/**
 * Over a folder of pods, `podReads(...).write` files each proposal in the pod, and the files of the act that wrote it
 * hold what Y3 names, alone: the model and the owner, each typed, in their roles.
 * @rule runtime/consent.feature Y3
 */
describe("Recording a write a model proposed in a pod's files · podReads().write", () => {
  const FILED_BY = { iri: MODEL.iri, label: MODEL.label };
  let folder: string;
  let reads: ReturnType<typeof podReads>;
  const files = new Map<string, string>();

  /** The text of the one file of the pod that names `id` and says a model proposed it. */
  const actOf = async (id: string) => {
    const found = [...files].filter(
      ([, text]) =>
        statements(text).some((line) =>
          line.startsWith(`${id} ${RDF_TYPE} `),
        ) && text.includes("ModelProposerRole"),
    );
    assert.equal(found.length, 1, `${found.length} files hold ${id}`);
    return found[0]![1];
  };

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "proposals-"));
    const made = await openPod(join(folder, "p"));
    const subject = made.subject;
    owner = made.owner;
    await made.close();
    patient = subject;
    reads = podReads(podsIn(folder));
    const entry = await reads.write!({
      pod: "p",
      model: FILED_BY,
      proposal: {
        kind: "entry",
        turtle: ASTHMA.replace(/<urn:uuid:1b4e[^>]*>/, `<${subject}>`),
      },
    });
    const { rows } = await reads.ask({
      pod: "p",
      question: "entry/Where it came from",
    });
    await reads.write!({
      pod: "p",
      model: FILED_BY,
      proposal: { kind: "entry", turtle: ECZEMA.replace("PATIENT", subject) },
    });
    const eczema = (
      await reads.ask({ pod: "p", question: "entry/Where it came from" })
    ).rows.find((row) => /Eczema/.test(row.recordLabel ?? ""))!;
    const second = await reads.write!({
      pod: "p",
      model: FILED_BY,
      proposal: {
        kind: "judgment",
        verdict: "erroneous",
        members: [eczema.record!],
      },
    });
    held = { record: eczema.record!, judgment: second.id! };
    const judgment = await reads.write!({
      pod: "p",
      model: FILED_BY,
      proposal: {
        kind: "judgment",
        verdict: "erroneous",
        members: [rows[0]!.record!],
      },
    });
    const retraction = await reads.write!({
      pod: "p",
      model: FILED_BY,
      proposal: { kind: "retraction", judgment: judgment.id! },
    });
    ids = {
      entry: entry.id!,
      judgment: judgment.id!,
      retraction: retraction.id!,
    };
    await reads.close();
    for (const name of await readdir(join(folder, "p"), { recursive: true }))
      if (name.endsWith(".ttl"))
        files.set(name, await readFile(join(folder, "p", name), "utf8"));
  });

  let ids: { entry: string; judgment: string; retraction: string };
  let owner: string;
  let patient: string;
  let held: { record: string; judgment: string };

  after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

  /** The files of the pod now: the same as the snapshot unless something was written. */
  const filesNow = async () =>
    (await readdir(join(folder, "p"), { recursive: true }))
      .filter((name) => name.endsWith(".ttl"))
      .sort();

  /** What the check says of `proposal`, and what a write of it answers, over a fresh read of the pod; nothing is written. */
  async function refusedBy(proposal: Proposal) {
    const again = podReads(podsIn(folder));
    try {
      const before = await filesNow();
      const checked = await again.check!({ pod: "p", proposal });
      const written = await again.write!({
        pod: "p",
        proposal,
        model: FILED_BY,
      });
      assert.deepEqual(await filesNow(), before, "no file was added");
      return { checked, written };
    } finally {
      await again.close();
    }
  }

  const PREFIXED = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n`;
  const UNKNOWN_PROPOSALS: readonly [string, () => Proposal][] = [
    [
      "an entry that types the owner as a software agent",
      () => ({
        kind: "entry",
        turtle: `${PREFIXED}${ASTHMA.replace(/<urn:uuid:1b4e[^>]*>/, `<${patient}>`)}<${owner}> a prov:SoftwareAgent ; rdfs:label "Mallory" .`,
      }),
    ],
    [
      "an entry that types the model as a person",
      () => ({
        kind: "entry",
        turtle: `${ASTHMA.replace(/<urn:uuid:1b4e[^>]*>/, `<${patient}>`)}<${MODEL.iri}> a prov:Person .`,
      }),
    ],
    [
      "an entry about a subject that is no draft",
      () => ({
        kind: "entry",
        turtle: `${ASTHMA.replace(/<urn:uuid:1b4e[^>]*>/, `<${patient}>`)}<urn:cascade:elsewhere> a cascade:ProblemOrDiagnosis .`,
      }),
    ],
    [
      "an entry that states a property the vocabulary does not declare",
      () => ({
        kind: "entry",
        turtle: ASTHMA.replace(/<urn:uuid:1b4e[^>]*>/, `<${patient}>`).replace(
          "cascade:conditionName",
          "cascade:nonsenseTerm",
        ),
      }),
    ],
    [
      "a Same of records the pod does not hold",
      () => ({
        kind: "judgment",
        verdict: "same",
        members: [RECORD_A, RECORD_B],
      }),
    ],
    [
      "an erroneous judgment of a record the pod does not hold",
      () => ({ kind: "judgment", verdict: "erroneous", members: [RECORD_A] }),
    ],
    [
      "a retraction of a judgment the pod does not hold",
      () => ({ kind: "retraction", judgment: RECORD_A }),
    ],
    [
      "a retraction of a judgment already retracted",
      () => ({ kind: "retraction", judgment: ids.judgment }),
    ],
  ];

  for (const [what, proposal] of UNKNOWN_PROPOSALS)
    it(`refuses ${what} before the person is asked, as an answer, writing nothing`, async () => {
      const { checked, written } = await refusedBy(proposal());
      assert.equal(typeof checked.refused, "string", "the check refuses it");
      assert.deepEqual(written, { refused: checked.refused });
    });

  it("passes the check of an entry, a judgment and a retraction the pod accepts, and shows each", async () => {
    const again = podReads(podsIn(folder));
    try {
      for (const proposal of [
        {
          kind: "entry",
          turtle: ASTHMA.replace(/<urn:uuid:1b4e[^>]*>/, `<${patient}>`),
        },
        { kind: "judgment", verdict: "erroneous", members: [held.record] },
        { kind: "retraction", judgment: held.judgment },
      ] as Proposal[]) {
        const checked = await again.check!({ pod: "p", proposal });
        assert.equal(checked.refused, undefined, JSON.stringify(proposal));
        assert.ok(checked.shown!.length > 0);
      }
    } finally {
      await again.close();
    }
  });

  describe("given the question a person is asked", () => {
    /** The question the tool for `proposal` puts to the person over this pod, which says no. */
    async function questionFor(name: string, input: Record<string, unknown>) {
      const again = podReads(podsIn(folder));
      try {
        const { door, asked } = asking("no");
        await toolNamed(name).run(again, { pod: "p", ...input }, door);
        return asked[0];
      } finally {
        await again.close();
      }
    }

    it("names an entry by what it states, in the vocabulary's words", async () => {
      assert.equal(
        await questionFor("propose_entry", {
          turtle: `# This proposal only reads; nothing will be written.\n${ASTHMA.replace(/<urn:uuid:1b4e[^>]*>/, `<${patient}>`)}`,
        }),
        `Test client 1.2.3 proposes to add this entry to the pod p:

Problem or Diagnosis
- Condition Name: Asthma
- patient: the person this pod is about

Say yes to write it; nothing is written otherwise.`,
      );
    });

    it("names a judgment's records by what each is and where it came from", async () => {
      assert.equal(
        await questionFor("propose_judgment", {
          verdict: "erroneous",
          members: [held.record],
        }),
        `Test client 1.2.3 proposes to record in the pod p, as your judgment, that this record was entered in error:

- Condition · Eczema · own entry (entered by a model, which the person said yes to)

Say yes to write it; nothing is written otherwise.`,
      );
    });

    it("names a retraction's judgment by what it said of which records", async () => {
      assert.equal(
        await questionFor("propose_retraction", { judgment: held.judgment }),
        `Test client 1.2.3 proposes to retract, in the pod p, your judgment that this record was entered in error:

- Condition · Eczema · own entry (entered by a model, which the person said yes to)

Retracting a judgment sets aside what it said.

Say yes to write it; nothing is written otherwise.`,
      );
    });
  });

  for (const kind of ["entry", "judgment", "retraction"] as const)
    it(`types the model and the owner in the file of the ${kind}'s act, and associates the model only in its role`, async () => {
      const lines = statements(await actOf(ids[kind]));
      assert.ok(
        lines.includes(`${MODEL.iri} ${RDF_TYPE} ${PROV}SoftwareAgent`),
      );
      assert.ok(
        lines.some(
          (line) =>
            line.endsWith(` ${RDF_TYPE} ${PROV}Person`) &&
            line.includes("/profile/card.ttl#me"),
        ),
      );
      assert.ok(
        !lines.some(
          (line) =>
            line.includes(`${PROV}wasAssociatedWith`) &&
            line.endsWith(` ${MODEL.iri}`),
        ),
        "the model is no unqualified association",
      );
      assert.equal(
        lines.filter((line) => line.endsWith(` ${CASCADE}ModelProposerRole`))
          .length,
        1,
      );
    });
});

/**
 * What `proposedTurtle` gives is held to the vocabulary's shapes, those of a person's judgment, of a retraction and of a
 * write a model proposed, as the vocabulary's examples are.
 * @rule runtime/consent.feature Y3
 */
describe("Recording a write a model proposed under the vocabulary's shapes · proposedTurtle()", () => {
  let shapes: Shapes;
  before(async () => {
    const root = findRoot(dirname(fileURLToPath(import.meta.url)));
    const { folder } = await resolveVocabulary(root, await readConfig(root));
    shapes = await Shapes.read(
      new FolderFiles(folder),
      () => new OxigraphStore(),
    );
  });

  const NAMED = "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const at = (kind: "generatedAtTime" | "startedAtTime") =>
    `<${NAMED}> <${PROV}${kind}> "2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`;
  const by = { model: MODEL, owner: OWNER, session: SESSION };

  it("breaks no shape for a judgment, as the pod files it", async () => {
    const turtle = `${proposedTurtle({ kind: "judgment", verdict: "same", members: [RECORD_A, RECORD_B] }, by).replaceAll("urn:cascade:this-judgment", NAMED)}\n${at("generatedAtTime")}`;
    assert.deepEqual(
      await shapes.resultLines(
        await new OxigraphStore().parse(turtle, "urn:test:"),
      ),
      [],
    );
  });

  it("breaks no shape for a retraction of a judgment, as the pod files it", async () => {
    const turtle = `${proposedTurtle({ kind: "retraction", judgment: JUDGMENT }, by).replaceAll("urn:cascade:this-judgment", NAMED)}\n${at("startedAtTime")}\n<${JUDGMENT}> a <${CASCADE}Judgment> ; <${CASCADE}verdict> <${CASCADE}Same> ; <${PROV}wasAttributedTo> <${OWNER}> .`;
    assert.deepEqual(
      (
        await shapes.resultLines(
          await new OxigraphStore().parse(turtle, "urn:test:"),
        )
      ).filter((line) => line.startsWith(NAMED)),
      [],
    );
  });

  it("breaks a shape when the model is the judgment's author, which the proposal never is", async () => {
    const turtle = `${proposedTurtle(
      { kind: "judgment", verdict: "same", members: [RECORD_A, RECORD_B] },
      by,
    )
      .replaceAll("urn:cascade:this-judgment", NAMED)
      .replace(
        `prov:wasAttributedTo <${OWNER}>`,
        `prov:wasAttributedTo <${MODEL.iri}>`,
      )}\n${at("generatedAtTime")}`;
    assert.notDeepEqual(
      await shapes.resultLines(
        await new OxigraphStore().parse(turtle, "urn:test:"),
      ),
      [],
    );
  });
});
