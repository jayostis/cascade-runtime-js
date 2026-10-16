import assert from "node:assert/strict";
import { after, test } from "node:test";
import { render } from "preact-render-to-string";
import { loadHospital, loadStories } from "@cascade-runtime/demo-hospital/node";
import {
  changesIn,
  type Finding,
  labSeriesIn,
  openPod,
  type Pod,
  pullFiles,
  type Row,
  timelineIn,
} from "cascade-runtime";
import { pulled } from "./hospitals.js";

const view = await import(
  new URL("../../starter/summary.mjs", import.meta.url).href
);
const { trendPath } = (await import(
  new URL("../../starter/pods.mjs", import.meta.url).href
)) as { trendPath: (pod: string, trend: object) => string };

const ALLERGIES = "pod/My active allergies";
const CONDITIONS = "pod/My active conditions";
const LABS = "pod/My lab results";
const MEDICATIONS = "pod/My active medications";
const SEEN = "pod/What was seen more than once";
const REVIEW = "entry/What needs review";

test("worth a look: each thing that needs review, with its entry and the Needs review tag, and nothing for what was seen more than once", () => {
  const at = (entry: string, place: string, places: number) => ({
    entry,
    place,
    records: "1",
    places: String(places),
  });
  const answers = {
    [ALLERGIES]: [
      { entry: "e1", allergen: "Penicillin" },
      { entry: "e5", allergen: "Sulfamethoxazole" },
      { entry: "e6" },
    ],
    [CONDITIONS]: [
      { entry: "e2", condition: "Asthma" },
      { entry: "e3", condition: "Eczema" },
      { entry: "e4", condition: "Migraine" },
      { entry: "e7", condition: "Acute viral pharyngitis" },
    ],
    [MEDICATIONS]: [
      { entry: "e8", medication: "Lisinopril 10 MG Oral Tablet" },
      { entry: "e11" },
    ],
    [SEEN]: [
      at("e1", "Meridian Health System", 3),
      at("e1", "Larkspur Valley Health", 3),
      at("e1", "entered by Alex in the Cascade app", 3),
      at("e2", "Cascade North Demo Hospital", 1),
      at("e3", "Larkspur Valley Health", 1),
      at("e4", "Larkspur Valley Health", 1),
    ],
    [REVIEW]: [
      { entry: "e5", needs: "members disagree on criticality" },
      { entry: "e2", needs: "joined through two kinds of machine sameness" },
      { entry: "e3", needs: "judged different, still joined" },
      { entry: "e3", needs: "judged different, still joined" },
      {
        entry: "e9",
        entryLabel: "Allergy entry · Latex",
        needs: "judged different, still joined",
      },
      { entry: "e6", needs: "members disagree on criticality" },
      { entry: "e10", needs: "judged different, still joined" },
      { entry: "e4", needs: "same code, dates cannot tell" },
      {
        entry: "e7",
        needs: "joined before, apart under newer tables or rules",
      },
      {
        entry: "e6",
        needs: "joined before, apart under newer tables or rules",
      },
      {
        entry: "e8",
        needs: "possibly the same medication",
        otherRecord: "r1",
        otherRecordLabel: "Medication · Zestril · own entry",
      },
      {
        entry: "e8",
        needs: "possibly the same medication",
        otherRecord: "r2",
        otherRecordLabel: "Medication · no name · own entry",
      },
      {
        entry: "e11",
        needs: "possibly the same medication",
        otherRecord: "r3",
      },
    ],
  };
  const shared =
    "Cascade cannot confirm that the shared code names one product, so they may or may not be the same.";
  assert.deepEqual(
    view
      .worthALook(answers)
      .map(({ entry, sentence, tag }: Record<string, string>) => [
        entry,
        sentence,
        tag,
      ]),
    [
      [
        "e5",
        "Sources disagree on how severe the Sulfamethoxazole allergy is.",
        "Needs review",
      ],
      ["e2", "Asthma was matched in two different ways.", "Needs review"],
      [
        "e3",
        "Eczema was marked as different, but is still shown as one condition.",
        "Needs review",
      ],
      [
        "e9",
        "Latex was marked as different, but is still shown as one allergy.",
        "Needs review",
      ],
      [
        "e6",
        "Sources disagree on how severe an unnamed allergy is.",
        "Needs review",
      ],
      [
        "e10",
        "An entry was marked as different, but is still shown as one entry.",
        "Needs review",
      ],
      [
        "e4",
        "Migraine was recorded more than once, and its dates cannot tell whether it is one condition or several.",
        "Needs review",
      ],
      [
        "e7",
        "Acute viral pharyngitis was kept as one condition with another before; newer reference tables or rules no longer match them, so they are shown apart.",
        "Needs review",
      ],
      [
        "e6",
        "An unnamed allergy was kept as one allergy with another before; newer reference tables or rules no longer match them, so they are shown apart.",
        "Needs review",
      ],
      [
        "e8",
        `Lisinopril 10 MG Oral Tablet shares a code with Zestril, which Cascade keeps apart. ${shared}`,
        "Needs review",
      ],
      [
        "e8",
        `Lisinopril 10 MG Oral Tablet shares a code with another medication, which Cascade keeps apart. ${shared}`,
        "Needs review",
      ],
      [
        "e11",
        `An unnamed medication shares a code with another medication, which Cascade keeps apart. ${shared}`,
        "Needs review",
      ],
    ],
  );
  const part = (href?: (entry: string) => string) =>
    render(view.worthPart(view.worthALook(answers), href));
  assert.ok(part((entry) => `/e/${entry}`).includes('<a href="/e/e5">'));
  assert.ok(!part().includes("<a "), "plain text with no address to link");
  assert.equal(view.worthPart([]), undefined);
});

test("worth a look: two medications in two entries whose codes share an ingredient are shown apart, once for each pair in the order of the section even when an entry's rows are not adjacent, a combination of one MIN said as a combination, and one entry's own rows, a medication with no code or two entries that share a code give nothing, since What needs review lists those", () => {
  const RXNORM = "https://ns.cascadeprotocol.org/codes/rxnorm/";
  const ingredients = (...codes: string[]) => ({
    ingredients: { codes: codes.map((code) => RXNORM + code), origin: "urn:v" },
  });
  const about = new Map<string, unknown>([
    [RXNORM + "197361", ingredients("17767")],
    [RXNORM + "212550", ingredients("17767")],
    [RXNORM + "308135", ingredients("17767", "5640")],
    [RXNORM + "1", ingredients("5640")],
    [RXNORM + "9", ingredients("777")],
    [RXNORM + "10", ingredients("777")],
    [RXNORM + "20", ingredients("888")],
    [RXNORM + "21", ingredients("888")],
    [
      RXNORM + "777",
      { name: { label: "hydrochlorothiazide / lisinopril", altLabels: [] } },
    ],
    [RXNORM + "17767", { name: { label: "amlodipine", altLabels: [] } }],
  ]);
  const answers = (...rows: Record<string, string>[]) => ({
    [MEDICATIONS]: rows,
  });
  const lines = (rows: object) =>
    view
      .worthALook(rows, about)
      .map(({ entry, sentence, tag }: Record<string, string>) => [
        entry,
        sentence,
        tag,
      ]);
  const all = answers(
    {
      entry: "e1",
      medication: "amlodipine 5 MG Oral Tablet",
      code: RXNORM + "197361",
    },
    {
      entry: "e2",
      medication: "Norvasc 10 MG Oral Tablet",
      code: RXNORM + "212550",
    },
    { entry: "e3", medication: "Aspirin" },
    { entry: "e4", medication: "Pain relief", code: RXNORM + "1" },
    { entry: "e5", medication: "Combined", code: RXNORM + "308135" },
    { entry: "e6", medication: "Zestoretic", code: RXNORM + "9" },
    { entry: "e7", medication: "Prinzide", code: RXNORM + "10" },
    { entry: "e8", medication: "Metformin", code: RXNORM + "20" },
    { entry: "e9", medication: "Glucophage XR", code: RXNORM + "21" },
    { entry: "e9", medication: "Glucophage", code: RXNORM + "20" },
  );
  assert.deepEqual(lines(all), [
    [
      "e1",
      "Amlodipine 5 MG Oral Tablet and Norvasc 10 MG Oral Tablet share an ingredient, amlodipine, and are shown apart.",
      undefined,
    ],
    [
      "e1",
      "Amlodipine 5 MG Oral Tablet and Combined share an ingredient, amlodipine, and are shown apart.",
      undefined,
    ],
    [
      "e2",
      "Norvasc 10 MG Oral Tablet and Combined share an ingredient, amlodipine, and are shown apart.",
      undefined,
    ],
    [
      "e4",
      "Pain relief and Combined share an ingredient, 5640, and are shown apart.",
      undefined,
    ],
    [
      "e6",
      "Zestoretic and Prinzide share the combination, hydrochlorothiazide / lisinopril, and are shown apart.",
      undefined,
    ],
  ]);

  const series = {
    iri: "urn:test:rxnorm",
    label: "RxNorm",
    credit: "RxNorm, NLM.",
    versions: [{ iri: "urn:v", label: "1", issued: "2026-10-01" }],
  };
  const sourced = {
    ...all,
    "entry/Where it came from": all[MEDICATIONS].map((row) => ({
      ...row,
      record: `r-${row.entry}`,
    })),
  };
  const sentenceOf = (id: string, held: object[]) =>
    view
      .entryOf(sourced, id, { about, held })
      .known.map(({ sentence, from }: { sentence: string; from?: object }) => [
        sentence,
        from === undefined ? undefined : "from a table",
      ])
      .filter(([sentence]: string[]) => sentence?.includes("share an"));
  assert.deepEqual(
    sentenceOf("e2", [series]).map(([sentence]: string[]) => sentence),
    [
      "Amlodipine 5 MG Oral Tablet and Norvasc 10 MG Oral Tablet share an ingredient, amlodipine, and are shown apart.",
      "Norvasc 10 MG Oral Tablet and Combined share an ingredient, amlodipine, and are shown apart.",
    ],
    "the second medication of a pair says it too, and so does the first of the next",
  );
  assert.deepEqual(
    sentenceOf("e2", [series]).map(([, from]: string[]) => from),
    ["from a table", "from a table"],
  );
  assert.deepEqual(
    sentenceOf("e2", []),
    [],
    "a line from a table that is not held is not said",
  );
  assert.deepEqual(sentenceOf("e3", [series]), []);
  assert.deepEqual(
    lines(
      answers(
        {
          entry: "e1",
          medication: "amlodipine 5 MG Oral Tablet",
          code: RXNORM + "197361",
        },
        { entry: "e2", medication: "Bmlodipine", code: RXNORM + "212550" },
        {
          entry: "e1",
          medication: "Norvasc 10 MG Oral Tablet",
          code: RXNORM + "308135",
        },
      ),
    ),
    [
      [
        "e1",
        "Amlodipine 5 MG Oral Tablet and Bmlodipine share an ingredient, amlodipine, and are shown apart.",
        undefined,
      ],
    ],
  );
});

test("a row's place, as a person says it", () => {
  for (const [row, place] of [
    [
      {
        hospital: "Larkspur Valley Health",
        importLabel: "Apple Health export",
      },
      "Larkspur Valley Health",
    ],
    [
      { hospital: "Cascade North Demo Hospital", importLabel: "FHIR pull" },
      "Cascade North",
    ],
    [
      { importLabel: "entered by Alex in the Cascade app" },
      "Alex's own entries",
    ],
    [{ importLabel: "entered by the person" }, "Own entries"],
    [{ importLabel: "Apple Health export" }, "Apple Health"],
    [{}, "Somewhere unnamed"],
  ] as const)
    assert.equal(view.placeOf(row), place, JSON.stringify(row));
});

test("a hospital's people are listed family name first and sorted by family name, then given name, wherever they are listed", () => {
  const north = { name: "Cascade North Demo Hospital", fhirBase: "https://n" };
  const south = { name: "Cascade South Demo Hospital", fhirBase: "https://s" };
  const patient = (family: string, given: string[], birthDate: string) => ({
    entry: [
      {
        resource: {
          resourceType: "Patient",
          name: [{ family, given }],
          birthDate,
        },
      },
    ],
  });
  const people = view.demoPeople([
    {
      hospital: north,
      patients: {
        a: patient("Marsh", ["Rowan", "Ellery"], "1979-04-12"),
        b: patient("Fenn", ["Tobias"], "1980-01-01"),
        c: patient("Marsh", ["Anna"], "1990-02-02"),
      },
    },
    {
      hospital: south,
      patients: { a: patient("Marsh", ["Rowan", "Ellery"], "1979-04-12") },
    },
  ]);
  const expected = ["Fenn, Tobias", "Marsh, Anna", "Marsh, Rowan Ellery"];
  const asItems = (shown: unknown, selector: RegExp) =>
    [...render(shown as never).matchAll(selector)].map(([, text]) => text);
  assert.deepEqual(
    asItems(
      view.hospitalsPage({
        pod: "x",
        rows: [{ ...north }],
        text: "",
        search: "?hospitals",
        signIn: () => "",
        people,
        back: "/",
      }),
      /<li>([^<]*)(?: <span|<\/li>)/g,
    ),
    expected,
  );
  assert.deepEqual(
    asItems(
      view.newPodDialog({ people, pods: [], action: "make" }),
      /<button>([^<]*)<span/g,
    ),
    expected,
  );
});

test("a pod's page makes no claim about what a hospital holds, and still signs in at each hospital of its demo person", () => {
  const person = {
    name: "Rowan Ellery Marsh",
    at: [
      { name: "Cascade North Demo Hospital", fhirBase: "https://n" },
      { name: "Cascade South Demo Hospital", fhirBase: "https://s" },
    ],
  };
  const card = render(
    view.podPage(
      {},
      {
        pod: "rowan-ellery-marsh",
        person,
        signIn: (hospital: { name: string }) => `[${hospital.name}]`,
        findHospital: "?hospitals",
      },
    ),
  );
  const words = card.replace(/<[^>]*>/g, "");
  assert.ok(
    words.includes(
      "Sign in at a hospital, see what it has, and bring it into this pod.",
    ),
  );
  assert.ok(!/waiting/.test(words), words);
  assert.ok(person.at.every(({ name }) => card.includes(`[${name}]`)));
  assert.ok(words.includes("Find a hospital"));
});

test("a pod's name, from a person's", () => {
  for (const [person, pod] of [
    ["Rowan Ellery Marsh", "rowan-ellery-marsh"],
    ["  Zoë Ångström-Lee ", "zoe-angstrom-lee"],
    ["李明", ""],
  ])
    assert.equal(view.slug(person), pod, person);
});

test("a measurement, to three significant figures", () => {
  for (const [value, shown] of [
    ["60.967166143994106", "61"],
    ["4.705469", "4.71"],
    ["0.8", "0.8"],
    ["192", "192"],
    ["Negative", "Negative"],
  ])
    assert.equal(view.rounded(value), shown, value);
});

test("a cell with nothing to sort by sorts after the rest", () => {
  for (const [type, key] of [
    ["text", "Glucose"],
    ["number", "4.7"],
    ["date", "2025-01-05"],
  ])
    assert.ok(view.compare(type, "", key) > 0, type);
});

test("a pod's page with a connection holds its tiles and the connection's box; every box's first link, outside the box, closes it; a sentence keeps the space beside a value put in it", () => {
  const back = "/pods/alex-rivera/";
  const page = [
    render(
      view.podPage(
        {
          [ALLERGIES]: [
            { entry: "urn:cascade:entry:e1", allergen: "Penicillin" },
          ],
          [LABS]: [{ entry: "urn:cascade:entry:e2", test: "Glucose" }],
        },
        {
          pod: "alex-rivera",
          signIn: () => "",
          findHospital: "?hospitals",
          entryHref: (entry: string) =>
            `/pods/alex-rivera/entries/${view.entryId(entry)}`,
          connection: view.connectionDialog({
            id: "connection",
            pod: "alex-rivera",
            hospital: "Cascade North Demo Hospital",
            back,
            connection: { step: "pulling", requests: 3 },
            bring: "bring",
          }),
        },
      ),
    ),
    render(view.newPodDialog({ people: [], pods: [], action: "make" })),
    render(
      view.connectionDialog({
        id: "pulled",
        pod: "alex-rivera",
        hospital: "Cascade North Demo Hospital",
        back: "#",
        connection: { step: "pulled", requests: 3 },
        sources: [{ records: { Condition: 2 }, claimed: false }],
        pulled: { missing: [], denied: [] },
        bring: "bring",
      }),
    ),
    render(
      view.hospitalsPage({
        pod: "alex-rivera",
        rows: [],
        text: "",
        search: "?hospitals",
        signIn: () => "",
        people: [],
        back,
      }),
    ),
  ].join("\n");
  const words = page.replace(/<[^>]*>/g, "");
  for (const sentence of [
    "What Cascade North has: 2 conditions.",
    "and bring it into Alex Rivera's pod.",
    "Back to Alex Rivera",
  ])
    assert.ok(words.includes(sentence), sentence);
  assert.equal((page.match(/<a class="tile"/g) ?? []).length, 2);
  for (const [entry, shown] of [
    ["e1", "Penicillin"],
    ["e2", "Glucose"],
  ])
    assert.ok(
      page.includes(
        `<td data-key="${shown}"><a href="/pods/alex-rivera/entries/${entry}">${shown}</a></td>`,
      ),
      `${shown}'s row does not open its entry`,
    );
  const boxes = page.split('<div class="dialog"').slice(1);
  assert.equal(boxes.length, 5);
  const connection = boxes.find((box) => box.startsWith(' id="connection"'));
  assert.ok(connection?.includes("3 requests answered so far"));
  for (const box of boxes) {
    const first = /<a [^>]*>/.exec(box)?.[0] ?? "";
    const closes = box === connection ? back : "#";
    assert.ok(first.includes(` href="${closes}"`), box.slice(0, 80));
    assert.match(first, / class="backdrop"/, box.slice(0, 80));
    assert.match(first, / aria-label="Close the box"/, box.slice(0, 80));
    assert.ok(
      box.indexOf(first) < box.indexOf('<div class="box'),
      box.slice(0, 80),
    );
  }
});

test("a pod's page names a row by the first of its codes the tables name, else by the record's own text, and tags a retired code and an entry that needs review", () => {
  const CVX = "urn:test:cvx/";
  const ICD = "urn:test:icd/";
  const SCT = "urn:test:sct/";
  const LOINC = "http://loinc.org/rdf/";
  const name = (label: string) => ({
    name: { label, altLabels: [], origin: "urn:x:names" },
  });
  const retired = (...replacedBy: string[]) => ({
    status: { deprecated: true, replacedBy, origin: "urn:x:status" },
  });
  const answers = {
    "pod/My immunizations": [
      { entry: "i1", vaccine: "Fluarix", code: `${CVX}141` },
      { entry: "i2", vaccine: "Hantavax", code: `${CVX}57` },
      { entry: "i3", vaccine: "Old flu", code: `${CVX}15` },
      { entry: "i4", vaccine: "Unlisted", code: `${CVX}999` },
    ],
    [LABS]: [
      { entry: "l1", test: "K+", code: `${LOINC}2823-3` },
      { entry: "l2", test: "Chloride", code: `${LOINC}2075-0` },
    ],
    [CONDITIONS]: [
      {
        entry: "c1",
        condition: "Asthma",
        snomed: `${SCT}195967001`,
        icd10: `${ICD}J45.909`,
      },
    ],
    [REVIEW]: [{ entry: "i3", needs: "judged different, still joined" }],
  };
  const about = new Map<string, object>([
    [`${CVX}141`, name("flu, split")],
    [`${CVX}57`, { ...name("hantavirus"), ...retired() }],
    [`${CVX}15`, retired(`${CVX}141`, `${CVX}150`)],
    [`${SCT}195967001`, { ...name("Asthma (disorder)"), ...retired() }],
    [`${ICD}J45.909`, name("Unspecified asthma, uncomplicated")],
    [`${LOINC}2823-3`, name("Potassium [Moles/volume] in Serum or Plasma")],
  ]);
  assert.deepEqual(
    view.codesOf(answers).sort(),
    [
      `${CVX}141`,
      `${CVX}15`,
      `${CVX}57`,
      `${CVX}999`,
      `${SCT}195967001`,
      `${ICD}J45.909`,
      `${LOINC}2823-3`,
      `${LOINC}2075-0`,
    ].sort(),
  );
  const props = { pod: "alex-rivera", signIn: () => "", findHospital: "" };
  const words = (about?: Map<string, object>) =>
    render(view.podPage(answers, { ...props, about }))
      .replace(/<[^>]*>/g, "\n")
      .split("\n")
      .map((line: string) => line.trim())
      .filter(Boolean);
  const named = words(about);
  for (const shown of [
    "flu, split, hantavirus, Old flu, Unlisted",
    "hantavirus",
    "Retired code",
    "Old flu",
    "Unlisted",
    "Unspecified asthma, uncomplicated",
    "Potassium [Moles/volume] in Serum or Plasma",
    "Chloride",
  ])
    assert.ok(named.includes(shown), shown);
  assert.ok(
    !named.some((line: string) => line.includes("replaced by")),
    "what replaces a retired code is said on its entry, not in the tag",
  );
  assert.equal(
    named.filter((line: string) => line === "Needs review").length,
    2,
    "the row of an entry that needs review carries the tag, and so does its line in Worth a look",
  );
  assert.ok(
    named.some((line: string) =>
      line.startsWith("Old flu was marked as different"),
    ),
  );
  for (const hidden of ["Fluarix", "Hantavax", "Asthma (disorder)", "K+"])
    assert.ok(!named.includes(hidden), hidden);
  assert.equal(
    named.filter((line: string) => line.startsWith("Retired code")).length,
    2,
    "only the codes that named a row, or with none the first with a status, mark it",
  );
  const unnamed = words();
  for (const shown of ["Fluarix", "Hantavax", "Asthma", "K+"])
    assert.ok(unnamed.includes(shown), shown);
  assert.ok(!unnamed.some((line: string) => line.startsWith("Retired")));
});

test("the frame's title bar has File, whose two items open boxes that confirm with one button posting to the host's action, and Help, whose About names the app, its version and cascade-runtime's", () => {
  const page = render(
    view.frame({
      title: "Alex Rivera",
      body: view.html`<h1>Alex Rivera</h1>`,
      pods: ["alex-rivera"],
      current: "alex-rivera",
      href: (pod: string) => `/pods/${pod}/`,
      home: "/",
      dialog: "",
      menu: {
        deleteAll: "/delete-all",
        resetAll: "/reset-all",
        about: {
          name: "my-app",
          version: "1.2.3",
          runtime: "4.5.6",
          code: "c",
        },
      },
      note: view.didNote(new URLSearchParams("deleted=3"), []),
    }),
  );
  const menus = [
    ...page.matchAll(
      /<details class="menu"><summary>(\w+)<\/summary>([\s\S]*?)<\/details>/g,
    ),
  ].map(([, name, items = ""]) => [
    name,
    [...items.matchAll(/<a href="([^"]*)">([^<]*)</g)].map(
      ([, href, label]) => [href, label],
    ),
  ]);
  assert.deepEqual(menus, [
    [
      "File",
      [
        ["#delete-all", "Delete all data"],
        ["#reset-all", "Reset all data"],
      ],
    ],
    ["Help", [["#about", "About"]]],
  ]);
  /** The box `id`, to the tag that closes it. */
  const boxOf = (id: string): string => {
    const start = page.indexOf(`<div class="dialog" id="${id}"`);
    assert.notEqual(start, -1, id);
    let depth = 0;
    for (const tag of page.slice(start).matchAll(/<(\/?)div\b[^>]*>/g)) {
      depth += tag[1] === "" ? 1 : -1;
      if (depth === 0)
        return page.slice(start, start + (tag.index ?? 0) + tag[0].length);
    }
    return assert.fail(`the box ${id} is never closed`);
  };
  for (const [id, action] of [
    ["delete-all", "/delete-all"],
    ["reset-all", "/reset-all"],
  ] as const) {
    const box = boxOf(id);
    assert.match(box, / class="backdrop"/, id);
    assert.deepEqual(
      [...box.matchAll(/<form [^>]*action="([^"]*)"/g)].map(([, to]) => to),
      [action],
      id,
    );
  }
  const about = boxOf("about");
  for (const said of ["my-app", "1.2.3", "cascade-runtime 4.5.6", "made up"])
    assert.ok(about.includes(said), said);
  assert.match(about, /<a href="c">/);
  assert.match(page, /<p class="note" role="status">Deleted 3 pods\.<\/p>/);
  assert.equal(
    view.didNote(new URLSearchParams("pod=alex-rivera&reset"), [
      "alex-rivera",
      "priya-natarajan",
    ]),
    "Reset: Alex Rivera and Priya Natarajan are back.",
  );
  assert.equal(
    view.didNote(new URLSearchParams("pod=alex-rivera"), []),
    undefined,
  );
});

test("the chat strip says how to set a model when none is set, and otherwise holds the form, the suggestions and the model's name, and no strip on a page that reloads itself", () => {
  const shown = (chat: object, refresh = false) =>
    render(
      view.frame({
        title: "Alex Rivera",
        body: view.html`<h1>Alex Rivera</h1>`,
        pods: ["alex-rivera"],
        current: "alex-rivera",
        href: (pod: string) => `/pods/${pod}/`,
        home: "/",
        dialog: "",
        menu: { deleteAll: "/d", resetAll: "/r", about: { name: "a" } },
        chat,
        refresh,
      }),
    );
  const off = shown({ pod: "alex-rivera", suggestions: [] });
  assert.match(off, /run <code>npm run model<\/code>/);
  assert.doesNotMatch(off, /<form class="chat-form"/);
  const chat = {
    model: { provider: "other", name: "m-1", local: false },
    pod: "alex-rivera",
    suggestions: ["Find anything interesting"],
  };
  const on = shown(chat);
  assert.match(on, /<section class="chat"[^>]* data-pod="alex-rivera"/);
  assert.match(on, /<form class="chat-form">/);
  assert.match(
    on,
    /<div class="chat-chips" hidden><button [^>]*data-ask-text="Find anything interesting"/,
  );
  assert.match(on, /m-1/);
  assert.doesNotMatch(shown(chat, true), /class="chat"/);
});

test("Escape closes an open menu and follows the open box's own close link, or with none clears the hash; a click closes every open menu but the one whose name it is on", () => {
  const listening = (close?: { click: () => void }) => {
    const on: Record<string, ((event: object) => void)[]> = {};
    const location = { hash: "#connection" };
    const menus = [{ open: true }, { open: true }];
    const page = {
      defaultView: { location },
      addEventListener: (type: string, listener: (event: object) => void) => {
        on[type] = [...(on[type] ?? []), listener];
      },
      querySelector: () => close ?? null,
      querySelectorAll: () => menus.filter(({ open }) => open),
    };
    view.closing(page);
    const fire = (type: string, event: object) => {
      for (const listener of on[type] ?? []) listener(event);
    };
    return { fire, location, menus };
  };
  const opened = (menus: { open: boolean }[]) => menus.map(({ open }) => open);
  let clicked = 0;
  const boxed = listening({ click: () => (clicked += 1) });
  boxed.fire("keydown", { key: "Escape" });
  assert.equal(boxed.location.hash, "#connection");
  assert.equal(clicked, 1);
  assert.deepEqual(opened(boxed.menus), [false, false]);
  const bare = listening();
  bare.fire("keydown", { key: "Escape" });
  assert.equal(bare.location.hash, "");
  for (const menu of bare.menus) menu.open = true;
  const [first] = bare.menus;
  bare.fire("click", {
    target: {
      closest: (selector: string) =>
        selector === "summary" ? { parentElement: first } : null,
    },
  });
  assert.deepEqual(opened(bare.menus), [true, false]);
  bare.fire("click", { target: { closest: () => null } });
  assert.deepEqual(opened(bare.menus), [false, false]);
});

test("a form posted turns every button off and says what its button does until the page changes, a second post meanwhile is cancelled, and a page shown again from history is on again", () => {
  assert.match(
    render(
      view.postButton("/bring", {}, "Bring it in", undefined, "Bringing…"),
    ),
    /^<form [^>]*data-doing="Bringing…"/,
  );
  const said = (html: string) => /<span class="said">([^<]*)</.exec(html)?.[1];
  assert.match(render(view.doing()), /^<p class="doing" [^>]*hidden/);
  assert.equal(said(render(view.doing("Bringing…"))), "Bringing…");
  const on: Record<string, (event: object) => void> = {};
  const listen = (type: string, listener: (event: object) => void) => {
    on[type] = listener;
  };
  const shown = { textContent: "" };
  const line = { hidden: true, querySelector: () => shown };
  const buttons = [{ disabled: false }, { disabled: false }];
  const body = { dataset: {} as Record<string, string> };
  view.busyForms({
    body,
    querySelector: () => line,
    querySelectorAll: () => buttons,
    addEventListener: listen,
    defaultView: { addEventListener: listen },
  });
  const submit = () => {
    const event = {
      defaultPrevented: false,
      target: { dataset: { doing: "Bringing…" } },
      preventDefault: () => (event.defaultPrevented = true),
    };
    on.submit?.(event);
    return event.defaultPrevented;
  };
  assert.equal(submit(), false);
  assert.deepEqual(
    [body.dataset.state, line.hidden, shown.textContent, buttons],
    ["busy", false, "Bringing…", [{ disabled: true }, { disabled: true }]],
  );
  assert.equal(submit(), true);
  on.pageshow?.({ persisted: true });
  assert.deepEqual(
    [body.dataset.state, line.hidden, buttons],
    [undefined, true, [{ disabled: false }, { disabled: false }]],
  );
  assert.equal(submit(), false);
});

test("a table opens newest first, a row with no date last", () => {
  const section = view.SECTIONS.find(
    ({ question }: { question: string }) => question === LABS,
  );
  const rows = [
    { test: "Sodium" },
    { test: "Glucose", performed: "2024-03-01" },
    { test: "Potassium", performed: "2025-06-18T14:10:00-07:00" },
    { test: "Creatinine", performed: "2025-01-05" },
  ];
  assert.deepEqual(
    view.opening(section, rows).map(({ test }: { test: string }) => test),
    ["Potassium", "Creatinine", "Glucose", "Sodium"],
  );
});

const GROUPS = {
  iri: "urn:uuid:c1a6678c-2b4d-4287-b852-9039e6a71afd",
  label: "Example vaccine groups",
  licence: "http://creativecommons.org/publicdomain/zero/1.0/",
  publisher: "https://publisher.example/",
  credit: "Source: an example publisher",
  current: { iri: "ni:///v2", label: "2", issued: "2026-10-08T19:22:23Z" },
  versions: [
    { iri: "ni:///v2", label: "2", issued: "2026-10-08T19:22:23Z" },
    { iri: "ni:///v1", label: "1", issued: "2026-10-01T00:00:00Z" },
  ],
  checked: "2026-10-08T21:55:00Z",
  watched: { at: "2026-10-08T20:00:00Z", found: "nothing new" },
};
const NOW = Date.parse("2026-10-08T22:00:00Z");

/** The page's text, its tags dropped and its runs of white space one space. */
const textOf = (page: string): string =>
  page
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

test("the sidebar lists the pods, then the reference tables and Check now; a table's page gives its source, licence, version and freshness, the codes a search found, and the pods using each version", () => {
  const page = render(
    view.layout({
      body: "",
      pods: ["alex-rivera"],
      href: (pod: string) => `/pods/${pod}/`,
      home: "/",
      dialog: "",
      menu: { deleteAll: "d", resetAll: "r", about: { name: "a" } },
      tables: {
        series: [GROUPS],
        current: GROUPS.iri,
        href: (series: { iri: string }) =>
          `/tables/${view.tableId(series.iri)}/`,
        check: "/tables/check",
      },
    }),
  );
  const aside = page.slice(page.indexOf("<aside>"), page.indexOf("</aside>"));
  assert.deepEqual(
    [...aside.matchAll(/<h2>([^<]*)<\/h2>/g)].map(([, heading]) => heading),
    ["Pods", "Reference tables"],
  );
  assert.match(
    aside,
    /<a href="\/tables\/c1a6678c-2b4d-4287-b852-9039e6a71afd\/" aria-current="page">Example vaccine groups<\/a>/,
  );
  assert.match(aside, /<form [^>]*action="\/tables\/check"[\s\S]*Check now/);

  const shown = render(
    view.tablePage({
      series: GROUPS,
      searched: {
        total: 1201,
        offset: 50,
        found: [
          {
            code: "http://hl7.org/fhir/sid/cvx/141",
            notation: "141",
            about: {
              name: { label: "flu, split", altLabels: [], origin: "n" },
              status: { deprecated: true, replacedBy: [], origin: "s" },
            },
            mapsTo: [
              {
                code: "http://hl7.org/fhir/sid/cvx/88",
                notation: "88",
                about: {
                  name: { label: "flu, NOS", altLabels: [], origin: "n" },
                },
              },
            ],
          },
        ],
      },
      text: "141",
      search: "/tables/c1a6678c/",
      page: 2,
      pageHref: (page: number) => `/tables/c1a6678c/?page=${page}`,
      uses: { "ni:///v1": ["alex-rivera", "gone"], "ni:///v2": [] },
      pods: ["alex-rivera"],
      href: (pod: string) => `/pods/${pod}/`,
      now: NOW,
    }),
  );
  const text = textOf(shown);
  for (const said of [
    "Using version 2, Oct 8, 2026",
    "publisher.example Source: an example publisher",
    "CC0 1.0",
    "The watcher checked the publisher 2 hours ago: nothing new. This app last read the feed 5 minutes ago.",
    "141 flu, split Retired 88 flu, NOS",
    "51–51 of 1,201 codes.",
    "version 2, Oct 8, 2026 current : no pod",
    "version 1, Oct 1, 2026 : Alex Rivera",
  ])
    assert.ok(text.includes(said), said);
  assert.match(shown, /<form method="get" action="\/tables\/c1a6678c\/"/);
  assert.match(shown, /<a href="\/tables\/c1a6678c\/\?page=1" rel="prev">/);
  assert.match(shown, /<a href="\/tables\/c1a6678c\/\?page=3" rel="next">/);
  assert.match(shown, /<a href="\/pods\/alex-rivera\/">Alex Rivera<\/a>/);
  assert.ok(!text.includes("Gone"));

  const past = render(
    view.tablePage({
      series: GROUPS,
      searched: { total: 103, offset: 450, size: 50, found: [] },
      text: "",
      search: "/tables/c1a6678c/",
      page: 10,
      pageHref: (page: number) => `/tables/c1a6678c/?page=${page}`,
      uses: {},
      pods: [],
      href: (pod: string) => `/pods/${pod}/`,
      now: NOW,
    }),
  );
  assert.match(past, /<a href="\/tables\/c1a6678c\/\?page=3" rel="prev">/);
  assert.ok(!past.includes('rel="next"'));
  assert.deepEqual(
    ["3", "", null, "0", "-2", "2.5", "x", "Infinity", "1e400", "1e20"].map(
      view.pageNumber,
    ),
    [3, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  );
});

test("tables are browsed by source: a source is named by the words its tables share, its page searches them all and lists them, and a code's page says what each table says of it and where from", () => {
  const SOURCE = "urn:uuid:17cec5a9-071a-4179-9403-5c1e3886fb7d";
  const NAMES = {
    ...GROUPS,
    iri: "urn:uuid:f71f6797-48ec-4875-9b87-4cb1be1d9be0",
    label: "Example CVX names",
    licence: "http://creativecommons.org/publicdomain/mark/1.0/",
    source: SOURCE,
  };
  const groups = {
    ...GROUPS,
    label: "Example CVX vaccine groups",
    source: SOURCE,
  };
  const alone = { ...GROUPS, iri: "urn:uuid:0e2b", label: "Lone table" };
  const sources = view.sourcesOf([NAMES, groups, alone]);
  assert.deepEqual(
    sources.map(
      ({
        iri,
        label,
        series,
      }: {
        iri: string;
        label: string;
        series: { iri: string }[];
      }) => [iri, label, series.length],
    ),
    [
      [SOURCE, "Example CVX", 2],
      ["urn:uuid:0e2b", "Lone table", 1],
    ],
  );
  const [source] = sources;
  const codeHref = (code: string) => `/tables/s/?code=${code}`;
  const page = render(
    view.sourcePage({
      source,
      searched: {
        total: 1,
        offset: 0,
        size: 50,
        found: [
          {
            code: "http://hl7.org/fhir/sid/cvx/141",
            notation: "141",
            about: {
              name: { label: "flu, split", altLabels: [], origin: "n" },
            },
            mapsTo: [],
          },
        ],
      },
      text: "",
      search: "/tables/s/",
      page: 1,
      pageHref: (page: number) => `/tables/s/?page=${page}`,
      codeHref,
      tableHref: ({ iri }: { iri: string }) => `/tables/${view.tableId(iri)}/`,
      now: NOW,
    }),
  );
  assert.match(page, /<a href="\/tables\/s\/\?code=141">141<\/a>/);
  for (const said of ["What this source publishes", "Public domain", "CC0 1.0"])
    assert.ok(textOf(page).includes(said), said);
  for (const series of source.series)
    assert.ok(page.includes(`href="/tables/${view.tableId(series.iri)}/"`));

  const fact = { series: groups.iri, version: "ni:///v2" };
  const coded = (notation: string, label: string) => ({
    code: `http://hl7.org/fhir/sid/cvx/${notation}`,
    notation,
    about: { name: { label, altLabels: [], origin: "n" } },
  });
  const panelTable = {
    ...GROUPS,
    iri: "urn:uuid:7a1b",
    label: "Example panel members",
    credit: "Panels are LOINC's.",
  };
  const classTable = {
    ...GROUPS,
    iri: "urn:uuid:8c2d",
    label: "Example drug classes",
  };
  const placed = (notation: string, label: string, place: object) => ({
    ...coded(notation, label),
    ...place,
  });
  const panelsAndClasses = textOf(
    render(
      view.codePage({
        source,
        held: [NAMES, groups, alone, panelTable, classTable],
        facts: {
          ...coded("24323-8", "Comprehensive metabolic panel"),
          names: [],
          status: [],
          mappings: [],
          panels: [
            {
              series: panelTable.iri,
              version: "ni:///v2",
              members: [
                placed("2823-3", "Potassium", { sequence: 1, required: "R-a" }),
                placed("2951-2", "Sodium", { sequence: 2, required: "R" }),
                placed("17861-6", "Calcium", { sequence: 3, required: "Rflx" }),
              ],
              heldBy: {
                total: 3,
                panels: [placed("34567-8", "A larger panel", { sequence: 9 })],
              },
            },
          ],
          classes: [
            {
              series: classTable.iri,
              version: "ni:///v2",
              in: [
                {
                  relation: `${REC}establishedPharmacologicClass`,
                  class: coded("N0000175562", "ACE inhibitor [EPC]"),
                  through: coded("1546022", "lisinopril anhydrous"),
                },
                {
                  relation: `${REC}chemicalStructure`,
                  class: coded("M0014310", "Lisinopril"),
                },
              ],
              withheld: [
                {
                  relation: `${REC}mechanismOfAction`,
                  ingredient: coded("29046", "lisinopril"),
                },
              ],
            },
          ],
        },
        codeHref,
        back: "/tables/s/",
      }),
    ),
  );
  for (const said of [
    "A panel of 3 members, in order:",
    "2823-3 Potassium R-a",
    "2951-2 Sodium required",
    "No mechanism of action is given: FDA classes a different form of 29046 lisinopril; RxNorm does not tie this drug to it.",
    "17861-6 Calcium Rflx",
    "Itself a member of 3 panels:",
    "34567-8 A larger panel",
    "and 2 more.",
    "Panels are LOINC's.",
    "From Example panel members, version 2, Oct 8, 2026.",
    "Established pharmacologic class: N0000175562 ACE inhibitor [EPC] through 1546022 lisinopril anhydrous",
    "Chemical structure: M0014310 Lisinopril",
    "From Example drug classes, version 2, Oct 8, 2026.",
  ])
    assert.ok(
      panelsAndClasses.includes(said),
      `${said} in ${panelsAndClasses}`,
    );
  assert.ok(
    panelsAndClasses.indexOf("2823-3") < panelsAndClasses.indexOf("2951-2") &&
      panelsAndClasses.indexOf("2951-2") < panelsAndClasses.indexOf("17861-6"),
    "members come in the order they were given",
  );
  const code = textOf(
    render(
      view.codePage({
        source,
        held: [NAMES, groups, alone],
        facts: {
          ...coded("141", "flu, split"),
          names: [
            {
              ...fact,
              series: NAMES.iri,
              label: "flu, split",
              altLabels: ["influenza, split"],
            },
          ],
          status: [],
          mappings: [
            {
              ...fact,
              series: alone.iri,
              mapsTo: [
                {
                  ...coded("88", "flu, NOS"),
                  alongside: { total: 2, codes: [coded("15", "flu, whole")] },
                },
              ],
              mappedFrom: { total: 0, codes: [] },
            },
          ],
        },
        codeHref,
        back: "/tables/s/",
      }),
    ),
  );
  for (const said of [
    "141 flu, split",
    "influenza, split",
    "From Example CVX names, version 2, Oct 8, 2026.",
    "Maps to 88 flu, NOS, as do 15 flu, whole and 1 more.",
    "From Lone table, version 2, Oct 8, 2026.",
  ])
    assert.ok(code.includes(said), `${said} in ${code}`);
});

test("a pod's page credits the table whose names it shows, once, and no other", () => {
  const code = "http://loinc.org/rdf/2823-3";
  const answers = {
    [LABS]: [
      { entry: "l1", test: "K+", code },
      { entry: "l2", test: "K again", code },
    ],
  };
  const about = new Map<string, object>([
    [
      code,
      {
        name: {
          label: "Potassium [Moles/volume] in Serum or Plasma",
          altLabels: [],
          origin: "urn:x:loinc-1",
        },
      },
    ],
  ]);
  const held = [
    {
      iri: "urn:x:loinc",
      versions: [{ iri: "urn:x:loinc-1" }],
      credit: "This material contains content from LOINC.",
    },
    {
      iri: "urn:x:other",
      versions: [{ iri: "urn:x:other-1" }],
      credit: "Another table's credit.",
    },
  ];
  const shown = (props: object) =>
    textOf(
      render(
        view.podPage(answers, {
          pod: "alex-rivera",
          signIn: () => "",
          findHospital: "",
          ...props,
        }),
      ),
    );
  const credited = shown({ about, held });
  assert.equal(
    credited.split("This material contains content from LOINC.").length,
    2,
  );
  assert.ok(!credited.includes("Another table's credit."));
  assert.ok(
    !shown({ about: new Map(), held }).includes("content from LOINC"),
    "a name the tables did not give has no credit",
  );
});

test("the medicines by class page groups the pod's active medicines under each class, one class alone when picked, with the table and version each came from and its credit, and says which medicines are in none and why", () => {
  const MEDRT = "https://ns.cascadeprotocol.org/codes/medrt/";
  const ORIGIN = "urn:x:classes-1";
  const series = {
    ...GROUPS,
    iri: "urn:x:classes",
    label: "Example drug classes",
    credit: "Classes are FDA's.",
    versions: [{ iri: ORIGIN, label: "1", issued: "2026-10-08" }],
  };
  const row = (
    entry: string,
    medication: string,
    cls: string,
    relation = "establishedPharmacologicClass",
    on = "3827",
    stated = "false",
  ) => ({
    entry,
    medication,
    class: `${MEDRT}${cls}`,
    relation: `${REC}${relation}`,
    origin: ORIGIN,
    through: `http://www.nlm.nih.gov/research/umls/rxnorm/${on}`,
    stated,
  });
  const rows = [
    row("e4", "Estradiol 1 MG Oral Tablet", "N0000175825", undefined, "4083"),
    row(
      "e5",
      "Fluoroestradiol F-18",
      "N0000177914",
      undefined,
      "2372221",
      "true",
    ),
    row("e2", "Enalapril", "N0000175562"),
    row("e2", "Enalapril", "N0000000174", "mechanismOfAction"),
  ];
  const LISINOPRIL_TABLET =
    "http://www.nlm.nih.gov/research/umls/rxnorm/314076";
  const medications = [
    {
      entry: "e1",
      medication: "Lisinopril 10 MG Oral Tablet",
      code: LISINOPRIL_TABLET,
    },
    { entry: "e2", medication: "Enalapril" },
    { entry: "e3", medication: "Lisinopril with hydrochlorothiazide" },
    { entry: "e4", medication: "Estradiol 1 MG Oral Tablet" },
    { entry: "e5", medication: "Fluoroestradiol F-18" },
  ];
  const about = new Map<string, object>([
    [
      `${MEDRT}N0000175562`,
      {
        notation: "N0000175562",
        name: {
          label: "Angiotensin Converting Enzyme Inhibitor [EPC]",
          altLabels: [],
          origin: ORIGIN,
        },
      },
    ],
    [
      `${MEDRT}N0000000174`,
      {
        notation: "N0000000174",
        name: {
          label: "Angiotensin-converting Enzyme Inhibitors",
          altLabels: [],
          origin: ORIGIN,
        },
      },
    ],
    [
      `${MEDRT}N0000175825`,
      {
        notation: "N0000175825",
        name: { label: "Estrogen [EPC]", altLabels: [], origin: ORIGIN },
      },
    ],
    [
      "http://www.nlm.nih.gov/research/umls/rxnorm/3827",
      {
        notation: "3827",
        name: { label: "enalapril", altLabels: [], origin: ORIGIN },
      },
    ],
    [
      "http://www.nlm.nih.gov/research/umls/rxnorm/4083",
      {
        notation: "4083",
        name: { label: "estradiol", altLabels: [], origin: ORIGIN },
      },
    ],
  ]);
  const props = {
    pod: "priya-natarajan",
    back: "/pods/priya-natarajan/",
    rows,
    medications,
    about,
    elsewhere: new Map([[LISINOPRIL_TABLET, ["lisinopril"]]]),
    held: [series],
    classHref: (code: string) => `/classes?class=${encodeURIComponent(code)}`,
    allHref: "/classes",
    entryHref: (entry: string) => `/entries/${entry}`,
  };
  const all = textOf(render(view.classesPage(props)));
  for (const said of [
    "Angiotensin Converting Enzyme Inhibitor [EPC] Established pharmacologic class",
    "Enalapril through enalapril",
    "Estrogen [EPC]",
    "Estradiol 1 MG Oral Tablet through estradiol",
    "Mechanism of action",
    "From Example drug classes, version 1, Oct 8, 2026.",
    "Classes are FDA's.",
    "Not in a class here",
    "Lisinopril 10 MG Oral Tablet: FDA classes a different form of lisinopril; RxNorm does not tie this product to it.",
    "Lisinopril with hydrochlorothiazide. MED-RT classes single ingredients",
  ])
    assert.ok(all.includes(said), `${said} in ${all}`);
  assert.ok(
    all.includes("Fluoroestradiol F-18") &&
      !all.includes("Fluoroestradiol F-18 through"),
    "a class on a code the entry states is not through anything",
  );
  assert.ok(
    !all.includes("Lisinopril 10 MG Oral Tablet, ") &&
      !all.includes("Lisinopril 10 MG Oral Tablet and"),
    "a medicine with its own reason is not in the general one",
  );
  assert.ok(
    all.indexOf("Established pharmacologic class") <
      all.indexOf("Mechanism of action"),
    "the relations come in MED-RT's order",
  );
  const picked = textOf(
    render(view.classesPage({ ...props, picked: `${MEDRT}N0000000174` })),
  );
  assert.ok(picked.includes("Enalapril through"));
  assert.ok(
    !picked.includes("Estradiol 1 MG Oral Tablet through"),
    "only the class picked",
  );
  const none = textOf(render(view.classesPage({ ...props, rows: [] })));
  assert.ok(none.includes("None of this pod's active medicines is in a class"));
});

test("a panel's page lists the pod's results in LOINC's order with each test's requirement, newest first, the required tests with no result, a nested panel's tests under it, and the version and credit; it never says a result was drawn in the panel", () => {
  const LOINC = "http://loinc.org/rdf/";
  const ORIGIN = "urn:x:panels-1";
  const NAMES = "urn:x:names-1";
  const series = {
    ...GROUPS,
    iri: "urn:x:panels",
    label: "Example panel members",
    credit: "Panels: LOINC's credit.",
    versions: [{ iri: ORIGIN, label: "2.83", issued: "2026-10-05" }],
  };
  const names = {
    ...GROUPS,
    iri: "urn:x:names",
    label: "Example LOINC names",
    credit: "Names: LOINC's credit.",
    versions: [{ iri: NAMES, label: "2.84", issued: "2026-10-06" }],
  };
  const panel = `${LOINC}24326-1`;
  const nested = `${LOINC}99999-2`;
  const row = (
    member: string,
    sequence: number,
    required: string,
    entry?: string,
    via = panel,
  ) => ({
    panel,
    member: `${LOINC}${member}`,
    sequence: String(sequence),
    required,
    via,
    origin: ORIGIN,
    ...(entry !== undefined && { entry }),
  });
  const rows = [
    row("2951-2", 1, "R"),
    row("2823-3", 2, "R", "k1"),
    row("2823-3", 2, "R", "k2"),
    row("2075-0", 3, "R"),
    row("2028-9", 4, "O", "c1"),
    row("6298-4", 1, "R", "n1", nested),
    row("2823-3", 1, "R", "k1", nested),
  ];
  const name = (code: string, label: string): [string, object] => [
    `${LOINC}${code}`,
    { notation: code, name: { label, altLabels: [], origin: NAMES } },
  ];
  const props = {
    pod: "rowan-marsh",
    back: "/pods/rowan-marsh/",
    panel,
    rows,
    labs: [
      { entry: "k1", value: "4.1", unit: "mmol/L", performed: "2025-03-01" },
      { entry: "k2", value: "4.6", unit: "mmol/L", performed: "2025-06-01" },
      { entry: "c1", value: "24", unit: "mmol/L", performed: "2025-06-01" },
      { entry: "n1", value: "3.9", unit: "mmol/L", performed: "2025-06-01" },
    ],
    about: new Map([
      name("24326-1", "Electrolytes panel"),
      name("2951-2", "Sodium"),
      name("2823-3", "Potassium"),
      name("2075-0", "Chloride"),
      name("2028-9", "Carbon dioxide"),
      name("6298-4", "Potassium in blood"),
      name("99999-2", "Nested panel"),
    ]),
    held: [series, names],
    entryHref: (entry: string) => `/entries/${entry}`,
  };
  const words = textOf(render(view.panelPage(props)));
  assert.ok(
    words.includes(
      "Your results in Electrolytes panel You have 1 of 3 required tests; missing: Sodium and Chloride.",
    ),
    words,
  );
  const order = ["Sodium", "Potassium", "Chloride", "Carbon dioxide"].map(
    (each) => words.indexOf(each, words.indexOf("Tests in the panel")),
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    "LOINC's order",
  );
  for (const said of [
    "Sodium required No result",
    "Potassium required 4.6 mmol/L Jun 1, 2025 4.1 mmol/L Mar 1, 2025",
    "Carbon dioxide optional 24 mmol/L",
    "Within Nested panel Potassium in blood required 3.9 mmol/L",
    "From Example panel members, version 2.83, Oct 5, 2026 and Example LOINC names, version 2.84, Oct 6, 2026.",
    "Panels: LOINC's credit.",
    "Names: LOINC's credit.",
    "that does not say your results were drawn as part of it",
  ])
    assert.ok(words.includes(said), `${said} in ${words}`);
  assert.equal(
    words.split("Potassium required").length,
    2,
    "a test the panel lists itself is not repeated under a nested panel",
  );
  const withMissingNested = textOf(
    render(
      view.panelPage({
        ...props,
        rows: [...rows, row("6299-2", 2, "R", undefined, nested)],
        about: new Map([...props.about, name("6299-2", "Another test")]),
      }),
    ),
  );
  assert.ok(
    withMissingNested.includes(
      "You have 2 of 5 required tests; missing: Sodium, Chloride and Another test.",
    ),
    "a nested panel the query requires counts its held tests too",
  );
  assert.ok(
    textOf(render(view.panelPage({ ...props, rows: [] }))).includes(
      "You have no results in this panel.",
    ),
  );
});

test("a lab result's page links the panels LOINC lists its test in, and a result whose test is in none has no such part", () => {
  const series = {
    ...GROUPS,
    iri: "urn:x:panels",
    label: "Example panel members",
    credit: "Panels: LOINC's credit.",
    versions: [{ iri: "urn:x:panels-1", label: "2.83", issued: "2026-10-05" }],
  };
  const labs = {
    [view.SOURCES]: [
      {
        entry: "urn:e:k",
        entryLabel: "Lab result entry · Potassium",
        record: "r-k",
        arrived: "2026-09-12T10:00:00Z",
      },
    ],
    "pod/My lab results": [
      {
        entry: "urn:e:k",
        entryLabel: "Lab result entry · Potassium",
        test: "Potassium",
        code: "http://loinc.org/rdf/2823-3",
        value: "4.1",
      },
    ],
  };
  const entry = view.entryOf(labs, view.entryId("urn:e:k"), {
    held: [series],
  });
  assert.deepEqual(entry.testCodes, ["http://loinc.org/rdf/2823-3"]);
  const panels = [
    {
      series,
      version: series.versions[0],
      total: 3,
      panels: [
        {
          code: "http://loinc.org/rdf/24326-1",
          notation: "24326-1",
          required: "R",
          about: { notation: "24326-1", name: { label: "Electrolytes panel" } },
        },
      ],
    },
  ];
  const props = {
    entry,
    pod: "rowan-marsh",
    back: "/",
    codeHref: () => "/code",
    tableHref: () => "/table",
    panelHref: (code: string) => `/panel?panel=${code}`,
  };
  const page = render(view.entryPage({ ...props, panels }));
  const words = textOf(page);
  assert.ok(words.includes("In LOINC panels"));
  assert.ok(words.includes("Electrolytes panel required"));
  assert.ok(words.includes("and 2 more."));
  assert.ok(
    page.includes('<a href="/panel?panel=http://loinc.org/rdf/24326-1">'),
  );
  assert.ok(!textOf(render(view.entryPage(props))).includes("In LOINC panels"));
});

test("what a check did, in one note", () => {
  const checked = (fields: object) => ({
    feed: "https://f.example/feed.ttl",
    kept: [],
    refused: [],
    ...fields,
  });
  for (const [did, said] of [
    [[checked({})], "Checked the feeds: nothing new."],
    [
      [checked({ kept: ["ni:///v2"] })],
      "Kept Example vaccine groups, version 2, Oct 8, 2026.",
    ],
    [
      [checked({ later: "https://f.example/feed.ttl answered 503" })],
      "Not read now, tried again later: https://f.example/feed.ttl answered 503.",
    ],
    [
      [
        checked({
          refused: [
            {
              version: "ni:///v3",
              reason: "its rows do not have the checksum the feed gives",
            },
          ],
        }),
      ],
      "Refused a version: its rows do not have the checksum the feed gives.",
    ],
  ] as const)
    assert.equal(view.checkedNote(did, [GROUPS]), said);
});

const GENOMICS = "https://ns.cascadeprotocol.org/genomics/v1#";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const VARIANTS = "pod/My genetic variants";
const REPORTS = "pod/What each report says of a variant";
const CONCEPTS: Record<string, string> = {
  [`${GENOMICS}Pathogenic`]: "Pathogenic",
  [`${GENOMICS}LikelyPathogenic`]: "Likely pathogenic",
  [`${GENOMICS}VUS`]: "Uncertain significance",
  [`${GENOMICS}LikelyBenign`]: "Likely benign",
  [`${GENOMICS}Benign`]: "Benign",
  [`${REC}ClinVarConflicting`]: "Conflicting classifications of pathogenicity",
  [`${REC}ClinVarConflictingData`]: "conflicting data from submitters",
  [`${REC}ClinVarCombinationOnly`]: "-",
  [`${REC}ClinVarVusHigh`]: "VUS-high",
  [`${REC}ClinVarRiskFactor`]: "risk factor",
  [`${REC}ClinVarMultipleSubmittersNoConflicts`]:
    "criteria provided, multiple submitters, no conflicts",
  [`${REC}ClinVarSingleSubmitter`]: "criteria provided, single submitter",
  [`${REC}ClinVarNoAssertionCriteria`]: "no assertion criteria provided",
};
const concept = (name: string) => {
  const iri = [GENOMICS, REC]
    .map((space) => space + name)
    .find((each) => each in CONCEPTS);
  assert.ok(iri, name);
  return { iri, label: CONCEPTS[iri] };
};
const LABELS = new Map(
  Object.entries(CONCEPTS).filter(([iri]) => iri.startsWith(GENOMICS)),
);
const VERSION = "ni:///clinvar-1";
const ROW = "http://www.ncbi.nlm.nih.gov/clinvar/90011";
const rows = (fields: Record<string, unknown>) => ({
  found: "rows",
  series: "urn:test:clinvar",
  version: VERSION,
  rows: [{ variation: ROW, classification: [], ...fields }],
});
const report = (
  id: string,
  classification: string | undefined,
  date: string | undefined,
) => ({
  report: id,
  variant: "v1",
  ...(classification === undefined
    ? {}
    : { classification: `${GENOMICS}${classification}` }),
  ...(date === undefined ? {} : { date }),
});
const verdict = (reportId: string, said: string, extra = {}) => ({
  report: reportId,
  row: ROW,
  origin: VERSION,
  verdict: said,
  ...extra,
});

test("what a variant's page says: a sentence for each report, oldest first, tagged when it differs from the row ClinVar holds today, and one for what ClinVar says, in every state of its answer", () => {
  const martin = rows({
    classification: [concept("LikelyPathogenic"), concept("Pathogenic")],
    reviewStatus: concept("ClinVarMultipleSubmittersNoConflicts"),
    lastEvaluated: "2024-12-11",
    contributingSubmitters: 5,
  });
  const cases: [
    string,
    {
      reports?: unknown[];
      says?: unknown;
      verdicts?: unknown[];
      gene?: string;
      labels?: Map<string, string>;
      places?: Map<string, string>;
    },
    { sentence: string; tag?: string }[],
    string | undefined,
  ][] = [
    [
      "a report with its lab: its sentence names it, the year and the lab are kept apart, and a report of no lab says nothing of one",
      {
        reports: [
          report("r1", "VUS", "2022-05-01"),
          report("r2", undefined, "2024-03-21"),
          report("r3", "Benign", undefined),
          report("r4", "Benign", "2023-01-01"),
        ],
        says: martin,
        verdicts: [verdict("r1", "differs")],
        places: new Map([
          ["r1", "Harbourline Genetics"],
          ["r2", "St Columba's Hospital"],
          ["r3", "Harbourline Genetics"],
        ]),
      },
      [
        {
          sentence:
            "Your 2022 report from Harbourline Genetics said uncertain significance.",
          tag: "Differs",
        },
        { sentence: "Your 2023 report said benign." },
        {
          sentence:
            "Your 2024 report from St Columba's Hospital gives no ACMG classification.",
        },
        {
          sentence: "An undated report from Harbourline Genetics said benign.",
        },
      ],
      "ClinVar today says pathogenic/likely pathogenic: criteria provided, multiple submitters, no conflicts, five contributing submitters.",
    ],
    [
      "Martin's page, in #138's words",
      {
        reports: [
          report("r2", "LikelyPathogenic", "2024-03-21"),
          report("r1", "VUS", "2022-05-01"),
        ],
        says: martin,
        verdicts: [verdict("r1", "differs"), verdict("r2", "agrees")],
      },
      [
        {
          sentence: "Your 2022 report said uncertain significance.",
          tag: "Differs",
        },
        { sentence: "Your 2024 report said likely pathogenic." },
      ],
      "ClinVar today says pathogenic/likely pathogenic: criteria provided, multiple submitters, no conflicts, five contributing submitters.",
    ],
    [
      "a benign row both reports agree with, one contributing submitter",
      {
        reports: [
          report("r1", "Benign", "2023-01-01"),
          report("r2", "LikelyBenign", "2024-01-01"),
        ],
        says: rows({
          classification: [concept("Benign"), concept("LikelyBenign")],
          reviewStatus: concept("ClinVarSingleSubmitter"),
          contributingSubmitters: 1,
        }),
        verdicts: [verdict("r1", "agrees"), verdict("r2", "agrees")],
      },
      [
        { sentence: "Your 2023 report said benign." },
        { sentence: "Your 2024 report said likely benign." },
      ],
      "ClinVar today says likely benign/benign: criteria provided, single submitter, one contributing submitter.",
    ],
    [
      "two reports of one year are named by their day, an undated one last, one with no classification says so",
      {
        reports: [
          report("r1", undefined, "2020-01-01"),
          report("r2", "Benign", undefined),
          report("r3", "VUS", "2024-11-02"),
          report("r4", "Pathogenic", "2024-03-21"),
        ],
        says: {
          found: "not found",
          series: "urn:test:clinvar",
          version: VERSION,
        },
      },
      [
        { sentence: "Your 2020 report gives no ACMG classification." },
        { sentence: "Your Mar 21, 2024 report said pathogenic." },
        { sentence: "Your Nov 2, 2024 report said uncertain significance." },
        { sentence: "An undated report said benign." },
      ],
      "ClinVar, as this app holds it, has no row for this variant.",
    ],
    [
      "a verdict of another row or version, and every verdict but differs, adds no tag",
      {
        reports: [
          report("r1", "VUS", "2021-01-01"),
          report("r2", "VUS", "2022-01-01"),
          report("r3", "VUS", "2023-01-01"),
          report("r4", "VUS", "2024-01-01"),
        ],
        says: martin,
        verdicts: [
          verdict("r1", "differs", { origin: "ni:///clinvar-0" }),
          verdict("r2", "differs", { row: "urn:test:other" }),
          verdict("r3", "labs disagree"),
          verdict("r4", "as ClinVar writes it"),
        ],
      },
      [2021, 2022, 2023, 2024].map((year) => ({
        sentence: `Your ${year} report said uncertain significance.`,
      })),
      "ClinVar today says pathogenic/likely pathogenic: criteria provided, multiple submitters, no conflicts, five contributing submitters.",
    ],
    [
      "a gene the series does not cover",
      {
        gene: "BRCA2",
        says: {
          found: "not covered",
          series: "urn:test:clinvar",
          version: VERSION,
          genes: ["EPCAM", "MLH1", "MSH2", "MSH6", "PMS2"],
        },
      },
      [],
      "ClinVar, as this app holds it, covers EPCAM, MLH1, MSH2, MSH6 and PMS2, not BRCA2.",
    ],
    [
      "no table held",
      { says: { found: "no series" } },
      [],
      "This app holds no ClinVar table.",
    ],
    [
      "the tables cannot say yet",
      { reports: [report("r1", "VUS", "2022-01-01")] },
      [{ sentence: "Your 2022 report said uncertain significance." }],
      undefined,
    ],
    [
      "a report named by its concept's words when no label is known",
      {
        reports: [report("r1", "LikelyPathogenic", "2024-03-21")],
        labels: new Map(),
      },
      [{ sentence: "Your 2024 report said likely pathogenic." }],
      undefined,
    ],
    [
      "labs that disagree, with another word after it, and a count of twelve",
      {
        says: rows({
          classification: [
            concept("ClinVarConflicting"),
            concept("ClinVarRiskFactor"),
          ],
          reviewStatus: concept("ClinVarNoAssertionCriteria"),
          contributingSubmitters: 12,
        }),
      },
      [],
      "ClinVar today says labs that submit to ClinVar disagree; risk factor: no assertion criteria provided, 12 contributing submitters.",
    ],
    [
      "a sub-tier after the ACMG value, and no contributing submitters",
      {
        says: rows({
          classification: [concept("ClinVarVusHigh"), concept("VUS")],
          contributingSubmitters: 0,
        }),
      },
      [],
      "ClinVar today says uncertain significance; VUS-high, no contributing submitters.",
    ],
    [
      "a classification only as part of a combination, and two submitters in words",
      {
        says: rows({
          classification: [concept("ClinVarCombinationOnly")],
          contributingSubmitters: 2,
        }),
      },
      [],
      "ClinVar today says classified only as part of a combination, two contributing submitters.",
    ],
    [
      "a row that counts submitters, not contributing ones",
      {
        says: rows({ classification: [concept("VUS")], submitters: 3 }),
      },
      [],
      "ClinVar today says uncertain significance, 3 submitters.",
    ],
    [
      "one submitter, and a row with no classification",
      {
        says: rows({
          reviewStatus: concept("ClinVarNoAssertionCriteria"),
          submitters: 1,
        }),
      },
      [],
      "ClinVar today gives no classification: no assertion criteria provided, one submitter.",
    ],
  ];
  for (const [name, input, reports, clinvar] of cases) {
    const said = view.variantSaid({
      variant: { gene: input.gene, hgvs: [], variations: [] },
      reports: input.reports ?? [],
      says: input.says,
      verdicts: input.verdicts ?? [],
      labels: input.labels ?? LABELS,
      ...(input.places && { places: input.places }),
    });
    assert.deepEqual(
      said.reports.map(
        ({ sentence, tag }: { sentence: string; tag?: string }) =>
          tag === undefined ? { sentence } : { sentence, tag },
      ),
      reports,
      name,
    );
    assert.equal(said.clinvar, clinvar, name);
    for (const each of said.reports)
      assert.equal(
        "when" in each,
        !each.sentence.includes("undated"),
        `${name}: an undated report has no when`,
      );
  }
});

test("a code's page gives a variation's classification as ClinVar's sentence with the table's credit", () => {
  const facts = {
    code: ROW,
    notation: "90011",
    names: [],
    status: [],
    mappings: [],
    classifications: [
      {
        series: "urn:test:clinvar",
        version: VERSION,
        variation: ROW,
        classification: [concept("VUS")],
      },
    ],
  };
  const shown = (said: object) =>
    render(
      view.codePage({
        source: { label: "ClinVar" },
        held: [
          {
            iri: "urn:test:clinvar",
            label: "ClinVar variant classifications",
            credit: "ClinVar, NCBI.",
            versions: [{ iri: VERSION, label: "1", issued: "2026-10-01" }],
          },
        ],
        facts: said,
        codeHref: () => "#",
        back: "#",
      }),
    );
  const raw = shown(facts);
  const page = raw.replace(/<[^>]*>/g, "");
  assert.ok(page.includes("ClinVar today says uncertain significance."));
  assert.ok(page.includes("ClinVar, NCBI."));
  assert.ok(!page.includes("No table this app holds says anything"));
  assert.ok(!raw.includes('rel="external"'), "no page, no outside link");
  const outside = "https://example.org/variation/90011/";
  const linked = shown({
    ...facts,
    page: { href: outside, system: "ClinVar" },
  });
  const link = linked.match(/<a href="([^"]*)" rel="external">([^<]*)<\/a>/);
  assert.deepEqual(link?.slice(1), [outside, "ClinVar's page for 90011"]);
});

const SOURCES = "entry/Where it came from";
const SCT = "urn:test:sct/";
const AT_MERIDIAN = "Meridian Health System";
const AT_LARKSPUR = "Larkspur Valley Health";
const ASTHMA = "urn:cascade:entry:aa11";
const LATEX = "urn:cascade:entry:bb22";
const record = (entry: string, at: string, extra: object) => ({
  entry,
  entryLabel: "Condition entry · Asthma",
  record: `${entry}-${at}`,
  document: `${entry}-${at}-document`,
  ...extra,
});

/** Asthma at two hospitals, its SNOMED code named and retired by two series; and a latex allergy only a review line names. */
const ENTRY_ANSWERS = {
  [SOURCES]: [
    record(ASTHMA, "meridian", {
      arrived: "2026-09-10T10:00:00Z",
      importLabel: "Apple Health export",
      hospital: AT_MERIDIAN,
      retrieved: "2026-09-01",
    }),
    record(ASTHMA, "larkspur", {
      arrived: "2026-08-01T10:00:00Z",
      importLabel: "FHIR pull",
      hospital: AT_LARKSPUR,
      retrieved: "2026-07-30",
    }),
    {
      entry: LATEX,
      entryLabel: "Allergy entry · Latex",
      record: "r-latex",
      arrived: "2026-09-12T10:00:00Z",
      importLabel: "entered by Alex in the Cascade app",
    },
  ],
  [CONDITIONS]: [
    {
      entry: ASTHMA,
      entryLabel: "Condition entry · Asthma",
      condition: "Asthma",
      onset: "2019-03-02",
      snomed: `${SCT}195967001`,
    },
  ],
  [SEEN]: [AT_MERIDIAN, AT_LARKSPUR].map((place) => ({
    entry: ASTHMA,
    place,
    records: "1",
    places: "2",
  })),
  [REVIEW]: [
    {
      entry: LATEX,
      entryLabel: "Allergy entry · Latex",
      needs: "judged different, still joined",
    },
  ],
};
const NAMES = {
  iri: "urn:test:names",
  label: "Example names",
  credit: "Names: an example publisher",
  versions: [{ iri: "urn:test:names-2", label: "2", issued: "2026-10-01" }],
};
const STATUS = {
  iri: "urn:test:status",
  label: "Example status",
  credit: "Status: another publisher",
  versions: [{ iri: "urn:test:status-1", label: "1", issued: "2026-09-01" }],
};

test("an entry's page says what it is, where each document it came from put it, and what Cascade and the tables say of it, each claim from a table naming the table and version, the version a link, and each credit once", () => {
  assert.equal(view.entryId(ASTHMA), "aa11");
  const about = new Map([
    [
      `${SCT}195967001`,
      {
        notation: "195967001",
        name: {
          label: "Asthma (disorder)",
          altLabels: [],
          origin: "urn:test:names-2",
        },
        status: {
          deprecated: true,
          replacedBy: [`${SCT}195967002`],
          origin: "urn:test:status-1",
        },
      },
    ],
  ]);
  const held = [NAMES, STATUS];
  const entry = view.entryOf(ENTRY_ANSWERS, "aa11", { about, held });
  assert.equal(entry.name, "Asthma (disorder)");
  assert.equal(entry.recorded, "Asthma");
  assert.equal(entry.kind, "condition");
  assert.deepEqual(entry.tags, ["Retired code"]);
  assert.deepEqual(entry.codes, [{ notation: "195967001", series: NAMES }]);
  assert.deepEqual(
    entry.where.map(({ place }: { place: string }) => place),
    [AT_LARKSPUR, AT_MERIDIAN],
    "oldest arrival first",
  );
  assert.deepEqual(
    entry.known.map(({ sentence }: { sentence: string }) => sentence),
    [
      `Cascade recorded it at ${AT_MERIDIAN} and ${AT_LARKSPUR} and keeps it as one condition.`,
      '195967001 is named "Asthma (disorder)".',
      "195967001 is retired, replaced by 195967002.",
    ],
  );
  assert.deepEqual(entry.credits, [NAMES.credit, STATUS.credit]);

  const page = render(
    view.entryPage({
      entry,
      pod: "alex-rivera",
      back: "/pods/alex-rivera/",
      codeHref: (series: { iri: string }, notation: string) =>
        `/code/${series.iri}/${notation}`,
      tableHref: (series: { iri: string }) => `/table/${series.iri}`,
    }),
  );
  const words = textOf(page).replace(/ \./g, ".");
  for (const shown of [
    "Asthma (disorder) Retired code",
    "Recorded as Asthma",
    "Since Mar 2, 2019",
    "Code 195967001",
    `${AT_LARKSPUR} retrieved Jul 30, 2026; arrived Aug 1, 2026 through FHIR pull`,
    `${AT_MERIDIAN} retrieved Sep 1, 2026; arrived Sep 10, 2026 through Apple Health export`,
    "195967001 is retired, replaced by 195967002. From Example status, version 1, Sep 1, 2026.",
    "From Example names, version 2, Oct 1, 2026.",
    "Back to Alex Rivera",
  ])
    assert.ok(words.includes(shown), `${shown} is not in ${words}`);
  for (const link of [
    '<a href="/code/urn:test:names/195967001">195967001</a>',
    '<a href="/table/urn:test:status">version 1, Sep 1, 2026</a>',
    '<a href="/pods/alex-rivera/">Back to Alex Rivera</a>',
  ])
    assert.ok(page.includes(link), link);
  for (const credit of [NAMES.credit, STATUS.credit])
    assert.equal(words.split(credit).length, 2, `${credit} is said once`);
});

test("before the tables can say, an entry shows the record's own name and each code as written, unlinked, with no claim from a table, and where it came from and what Cascade did unchanged", () => {
  const entry = view.entryOf(ENTRY_ANSWERS, "aa11");
  assert.equal(entry.name, "Asthma");
  assert.equal(entry.recorded, undefined);
  assert.deepEqual(entry.tags, []);
  assert.deepEqual(entry.codes, [{ notation: "195967001" }]);
  assert.equal(entry.where.length, 2);
  assert.equal(entry.known.length, 1);
  assert.deepEqual(entry.credits, []);
  const page = render(view.entryPage({ entry, pod: "alex-rivera", back: "/" }));
  assert.ok(textOf(page).includes("Code 195967001"));
  assert.ok(!page.includes('<a href="/code'));
});

test("an entry kept as one names the held table version whose rows joined it, and says nothing of a version the app does not hold; another table that joined it has a line of its own", () => {
  const joined = (...used: string[]) => new Map([[ASTHMA, used]]);
  const held = [NAMES, STATUS];
  const only = view.entryOf(ENTRY_ANSWERS, "aa11", {
    held,
    joined: joined("urn:test:names-2", "urn:test:rules", "urn:test:names-2"),
  });
  assert.equal(only.known.length, 1);
  assert.equal(only.known[0].from.series, NAMES);
  const page = textOf(
    render(
      view.entryPage({
        entry: only,
        pod: "alex-rivera",
        back: "/",
        tableHref: (series: { iri: string }) => `/table/${series.iri}`,
      }),
    ),
  ).replace(/ \./g, ".");
  assert.ok(
    page.includes(
      "and keeps it as one condition. Matched using Example names, version 2, Oct 1, 2026.",
    ),
    page,
  );

  assert.ok(
    render(
      view.entryPage({
        entry: only,
        pod: "p",
        back: "/",
        tableHref: (series: { iri: string }) => series.iri,
      }),
    ).includes('Matched using Example names, <a href="urn:test:names">'),
    "the version link follows the table's name after a space",
  );

  const twice = view.entryOf(ENTRY_ANSWERS, "aa11", {
    held,
    joined: joined("urn:test:names-2", "urn:test:status-1"),
  });
  assert.deepEqual(
    twice.known.map(({ from }: { from?: { series: object } }) => from?.series),
    [NAMES, STATUS],
  );
  const twicePage = textOf(
    render(
      view.entryPage({
        entry: twice,
        pod: "p",
        back: "/",
        tableHref: (series: { iri: string }) => series.iri,
      }),
    ),
  ).replace(/ \./g, ".");
  assert.ok(
    twicePage.includes("Also matched using Example status, version 1,"),
    twicePage,
  );
  assert.ok(!twicePage.includes("Another reference table"), twicePage);

  const none = view.entryOf(ENTRY_ANSWERS, "aa11", {
    held,
    joined: joined("urn:test:rules"),
  });
  assert.equal(none.known.length, 1);
  assert.equal(none.known[0].from, undefined);
});

test("the Medications tile holds a By class link to the class view, and no other tile does; with no medication or no address there is none", () => {
  const props = { pod: "alex-rivera", signIn: () => "", findHospital: "" };
  const answers = {
    [ALLERGIES]: [{ entry: "e1", allergen: "Penicillin" }],
    [MEDICATIONS]: [
      { entry: "e8", medication: "Lisinopril 10 MG Oral Tablet" },
    ],
  };
  const page = render(
    view.podPage(answers, {
      ...props,
      classesHref: "?pod=alex-rivera&classes",
    }),
  );
  const boxes = [...page.matchAll(/<div class="tile-box">(.*?)<\/div>/g)];
  assert.equal(boxes.length, 1);
  const [, box = ""] = boxes[0] ?? [];
  assert.match(box, /Medications/);
  assert.match(
    box,
    /<a class="by" href="\?pod=alex-rivera&amp;classes"[^>]*>By class<\/a>/,
  );
  assert.equal((page.match(/By class/g) ?? []).length, 1);
  assert.equal((page.match(/<a class="tile"/g) ?? []).length, 2);

  const without = render(view.podPage(answers, props));
  assert.ok(!without.includes("By class"));
  const noMedicines = render(
    view.podPage(
      { [ALLERGIES]: answers[ALLERGIES] },
      { ...props, classesHref: "?classes" },
    ),
  );
  assert.ok(!noMedicines.includes("By class"));
});

test("the sidebar says the reference tables are loading until the app has read what it holds, says None yet only after a read that found none, and says they could not be read after one that failed", () => {
  const nav = (state: "loading" | "none" | "failed", series: object[] = []) =>
    textOf(
      render(
        view.tablesNav({
          series,
          href: () => "/",
          check: "/check",
          loading: state === "loading",
          failed: state === "failed",
        }),
      ),
    );
  assert.ok(nav("loading").includes("Loading the reference tables"));
  assert.ok(!nav("loading").includes("None yet"));
  assert.ok(nav("none").includes("None yet"));
  assert.ok(!nav("none").includes("Loading"));
  const failed = nav("failed");
  assert.ok(failed.includes("The reference tables could not be read."), failed);
  assert.ok(
    !failed.includes("None yet") && !failed.includes("Loading"),
    failed,
  );
  assert.ok(failed.includes("Check now"), failed);
  const some = [{ iri: "urn:test:a", label: "Example names" }];
  assert.ok(nav("loading", some).includes("Example names"));
  assert.ok(!nav("loading", some).includes("Loading"));
});

test("an entry no section shows is named and kinded from its label and says what a review line says; an address of no entry says so and links back", () => {
  const entry = view.entryOf(ENTRY_ANSWERS, "bb22");
  assert.equal(entry.name, "Latex");
  assert.equal(entry.kind, "allergy");
  assert.deepEqual(entry.what, []);
  assert.deepEqual(entry.codes, []);
  assert.deepEqual(entry.where, [
    {
      place: "Alex's own entries",
      arrived: "2026-09-12T10:00:00Z",
      records: 1,
    },
  ]);
  assert.deepEqual(entry.tags, ["Needs review"]);
  assert.deepEqual(entry.known, [
    {
      sentence:
        "Latex was marked as different, but is still shown as one allergy.",
      tag: "Needs review",
    },
  ]);

  assert.equal(view.entryOf(ENTRY_ANSWERS, "0"), undefined);
  const gone = textOf(
    render(
      view.entryPage({
        entry: undefined,
        pod: "alex-rivera",
        back: "/pods/alex-rivera/",
      }),
    ),
  );
  assert.ok(gone.includes("This entry is no longer in this pod."));
  assert.ok(gone.includes("Back to Alex Rivera"));
});

test("what the tables say of the codes a pod holds includes the ingredients those codes map to", async () => {
  const RX = "urn:test:rxnorm/";
  const answers = {
    "pod/My active medications": [
      { entry: "m1", medication: "Lisinopril", code: `${RX}314076` },
    ],
    "pod/My medication history": [
      { entry: "m2", medication: "Old", code: `${RX}1`, ended: "2024-01-01" },
    ],
  };
  const asked: string[][] = [];
  const tables = () => ({
    about: async (codes: string[]) => {
      asked.push(codes);
      return new Map(
        codes.map((code) => [
          code,
          code === `${RX}314076`
            ? { ingredients: { codes: [`${RX}29046`], origin: "urn:v" } }
            : { name: { label: "lisinopril", altLabels: [], origin: "urn:v" } },
        ]),
      );
    },
  });
  const about = await view.codesSaid(answers, { tables: tables() });
  assert.deepEqual(asked, [[`${RX}314076`, `${RX}1`], [`${RX}29046`]]);
  assert.equal(about.get(`${RX}1`).name.label, "lisinopril");
  assert.equal(about.get(`${RX}29046`).name.label, "lisinopril");
});

const DIFFERS = "Differs";
const COUNSELLOR =
  "Your clinician or a genetic counsellor can explain what this means for you.";
const HARBOURLINE = "Harbourline Genetics";
const COLUMBA = "St Columba's Hospital";
const CLINVAR = {
  iri: "urn:test:clinvar",
  label: "ClinVar variant classifications",
  credit:
    "ClinVar, NCBI. Not intended for direct diagnostic use or medical decision-making without review by a genetics professional.",
  versions: [{ iri: VERSION, label: "1", issued: "2026-10-01" }],
};
const entryRow = (
  entry: string,
  label: string,
  record: string,
  document: string,
  extra: object,
) => ({
  entry,
  entryLabel: label,
  record,
  document,
  importLabel: "FHIR pull",
  ...extra,
});
const NAME = "NM_000249.3:c.2042C>T";
/**
 * One variant entry kept from two labs, a report of it from each, and a report whose variant only the reports name,
 * which has no lab.
 */
const VARIANT_ANSWERS = {
  [ALLERGIES]: [{ entry: "e1", allergen: "Penicillin" }],
  [VARIANTS]: [
    { variant: "v1", gene: "MLH1", hgvs: NAME },
    { variant: "v1", gene: "MLH1", hgvs: "NM_000249.4:c.2042C>T" },
    { variant: "v1", gene: "MLH1", variation: "90011" },
  ],
  [REPORTS]: [
    report("r1", "VUS", "2022-05-01"),
    report("r2", "LikelyPathogenic", "2024-03-21"),
    { ...report("r3", "Benign", "2023-01-01"), variant: "orphan" },
  ],
  [SEEN]: [HARBOURLINE, COLUMBA].map((place) => ({
    entry: "v1",
    place,
    records: "1",
    places: "2",
  })),
  [SOURCES]: [
    entryRow("v1", `Variant entry · ${NAME}`, "v1-a", "doc-2022", {
      hospital: HARBOURLINE,
      arrived: "2026-09-01T10:00:00Z",
    }),
    entryRow("v1", `Variant entry · ${NAME}`, "v1-b", "doc-2024", {
      hospital: COLUMBA,
      arrived: "2026-09-02T10:00:00Z",
    }),
    entryRow("r1", "Interpretation entry · VUS", "r1-a", "doc-2022", {
      hospital: HARBOURLINE,
      arrived: "2026-09-01T10:00:00Z",
    }),
    entryRow("r2", "Interpretation entry · LP", "r2-a", "doc-2024", {
      hospital: COLUMBA,
      arrived: "2026-09-02T10:00:00Z",
    }),
    entryRow("r3", "Interpretation entry · Benign", "r3-a", "doc-other", {}),
    entryRow(
      "orphan",
      "Variant entry · NM_000500.1:c.1A>G",
      "o-a",
      "doc-other",
      {},
    ),
  ],
};
const VARIANTS_SAID = {
  says: new Map([["v1", rows({ classification: [concept("Pathogenic")] })]]),
  verdicts: [verdict("r1", "differs")],
  labels: LABELS,
};

test("a pod's page has a Genetic variants tile beside the others, a row for each variant entry that opens it, naming its gene and expression, counting its reports and tagged only once the tables say a report differs; the page has no variants card and no column of its own for ClinVar today, and Worth a look says which report differs and links to the variant's entry", () => {
  const page = (said?: object) =>
    render(
      view.podPage(VARIANT_ANSWERS, {
        pod: "martin",
        signIn: () => "",
        entryHref: (entry: string) => `/entries/${entry}`,
        said,
      }),
    );
  const rowsOf = (html: string) =>
    [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((found) => ({
      text: textOf((found[1] ?? "").replace(/ data-key="[^"]*"/g, "")),
      href: /<a href="([^"]*)"/.exec(found[1] ?? "")?.[1],
    }));
  const before = page();
  assert.ok(textOf(before).includes("Allergies 1"));
  assert.ok(textOf(before).includes("Genetic variants 2"));
  const ofVariants = ({ href }: { href?: string }) =>
    ["/entries/v1", "/entries/orphan"].includes(href ?? "");
  assert.deepEqual(rowsOf(before).filter(ofVariants), [
    { text: `MLH1 ${NAME} 2`, href: "/entries/v1" },
    { text: "NM_000500.1:c.1A>G 1", href: "/entries/orphan" },
  ]);
  assert.deepEqual(
    rowsOf(page(VARIANTS_SAID))
      .filter(ofVariants)
      .map(({ text }) => text),
    [`MLH1 ${NAME} Differs 2`, "NM_000500.1:c.1A>G 1"],
  );
  assert.ok(!textOf(before).includes("ClinVar today"), "no column of its own");
  assert.ok(!before.includes('class="card variants"'));
  assert.ok(!textOf(before).includes("counsellor"));
  assert.ok(!before.includes("card worth"), "nothing needs a look yet");
  assert.ok(!textOf(before).includes("Cascade keeps it as one variant"));
  const differing = `MLH1 ${NAME}: your 2022 report from ${HARBOURLINE} differs from ClinVar today.`;
  assert.deepEqual(view.worthALook(VARIANT_ANSWERS), []);
  assert.deepEqual(view.worthALook(VARIANT_ANSWERS, new Map(), VARIANTS_SAID), [
    { sentence: differing, entry: "v1", tag: DIFFERS },
  ]);
  const worth = /<div class="card worth">([\s\S]*?)<\/div>/.exec(
    page(VARIANTS_SAID),
  )?.[1];
  assert.equal(textOf(worth ?? ""), `Worth a look ${differing} ${DIFFERS}`);
  assert.ok(worth?.includes('<a href="/entries/v1">'), "it opens the entry");
  assert.deepEqual(
    view.named(VARIANT_ANSWERS, new Map())[VARIANTS],
    VARIANT_ANSWERS[VARIANTS],
  );
  const bare = render(
    view.podPage(
      { [ALLERGIES]: VARIANT_ANSWERS[ALLERGIES] },
      { pod: "martin", signIn: () => "" },
    ),
  );
  assert.ok(!bare.includes("Genetic variants"));
});

test("variantReports gives each variant entry a pod holds, those its questions list first and a variant only a report names last, with its reports apart from their sentences", () => {
  const found = view.variantReports(VARIANT_ANSWERS, VARIANTS_SAID, [CLINVAR]);
  assert.deepEqual([...found.keys()], ["v1", "orphan"]);
  const mlh1 = found.get("v1");
  assert.equal(mlh1.name, `MLH1 ${NAME}`);
  assert.deepEqual(mlh1.asked, {
    gene: "MLH1",
    hgvs: [NAME, "NM_000249.4:c.2042C>T"],
    variations: ["90011"],
  });
  assert.deepEqual(
    mlh1.reports.map(({ report, when, place, tag }: Record<string, string>) => [
      report,
      when,
      place,
      tag,
    ]),
    [
      ["r1", "2022", HARBOURLINE, DIFFERS],
      ["r2", "2024", COLUMBA, undefined],
    ],
  );
  assert.equal(mlh1.clinvar, "ClinVar today says pathogenic.");
  assert.deepEqual(mlh1.from, {
    series: CLINVAR,
    version: CLINVAR.versions[0],
  });
  const orphan = found.get("orphan");
  assert.equal(orphan.name, "NM_000500.1:c.1A>G");
  assert.deepEqual(orphan.asked, { hgvs: [], variations: [] });
  assert.deepEqual(orphan.reports, [
    { report: "r3", when: "2023", sentence: "Your 2023 report said benign." },
  ]);
  assert.equal(orphan.clinvar, undefined);
  assert.equal(orphan.from, undefined);
  const early = view.variantReports(VARIANT_ANSWERS).get("v1");
  assert.deepEqual(
    early.reports.map(({ tag }: { tag?: string }) => tag),
    [undefined, undefined],
  );
  assert.equal(early.clinvar, undefined);
});

test("a variant is named by ClinVar's name of the one variation its classification found, its page saying which table named it; one the classification found none for, found two variations for, or the names table has no row for, or whose names version is not held, keeps its gene and expression", async () => {
  const PROTEIN = "NM_000249.4(MLH1):c.2042C>T (p.Ala681Val)";
  const NAMES = { iri: "urn:test:names", versions: [{ iri: "ni:///names-1" }] };
  const name = { label: PROTEIN, altLabels: [], origin: "ni:///names-1" };
  const stem = "http://www.ncbi.nlm.nih.gov/clinvar/";
  const answers = {
    [VARIANTS]: ["named", "unfound", "unnamed", "twofold"].map(
      (variant, at) => ({
        variant,
        gene: "MLH1",
        variation: String(at),
      }),
    ),
    [SOURCES]: [
      entryRow("named", "Variant entry · MLH1", "n-a", "doc", {
        hospital: HARBOURLINE,
        arrived: "2026-09-01T10:00:00Z",
      }),
    ],
  };
  const found = (variation: string) => ({
    ...rows({}),
    rows: [{ variation, classification: [] }],
  });
  const tables = {
    variantClassification: async ({ variations }: { variations: string[] }) =>
      variations[0] === "1"
        ? { found: "not found", series: "s", version: "v" }
        : variations[0] === "3"
          ? {
              ...found(`${stem}0`),
              rows: [`${stem}0`, `${stem}3`].map((variation) => ({
                variation,
                classification: [],
              })),
            }
          : found(`${stem}${variations[0]}`),
    labels: async () => new Map(),
    held: async () => [NAMES],
    about: async (codes: string[]) =>
      new Map(
        codes.map((code) => [
          code,
          code === `${stem}0` ? { notation: "0", name } : { notation: "x" },
        ]),
      ),
  };
  const said = await view.variantsSaid(answers, { tables, pod: undefined });
  const named = view.variantReports(answers, said, [NAMES]);
  assert.deepEqual(
    [...named].map(([entry, { name }]) => [entry, name]),
    [
      ["named", PROTEIN],
      ["unfound", "MLH1"],
      ["unnamed", "MLH1"],
      ["twofold", "MLH1"],
    ],
  );
  const unheld = view.variantReports(
    answers,
    await view.variantsSaid(answers, {
      tables: { ...tables, held: async () => [] },
      pod: undefined,
    }),
    [],
  );
  assert.equal(unheld.get("named").name, "MLH1");
  assert.equal(unheld.get("named").namedFrom, undefined);
  assert.deepEqual(named.get("named").namedFrom, {
    series: NAMES,
    version: NAMES.versions[0],
  });
  const entry = view.entryOf(answers, "named", { said, held: [NAMES] });
  assert.equal(entry.name, PROTEIN);
  assert.deepEqual(entry.known[0], {
    sentence: `ClinVar names this variation ${PROTEIN}.`,
    from: { series: NAMES, version: NAMES.versions[0] },
  });
});

test("a variant's entry says its gene and expressions, its ClinVar ID linked to the series, the document each report came with and its date, and what else is known: what Cascade did, each report with its lab, ClinVar today with its table and version, the counsellor sentence, and the series' credit once", () => {
  const entry = view.entryOf(VARIANT_ANSWERS, "v1", {
    said: VARIANTS_SAID,
    held: [CLINVAR],
  });
  assert.equal(entry.name, `MLH1 ${NAME}`);
  assert.equal(entry.kind, "variant");
  assert.deepEqual(entry.tags, [DIFFERS]);
  assert.deepEqual(entry.what, [
    { head: "Gene", text: "MLH1" },
    { head: "Expressions", text: `${NAME}, NM_000249.4:c.2042C>T` },
  ]);
  assert.deepEqual(entry.codes, [{ notation: "90011", series: CLINVAR }]);
  assert.deepEqual(
    entry.where.map(({ place, issued }: Record<string, string>) => [
      place,
      issued,
    ]),
    [
      [HARBOURLINE, "2022-05-01"],
      [COLUMBA, "2024-03-21"],
    ],
  );
  assert.deepEqual(entry.known, [
    {
      sentence: `Cascade recorded it at ${HARBOURLINE} and ${COLUMBA} and keeps it as one variant.`,
    },
    {
      sentence: `Your 2022 report from ${HARBOURLINE} said uncertain significance.`,
      tag: DIFFERS,
    },
    { sentence: `Your 2024 report from ${COLUMBA} said likely pathogenic.` },
    {
      sentence: "ClinVar today says pathogenic.",
      from: { series: CLINVAR, version: CLINVAR.versions[0] },
    },
    { sentence: COUNSELLOR },
  ]);
  assert.deepEqual(entry.credits, [CLINVAR.credit]);
  const page = render(
    view.entryPage({
      entry,
      pod: "martin-okafor",
      back: "/pods/martin-okafor/",
      codeHref: (series: { iri: string }, notation: string) =>
        `/code/${series.iri}/${notation}`,
      tableHref: (series: { iri: string }) => `/table/${series.iri}`,
    }),
  );
  const words = textOf(page).replace(/ \./g, ".");
  for (const shown of [
    `${entry.name} ${DIFFERS}`,
    `Gene MLH1`,
    `${HARBOURLINE} report of May 1, 2022;`,
    `${COLUMBA} report of Mar 21, 2024;`,
    `uncertain significance. ${DIFFERS}`,
    "ClinVar today says pathogenic. From ClinVar variant classifications, version 1, Oct 1, 2026.",
  ])
    assert.ok(words.includes(shown), `${shown} is not in ${words}`);
  assert.ok(page.includes('<a href="/code/urn:test:clinvar/90011">90011</a>'));
  assert.equal(
    words.split(CLINVAR.credit).length,
    2,
    "the credit is said once",
  );
});

test("before the tables can say, a variant's entry names each report's lab and its classification in the IRI's own words, with no tag, no ClinVar sentence and its ClinVar ID unlinked; a variant only a report names is named from its label and takes the date of the document it shares", () => {
  const entry = view.entryOf(VARIANT_ANSWERS, "v1");
  assert.deepEqual(entry.tags, []);
  assert.deepEqual(entry.codes, [{ notation: "90011" }]);
  assert.deepEqual(
    entry.known.map(({ sentence }: { sentence: string }) => sentence),
    [
      `Cascade recorded it at ${HARBOURLINE} and ${COLUMBA} and keeps it as one variant.`,
      `Your 2022 report from ${HARBOURLINE} said VUS.`,
      `Your 2024 report from ${COLUMBA} said likely pathogenic.`,
      COUNSELLOR,
    ],
  );
  assert.deepEqual(entry.credits, []);
  assert.ok(
    !render(
      view.entryPage({ entry, pod: "martin-okafor", back: "/" }),
    ).includes('<a href="/code'),
  );

  const orphan = view.entryOf(VARIANT_ANSWERS, "orphan");
  assert.equal(orphan.name, "NM_000500.1:c.1A>G");
  assert.equal(orphan.kind, "variant");
  assert.deepEqual(orphan.what, []);
  assert.deepEqual(orphan.codes, []);
  assert.deepEqual(
    orphan.where.map(({ issued }: Record<string, string>) => issued),
    ["2023-01-01"],
  );
  assert.deepEqual(
    orphan.known.map(({ sentence }: { sentence: string }) => sentence),
    ["Your 2023 report said benign.", COUNSELLOR],
  );
});

const HISTORY = "pod/My medication history";

interface Story {
  pod: Pod;
  answers: Record<string, Row[]>;
  changes: Finding[];
}

let built: Promise<Map<string, Story>> | undefined;

/** The five story patients' pods, brought in from North once and shared by the tests that need them. */
function storyPods(): Promise<Map<string, Story>> {
  built ??= (async () => {
    const north = await loadHospital("cascade-north");
    const stories = new Map<string, Story>();
    for (const { patient } of await loadStories()) {
      const { pull } = await pulled(north, patient);
      const pod = await openPod();
      const imported = await pod.import(pullFiles(pull, "north"), {
        aboutSubject: true,
      });
      assert.equal(imported.refused, undefined, patient);
      const answers = Object.fromEntries(
        await Promise.all(
          (view.QUESTIONS as string[]).map(
            async (question) => [question, await pod.ask(question)] as const,
          ),
        ),
      );
      stories.set(patient, {
        pod,
        answers,
        changes: changesIn(answers[HISTORY]!, answers[LABS]!, { limit: 20 }),
      });
    }
    return stories;
  })();
  return built;
}

after(async () => {
  for (const { pod } of (await built)?.values() ?? []) await pod.close();
});

const entryLink = (entry: string) => `/entry/${view.entryId(entry)}`;
const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const count = (markup: string, part: string) => markup.split(part).length - 1;
const hrefsOf = (markup: string, label: string) =>
  [
    ...markup.matchAll(new RegExp(`<a href="([^"]*)"[^>]*>${label}</a>`, "g")),
  ].map(([, href]) => href!.replaceAll("&amp;", "&"));
const capitalised = (sentence: string) =>
  sentence[0]!.toUpperCase() + sentence.slice(1);

/** A story pod's page as the Node starter draws it, with `answers` in place of the pod's own. */
function podOf(name: string, story: Story, answers = story.answers) {
  return render(
    view.podPage(answers, {
      pod: name,
      signIn: () => null,
      entryHref: entryLink,
      changes: story.changes,
      trendHref: (trend: object) => trendPath(name, trend),
    }),
  );
}

/** A story pod's trend page for the test and medication asked, as the Node starter draws it. */
function trendOf(
  name: string,
  { answers, changes }: Story,
  asked: { test?: string; medication?: string },
  ask?: boolean,
) {
  const labs = answers[LABS]!;
  const medications = answers[HISTORY]!;
  const input = view.trendInput({ changes, labs }, asked);
  let series;
  try {
    series = input === undefined ? undefined : labSeriesIn(labs, input.test);
  } catch {
    series = undefined;
  }
  return render(
    view.trendPage({
      pod: name,
      back: `/pods/${name}/`,
      labs,
      series,
      timeline: timelineIn(medications),
      test: input?.test,
      medication: input?.medication,
      trendHref: (trend: object) => trendPath(name, trend),
      ...(ask ? { ask } : {}),
    }),
  );
}

test("What changed on the statin story patient's page: one card in CHANGED's words with both means and counts, the six results behind it each linking to its entry, and the trend's address", async () => {
  const story = (await storyPods()).get("story-statin")!;
  const [finding] = story.changes;
  const page = podOf("ines-calloway", story);
  assert.equal(count(page, 'class="change"'), 1);
  const said = capitalised(
    view.CHANGED["after start"].down(
      finding!.test.name,
      finding!.medication.name,
    ),
  );
  assert.ok(text(page).includes(said), said);
  assert.match(
    text(page),
    /162 → 98\.3 mg\/dL, the mean of 3 results before and 3 after/,
  );

  const behind = page.slice(page.indexOf('id="change-start-617310-18262-6"'));
  const [box] = behind.split('class="dialog"');
  assert.deepEqual(
    hrefsOf(box!, "[^<]*").sort(),
    [...finding!.rows.before, ...finding!.rows.after]
      .map(({ entry }) => entryLink(entry!))
      .sort(),
  );
  assert.deepEqual(hrefsOf(page, "Open the trend"), [
    trendPath("ines-calloway", { test: "18262-6", medication: "617310" }),
  ]);
  assert.deepEqual(hrefsOf(page, "Show the 6 results"), [
    "#change-start-617310-18262-6",
  ]);
});

test("What changed says nothing stands out when no pair does, counts a pair with too few results without a card, and is absent when the pod holds no lab row or no medication-history row", async () => {
  const stories = await storyPods();
  const herring = podOf("pell-hargrove", stories.get("story-red-herring")!);
  assert.match(text(herring), /Nothing stands out yet\./);
  assert.equal(count(herring, 'class="change"'), 0);

  const little = stories.get("story-too-little")!;
  const thin = podOf("rafferty-moon", little);
  assert.equal(count(thin, 'class="change"'), 0);
  assert.match(
    text(thin),
    /1 pair of a medication and a test had too few results to say anything\./,
  );
  assert.match(text(thin), /3 results before, 1 after/);
  assert.deepEqual(hrefsOf(thin, "Open the trend"), [
    trendPath("rafferty-moon", { test: "2823-3", medication: "979492" }),
  ]);

  for (const question of [LABS, HISTORY])
    assert.equal(
      count(
        podOf("pell-hargrove", little, { ...little.answers, [question]: [] }),
        'class="card changes"',
      ),
      0,
      question,
    );
});

test("nothing What changed or the trend draws, for any of the five stories, nor any sentence CHANGED gives, says why a result changed", async () => {
  const causes =
    /because|caus|due to|effect|led to|improv|worsen|thanks to|\bworks?\b/i;
  const sentences = Object.values(view.CHANGED as object).flatMap((byWay) =>
    Object.values(byWay as object).map((say) =>
      (say as (a: string, b: string) => string)("Test", "Medication"),
    ),
  );
  assert.equal(sentences.length, 4);
  for (const sentence of sentences) assert.doesNotMatch(sentence, causes);

  for (const [patient, story] of await storyPods()) {
    const drawn = text(
      render(
        view.changedPart({
          changes: story.changes,
          about: new Map(),
          entryHref: entryLink,
          trendHref: (trend: object) => trendPath(patient, trend),
        }),
      ),
    );
    assert.match(drawn, /What changed/, patient);
    assert.doesNotMatch(drawn, causes, patient);
    assert.doesNotMatch(text(trendOf("a-pod", story, {})), causes, patient);
  }
});

test("a pod brought in twice says where What changed comes from: the imports in order, each with its source, retrieved date and what it brought in, and the medication's new version with what differs; one import, or a medication of one version, says less", async () => {
  const story = (await storyPods()).get("story-statin")!;
  const [finding] = story.changes;
  const entry = finding!.medication.entry;
  const record = String(
    story.answers[view.SOURCES]!.find((row: Row) => row.entry === entry)!
      .record,
  );
  const IMPORTS = "pod/What each import brought in";
  const REVISIONS = "record/Its revisions, in the order they arrived";
  const VERSIONS = "record/What each version says";
  const CLINICAL = "https://ns.cascadeprotocol.org/clinical/v1#";
  const north = "Cascade North Demo Hospital";
  const imported = (n: number, records: string[]) =>
    records.map((each) => ({
      started: `202${3 + n}-02-01T09:05:00Z`,
      import: `urn:uuid:import-${n}`,
      importLabel: "FHIR pull",
      record: each,
    }));
  const arrival = (n: number, each: string, version: string, extra = {}) => ({
    record: each,
    revision: `ni:revision-${n}-${each}`,
    version,
    arrived: `202${3 + n}-02-01T09:05:00Z`,
    import: `urn:uuid:import-${n}`,
    hospital: north,
    retrieved: `202${3 + n}-02-01T00:00:00Z`,
    ...extra,
  });
  const said = (version: string, field: string, value: string) => ({
    version,
    field: `${CLINICAL}${field}`,
    value,
  });
  const twice = {
    ...story.answers,
    [IMPORTS]: [...imported(1, ["r-other", record]), ...imported(2, [record])],
    [REVISIONS]: [
      arrival(1, "r-other", "ni:other"),
      arrival(1, record, "ni:first"),
      arrival(2, record, "ni:second", { previous: "ni:revision-1" }),
    ],
    [VERSIONS]: [
      said("ni:first", "drugName", "Atorvastatin"),
      said("ni:first", "status", "active"),
      said("ni:second", "drugName", "Atorvastatin"),
      said("ni:second", "endDate", "2024-04-15"),
      said("ni:second", "status", "completed"),
    ],
  };
  const drawn = text(podOf("pell-hargrove", story, twice));
  assert.match(
    drawn,
    /Where this comes from The pod was filled by 2 imports, in this order: FHIR pull on Feb 1, 2024, from Cascade North, retrieved Feb 1, 2024\. It brought in 2 records\. FHIR pull on Feb 1, 2025, from Cascade North, retrieved Feb 1, 2025\. It brought in 1 record, 1 of them a new version of a record the pod already held\. .+ came in a new version: version 1 to version 2, in import 2, on Feb 1, 2025\. Status active → completed; end date none → Apr 15, 2024\./,
  );
  assert.doesNotMatch(drawn, /urn:|ni:|https?:/);
  assert.doesNotMatch(
    drawn.slice(drawn.indexOf("Where this comes from")),
    /because|caus|due to|effect|led to|improv|worsen|thanks to|\bworks?\b/i,
  );

  const once = text(podOf("pell-hargrove", story));
  assert.match(once, /What changed/);
  assert.doesNotMatch(once, /Where this comes from/);

  const unrevised = text(
    podOf("pell-hargrove", story, {
      ...twice,
      [REVISIONS]: twice[REVISIONS]!.slice(0, 2).concat(
        arrival(2, "r-third", "ni:third"),
      ),
    }),
  );
  assert.match(unrevised, /The pod was filled by 2 imports/);
  assert.doesNotMatch(unrevised, /came in a new version/);
});

test("the trend names its first date from the earliest result, and its test and medication by the tables where they name the code, else by the record's own text", () => {
  const series = {
    test: {
      code: "http://loinc.org/18262-6",
      notation: "18262-6",
      name: "LDL",
    },
    results: [{ date: "2024-03-10", value: 98, unit: "mg/dL" }],
    left: { unparsed: 0, undated: 0 },
  };
  const timeline = [
    {
      name: "Atorvastatin",
      code: "http://www.nlm.nih.gov/research/umls/rxnorm/617310",
      notation: "617310",
      started: "2024-01-05",
    },
    { name: "Aspirin", notation: "1191", started: "2020-01-01" },
  ];
  const drawn = (about?: Map<string, unknown>) =>
    render(
      view.trendPage({
        pod: "a-pod",
        back: "/pods/a-pod/",
        labs: [],
        series,
        timeline,
        test: "18262-6",
        medication: "617310",
        trendHref: (trend: object) => trendPath("a-pod", trend),
        ...(about ? { about } : {}),
      }),
    );

  const own = drawn();
  assert.match(
    own,
    /<desc id="trend-chart-desc">1 result from Mar 10, 2024 to Mar 10, 2024/,
  );
  assert.match(own, /Atorvastatin started Jan 5, 2024./);
  assert.match(text(own), /LDL/);
  assert.match(text(own), /Atorvastatin/);

  const named = drawn(
    new Map([
      [series.test.code, { name: { label: "LDL cholesterol" } }],
      [timeline[0]!.code!, { name: { label: "Atorvastatin calcium" } }],
    ]),
  );
  assert.match(named, /<h1>LDL cholesterol[<]/);
  assert.match(named, /Atorvastatin calcium started/);
  assert.match(text(named), /Aspirin/);
});

test("the trend states that the chart leaves out a result in another unit, while its table still lists it", () => {
  const series = {
    test: { code: "http://loinc.org/18262-6", notation: "18262-6" },
    results: [
      { date: "2024-03-10", value: 98, unit: "mg/dL" },
      { date: "2024-04-10", value: 98, unit: "mg/dL" },
      { date: "2024-05-10", value: 2.5, unit: "mmol/L" },
    ],
    left: { unparsed: 0, undated: 0 },
  };
  const page = render(
    view.trendPage({
      pod: "a-pod",
      back: "/pods/a-pod/",
      labs: [],
      series,
      timeline: [],
      test: "18262-6",
      trendHref: (trend: object) => trendPath("a-pod", trend),
    }),
  );
  assert.match(text(page), /The chart leaves out 1 result in another unit/);
  assert.doesNotMatch(text(page), /Left out/);
  assert.equal(count(page, "<tr><td>"), 3);
});

test("the trend round-trips through its address: the state read from it draws the same test and medication, a marker for each result, the medication's start marked, the test named and the results in a table; a test the pod lacks says so", async () => {
  const story = (await storyPods()).get("story-statin")!;
  const href = trendPath("ines-calloway", {
    test: "18262-6",
    medication: "617310",
  });
  const query = new URL(href, "http://app.test").searchParams;
  const asked = {
    test: query.get("test") ?? undefined,
    medication: query.get("medication") ?? undefined,
  };
  assert.deepEqual(asked, { test: "18262-6", medication: "617310" });
  const page = trendOf("ines-calloway", story, asked);

  assert.equal(count(page, 'class="marker"'), 6);
  assert.equal(count(page, 'class="mark start"'), 1);
  assert.equal(count(page, 'class="mark stop"'), 0);
  const name = story.changes[0]!.test.name!;
  assert.match(
    page,
    new RegExp(`<title id="trend-chart-title">${name}</title>`),
  );
  assert.match(
    page,
    /<desc id="trend-chart-desc">6 results from Sep 1, 2023 to Dec 2, 2024/,
  );
  assert.equal(count(page, "<tr><td>"), 6);
  assert.deepEqual(
    [...page.matchAll(/aria-current="true">([^<]*)</g)].map(([, said]) => said),
    [name, story.changes[0]!.medication.name],
  );

  assert.deepEqual(
    view.trendInput({ changes: story.changes, labs: story.answers[LABS]! }, {}),
    asked,
  );
  const none = trendOf("ines-calloway", story, { test: "18262-6" });
  assert.equal(count(none, 'class="mark start"'), 0);
  assert.equal(count(none, 'class="marker"'), 6);

  assert.match(
    text(trendOf("ines-calloway", story, { test: "0000-0" })),
    /This pod holds no results for the test 0000-0\./,
  );
});

test("Ask about this: a click sends the kind's first question, and none for a kind it does not know", () => {
  for (const [context, question] of [
    [{ kind: "finding", key: "k" }, "What does this change show?"],
    [{ kind: "trend", test: "t" }, "What does this trend show?"],
    [{ kind: "entry", id: "e" }, "What is this, and where did it come from?"],
    [{ kind: "worth", entry: "e" }, "What does this flag mean?"],
    [{ kind: "other" }, undefined],
    [{ kind: "toString" }, undefined],
  ] as const)
    assert.equal(view.firstQuestion(context), question, context.kind);
});

/** The `data-ask` contexts a page draws, in order. */
const asksOf = (markup: string) =>
  [...markup.matchAll(/data-ask="([^"]*)"/g)].map(
    ([, context]) =>
      JSON.parse(context!.replaceAll("&quot;", '"')) as Record<string, unknown>,
  );

test("suggested questions: Ines Calloway's find a change and ask about it named as the page names it, a pod with a Worth a look line and no change is offered it too, a pod's four at most keep the first and last in place, and the same answers give the same list", async () => {
  const story = (await storyPods()).get("story-statin")!;
  const [finding] = story.changes;
  const ines = view.suggestedQuestions(story.answers, {
    changes: story.changes,
  }) as string[];
  assert.deepEqual(ines, [
    "Find anything interesting in this pod",
    `Did ${finding!.test.name} change after ${finding!.medication.name} started?`,
  ]);
  assert.deepEqual(
    view.suggestedQuestions(story.answers, { changes: story.changes }),
    ines,
  );

  assert.deepEqual(
    view.suggestedQuestions(
      {
        [HISTORY]: [],
        [LABS]: [],
        [REVIEW]: [{ entry: "e1", needs: "judged different, still joined" }],
      },
      { changes: [] },
    ),
    ["Find anything interesting in this pod"],
  );

  const change = (n: number, kind: string) => ({
    kind,
    direction: "down",
    test: { code: `t${n}`, name: `Test ${n}` },
    medication: { code: `m${n}`, name: `Drug ${n}` },
  });
  const many = view.suggestedQuestions(
    { [HISTORY]: [{ medication: "Drug 1", ended: "2024-05-01" }] },
    {
      changes: [
        change(1, "after start"),
        change(2, "after stop"),
        change(3, "after start"),
        change(4, "after start"),
        { ...change(5, "after start"), direction: "not enough results" },
      ],
    },
  );
  assert.deepEqual(many, [
    "Find anything interesting in this pod",
    "Did Test 1 change after Drug 1 started?",
    "Did Test 2 change after Drug 2 stopped?",
    "Which medications have I stopped?",
  ]);
  assert.deepEqual(view.suggestedQuestions({}, { changes: [] }), []);
});

test("Ask about this: with a model set, each What changed card and each Worth a look line, the trend and an entry draw a button naming the finding's key, the line's entry ID, the entry's ID or the trend's test and medication, and with none set they draw none", async () => {
  const story = (await storyPods()).get("story-statin")!;
  const [finding] = story.changes;
  const draw = (ask?: boolean) =>
    render(
      view.podPage(story.answers, {
        pod: "ines-calloway",
        signIn: () => null,
        entryHref: entryLink,
        changes: story.changes,
        trendHref: (trend: object) => trendPath("ines-calloway", trend),
        ...(ask ? { ask } : {}),
      }),
    );
  assert.deepEqual(asksOf(draw()), []);
  assert.doesNotMatch(draw(), /Ask about this/);
  const asked = asksOf(draw(true));
  const buttons = [
    ...draw(true).matchAll(/<button [^>]*data-ask="[^>]*>(.*?)<\/button>/g),
  ];
  assert.equal(buttons.length, asked.length);
  for (const [button, inside] of buttons) {
    assert.match(button, /title="Ask about this"/);
    assert.match(button, /aria-label="Ask about this: [^"]+"/);
    assert.equal(inside!.replace(/<svg.*<\/svg>/, ""), "");
  }
  assert.deepEqual(
    asked.filter(({ kind }) => kind === "finding"),
    [{ kind: "finding", key: finding!.key }],
  );
  assert.deepEqual(
    asked.filter(({ kind }) => kind === "entry"),
    [],
  );

  const lines = {
    [REVIEW]: [
      { entry: "urn:uuid:e1", needs: "judged different, still joined" },
    ],
  };
  const worth = (ask?: boolean) =>
    render(
      view.podPage(lines, {
        pod: "ines-calloway",
        signIn: () => null,
        entryHref: entryLink,
        ...(ask ? { ask } : {}),
      }),
    );
  assert.deepEqual(asksOf(worth()), []);
  assert.deepEqual(asksOf(worth(true)), [{ kind: "worth", entry: "e1" }]);

  const marked = { test: "18262-6", medication: "617310" };
  assert.deepEqual(asksOf(trendOf("ines-calloway", story, marked)), []);
  assert.deepEqual(asksOf(trendOf("ines-calloway", story, marked, true)), [
    { kind: "trend", ...marked },
  ]);
  const [entry] = story.answers[LABS]!;
  const page = render(
    view.entryPage({
      entry: view.entryOf(story.answers, view.entryId(entry!.entry!)),
      pod: "ines-calloway",
      back: "/",
      ask: true,
    }),
  );
  assert.deepEqual(asksOf(page), [
    { kind: "entry", id: view.entryId(entry!.entry!) },
  ]);
});

test("the new-pod box offers to encrypt; the six-words page shows the words numbered with the fields a password manager reads and asks for words 2 and 5; the open page says each outcome in its own sentence, with a field for the words only where words could open the pod; an encrypted pod's chat strip says so", () => {
  const dialog = render(
    view.newPodDialog({ people: [], pods: [], action: "/pods" }),
  );
  assert.match(dialog, /Encrypt this pod with six words/);

  const words = "abacus abdomen abide abnormal abrasion abrupt";
  const shown = render(
    view.sixWordsPage({ pod: "grace-hopper", words, action: "/words" }),
  );
  assert.equal(shown.match(/<li>/g)?.length, 6);
  assert.match(shown, /name="username"[^>]*value="grace-hopper"/);
  assert.match(
    shown,
    /autoComplete="new-password"|autocomplete="new-password"/,
  );
  assert.match(shown, /Word 2/);
  assert.match(shown, /Word 5/);
  assert.match(shown, /does not hide that this pod exists/);
  assert.equal(
    render(
      view.sixWordsPage({
        pod: "grace-hopper",
        words,
        action: "/words",
        problem: view.NOT_WORDS,
      }),
    ).includes("Those aren't words 2 and 5"),
    true,
  );

  const outcomes: [string, RegExp, boolean][] = [
    ["secret needed", /six words to open it/, true],
    ["incorrect secret", /don't open this pod/, true],
    ["malformed", /header is damaged or was changed/, false],
    ["unsupported version", /newer version of Cascade/, false],
    ["cannot open", /another way, not with six words/, false],
  ];
  for (const [outcome, said, field] of outcomes) {
    const open = render(
      view.openPodPage({
        pod: "grace-hopper",
        outcome,
        action: "/pods/grace-hopper/open",
        next: "/pods/grace-hopper/",
      }),
    );
    assert.match(open, said, outcome);
    assert.equal(open.includes("current-password"), field, outcome);
  }

  const model = { provider: "other", name: "m", local: true };
  assert.match(
    render(view.Chat({ model, pod: "grace-hopper", encrypted: true })),
    /data-encrypted="true"/,
  );
  assert.doesNotMatch(
    render(view.Chat({ model, pod: "alex-rivera" })),
    /data-encrypted/,
  );
});

test("the world's date: a calendar day is the end of that day in UTC, an instant stays as given, and anything else is none; the page shows the date with Set and Today and says why a date was refused; a connection's box says what its pull answered as of; the pod's page and the hospitals page say what the hospitals answer as of now, with a link or a form to change it", () => {
  const instants: [string, string | undefined][] = [
    ["2024-02-01", "2024-02-01T23:59:59Z"],
    [" 2024-02-01 ", "2024-02-01T23:59:59Z"],
    ["2024-02-01T00:00:00Z", "2024-02-01T00:00:00Z"],
    ["2024-02-01T10:00:00+02:00", "2024-02-01T10:00:00+02:00"],
    ["", undefined],
    ["2024-02-30", undefined],
    ["2024-13-01", undefined],
    ["2024-02-01T10:00:00", undefined],
    ["0099-01-01", undefined],
    ["0999-12-31T23:59:59Z", undefined],
    ["1000-01-01", "1000-01-01T23:59:59Z"],
    ["yesterday", undefined],
  ];
  for (const [text, instant] of instants)
    assert.equal(view.worldInstant(text), instant, JSON.stringify(text));

  const text = (body: Parameters<typeof render>[0]) =>
    render(body).replace(/<[^>]*>/g, "");
  const asOf = "2024-02-01T23:59:59Z";
  assert.equal(
    view.worldDateSaid(asOf),
    "Hospitals answer as of 1 February 2024.",
  );
  assert.equal(
    view.worldDateSaid(undefined),
    "Hospitals answer with everything they hold.",
  );

  const offset = "2024-02-01T00:30:00+01:00";
  assert.equal(
    view.worldDateSaid(offset),
    "Hospitals answer as of 31 January 2024.",
  );
  assert.match(
    render(view.worldDatePage({ asOf: offset, action: "/w" })),
    /<input type="date" name="date" value="2024-01-31"/,
  );

  const shown = render(
    view.worldDatePage({ asOf, action: "/world-date", back: "/" }),
  );
  assert.match(shown, /<input type="date" name="date" value="2024-02-01"/);
  assert.match(shown, /<button>Set<\/button>/);
  assert.match(
    shown,
    /<input type="hidden" name="date" value(="")?\s*\/?>\s*<button class="quiet">Today<\/button>/,
  );
  assert.ok(
    text(view.worldDatePage({ asOf, action: "/w" })).includes(
      "as of 1 February 2024.",
    ),
  );
  assert.ok(
    text(
      view.worldDatePage({
        asOf,
        action: "/w",
        problem: "Soon is not a date.",
      }),
    ).includes("Soon is not a date."),
  );

  const box = {
    id: "connection",
    pod: "alex-rivera",
    hospital: "Cascade North Demo Hospital",
    back: "#",
    connection: { step: "pulled", requests: 3 },
    sources: [],
    pulled: { missing: [], denied: [] },
    bring: "bring",
  };
  assert.ok(
    text(view.connectionDialog({ ...box, pulledAsOf: asOf })).includes(
      "Pulled as of 1 February 2024.",
    ),
  );
  assert.doesNotMatch(
    text(view.connectionDialog(box)),
    /Pulled as of|Hospitals answer|Change the world/,
  );

  const person = {
    name: "Rowan Marsh",
    at: [{ name: "Cascade North Demo Hospital", fhirBase: "https://n" }],
  };
  const podAt = (world: object) =>
    render(
      view.podPage(
        {},
        { pod: "x", person, signIn: () => "", findHospital: "?h", world },
      ),
    );
  assert.match(
    podAt({ asOf, href: "/world-date?back=%2Fp" }),
    /Hospitals answer as of 1 February 2024\.[^<]*<a href="\/world-date\?back=%2Fp">Change the world's date<\/a>/,
  );
  assert.match(
    podAt({ asOf: undefined, action: "world-date" }),
    /Hospitals answer with everything they hold\.[\s\S]*<summary>Change the world's date<\/summary>[\s\S]*<form[^>]*action="world-date"[\s\S]*name="date"/,
  );
  assert.match(
    render(
      view.hospitalsPage({
        pod: "x",
        rows: [],
        text: "",
        search: "?h",
        signIn: () => "",
        people: [],
        back: "/",
        world: { asOf, action: "world-date" },
      }),
    ),
    /Hospitals answer as of 1 February 2024\./,
  );
  assert.doesNotMatch(
    render(
      view.podPage(
        {},
        { pod: "x", person, signIn: () => "", findHospital: "?h" },
      ),
    ),
    /Hospitals answer/,
  );
});
