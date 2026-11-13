import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import { openPod } from "cascade-runtime";
import { podReads, podsIn } from "cascade-runtime/tools/node";
import {
  type Answer,
  type Door,
  offeredTools,
  type PodReads,
  proposedTurtle,
  type Proposal,
  schemaOf,
  TOOLS,
} from "cascade-runtime/tools";

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

const toolNamed = (name: string) => TOOLS.find((tool) => tool.name === name)!;

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

/** Reads that write, recording what they are asked to. */
function writing() {
  const written: { pod: string; proposal: Proposal; model: unknown }[] = [];
  const reads = {
    write: async (input: (typeof written)[number]) => {
      written.push(input);
      return { entry: "urn:written" };
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
  describe("TOOLS", () => {
    it("lists three tools at the kind `WritingToAPod` and the tier `ask`", () => {
      assert.deepEqual(
        offeredTools()
          .filter(({ tier }) => tier === "ask")
          .map(({ name, kind }) => [name, kind]),
        PROPOSING.map(([name]) => [name, `${CASCADE}WritingToAPod`]),
      );
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

  describe("given input its schema refuses", () => {
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
    await made.close();
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

  after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

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
