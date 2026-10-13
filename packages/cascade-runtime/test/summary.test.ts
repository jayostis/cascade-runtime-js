import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "preact-render-to-string";

const view = await import(
  new URL("../../starter/summary.mjs", import.meta.url).href
);

const ALLERGIES = "pod/My active allergies";
const CONDITIONS = "pod/My active conditions";
const LABS = "pod/My lab results";
const MEDICATIONS = "pod/My active medications";
const SEEN = "pod/What was seen more than once";
const REVIEW = "entry/What needs review";

test("what Cascade noticed: things seen at two places first, three at most, then what needs review", () => {
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
  assert.deepEqual(view.noticed(answers), [
    "Penicillin was recorded at Meridian Health System, Larkspur Valley Health and in Alex's own entries. Cascade keeps it as one allergy.",
    "Asthma arrived more than once from Cascade North. Cascade keeps it as one condition.",
    "Eczema arrived more than once from Larkspur Valley Health. Cascade keeps it as one condition.",
    "1 more thing was seen more than once and kept as one.",
    "Sources disagree on how severe the Sulfamethoxazole allergy is.",
    "Asthma was matched in two different ways. Worth a look.",
    "Eczema was marked as different, but is still shown as one condition.",
    "Latex was marked as different, but is still shown as one allergy.",
    "Sources disagree on how severe an unnamed allergy is.",
    "An entry was marked as different, but is still shown as one entry.",
    "Migraine was recorded more than once, and its dates cannot tell whether it is one condition or several.",
    "Acute viral pharyngitis was kept as one condition with another before; newer reference tables or rules no longer match them, so they are shown apart. Worth a look.",
    "An unnamed allergy was kept as one allergy with another before; newer reference tables or rules no longer match them, so they are shown apart. Worth a look.",
    "Lisinopril 10 MG Oral Tablet shares a code with Zestril, which Cascade keeps apart. Cascade cannot confirm that the shared code names one product, so they may or may not be the same. Worth a look.",
    "Lisinopril 10 MG Oral Tablet shares a code with another medication, which Cascade keeps apart. Cascade cannot confirm that the shared code names one product, so they may or may not be the same. Worth a look.",
    "An unnamed medication shares a code with another medication, which Cascade keeps apart. Cascade cannot confirm that the shared code names one product, so they may or may not be the same. Worth a look.",
  ]);
});

test("what Cascade noticed: two medications in two entries whose codes share an ingredient are shown apart, once for each pair in the order of the section even when an entry's rows are not adjacent, a combination of one MIN said as a combination, and one entry's own rows, a medication with no code or two entries that share a code give nothing, since What needs review lists those", () => {
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
  assert.deepEqual(
    view.noticed(
      answers(
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
      ),
      about,
    ),
    [
      "Amlodipine 5 MG Oral Tablet and Norvasc 10 MG Oral Tablet share an ingredient, amlodipine, and are shown apart. Worth a look.",
      "Amlodipine 5 MG Oral Tablet and Combined share an ingredient, amlodipine, and are shown apart. Worth a look.",
      "Norvasc 10 MG Oral Tablet and Combined share an ingredient, amlodipine, and are shown apart. Worth a look.",
      "Pain relief and Combined share an ingredient, 5640, and are shown apart. Worth a look.",
      "Zestoretic and Prinzide share the combination, hydrochlorothiazide / lisinopril, and are shown apart. Worth a look.",
    ],
  );
  assert.deepEqual(
    view.noticed(
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
      about,
    ),
    [
      "Amlodipine 5 MG Oral Tablet and Bmlodipine share an ingredient, amlodipine, and are shown apart. Worth a look.",
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

test("a pod's page names a row by the first of its codes the tables name, else by the record's own text, and says when a code is retired", () => {
  const CVX = "urn:test:cvx/";
  const ICD = "urn:test:icd/";
  const SCT = "urn:test:sct/";
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
    [CONDITIONS]: [
      {
        entry: "c1",
        condition: "Asthma",
        snomed: `${SCT}195967001`,
        icd10: `${ICD}J45.909`,
      },
    ],
    [SEEN]: [
      { entry: "i1", place: "Cascade North", records: "2", places: "1" },
    ],
  };
  const about = new Map<string, object>([
    [`${CVX}141`, name("flu, split")],
    [`${CVX}57`, { ...name("hantavirus"), ...retired() }],
    [`${CVX}15`, retired(`${CVX}141`, `${CVX}150`)],
    [`${SCT}195967001`, { ...name("Asthma (disorder)"), ...retired() }],
    [`${ICD}J45.909`, name("Unspecified asthma, uncomplicated")],
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
    "Retired code, replaced by 141 and 150",
    "Unlisted",
    "Unspecified asthma, uncomplicated",
    "Flu, split arrived more than once from Cascade North. Cascade keeps it as one immunization.",
  ])
    assert.ok(named.includes(shown), shown);
  for (const hidden of ["Fluarix", "Hantavax", "Asthma (disorder)"])
    assert.ok(!named.includes(hidden), hidden);
  assert.equal(
    named.filter((line: string) => line.startsWith("Retired code")).length,
    2,
    "only the codes that named a row, or with none the first with a status, mark it",
  );
  const unnamed = words();
  for (const shown of ["Fluarix", "Hantavax", "Asthma"])
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
    },
    { sentence: string; tag?: string }[],
    string | undefined,
  ][] = [
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
          tag: "Differs from ClinVar today",
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
    });
    assert.deepEqual(said, { reports, clinvar }, name);
  }
});

test("a pod's page shows its variants after the tiles, each with its reports and what ClinVar says, then the counsellor sentence and the series' credit; a pod with none shows no such part, and a variant seen at two places is named by its gene and expression", () => {
  const answers = {
    [ALLERGIES]: [{ entry: "e1", allergen: "Penicillin" }],
    [VARIANTS]: [
      { variant: "v1", gene: "MLH1", hgvs: "NM_000249.3:c.2042C>T" },
      { variant: "v1", gene: "MLH1", hgvs: "NM_000249.4:c.2042C>T" },
      { variant: "v1", gene: "MLH1", variation: "90011" },
    ],
    [REPORTS]: [
      report("r1", "VUS", "2022-05-01"),
      { ...report("r2", "Benign", "2023-01-01"), variant: "orphan" },
    ],
    [SEEN]: [
      {
        entry: "v1",
        place: "Meridian Health System",
        records: "1",
        places: "2",
      },
      {
        entry: "v1",
        place: "Larkspur Valley Health",
        records: "1",
        places: "2",
      },
    ],
  };
  assert.deepEqual(
    [...view.variantsAsked(answers)],
    [
      [
        "v1",
        {
          gene: "MLH1",
          hgvs: ["NM_000249.3:c.2042C>T", "NM_000249.4:c.2042C>T"],
          variations: ["90011"],
        },
      ],
    ],
  );
  const credit =
    "ClinVar, NCBI. Not intended for direct diagnostic use or medical decision-making without review by a genetics professional.";
  const shown = render(
    view.podPage(answers, {
      pod: "martin",
      signIn: () => "",
      said: {
        says: new Map([
          ["v1", rows({ classification: [concept("Pathogenic")] })],
        ]),
        verdicts: [verdict("r1", "differs")],
        labels: LABELS,
        credits: [credit],
      },
    }),
  );
  const words = shown.replace(/<[^>]*>/g, "");
  for (const sentence of [
    "Genetic variants",
    "MLH1 · NM_000249.3:c.2042C>T · NM_000249.4:c.2042C>T · ClinVar 90011",
    "Your 2022 report said uncertain significance.",
    "Differs from ClinVar today",
    "ClinVar today says pathogenic.",
    "Your 2023 report said benign.",
    "Your clinician or a genetic counsellor can explain what this means for you.",
    "Not intended for direct diagnostic use or medical decision-making without review by a genetics professional",
    "MLH1 NM_000249.3:c.2042C>T was recorded at Meridian Health System and Larkspur Valley Health. Cascade keeps it as one variant.",
  ])
    assert.ok(words.includes(sentence), sentence);
  assert.ok(shown.indexOf("Genetic variants") > shown.indexOf('class="tiles"'));
  assert.ok(
    shown.indexOf("Your 2023 report") > shown.indexOf("ClinVar today says"),
    "a report of no variant entry is listed last",
  );
  const bare = render(
    view.podPage(
      { [ALLERGIES]: answers[ALLERGIES] },
      { pod: "martin", signIn: () => "" },
    ),
  );
  assert.ok(!bare.includes("Genetic variants") && !bare.includes("counsellor"));
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
  assert.deepEqual(entry.tags, ["Retired code, replaced by 195967002"]);
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
    "Asthma (disorder) Retired code, replaced by 195967002",
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
  assert.deepEqual(entry.known, [
    {
      sentence:
        "Latex was marked as different, but is still shown as one allergy.",
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

test("what the tables say of the codes a pod holds includes the ingredients those codes map to, and an ingredient the tables cannot say is left as it is", async () => {
  const RX = "urn:test:rxnorm/";
  const answers = {
    "pod/My active medications": [
      { entry: "m1", medication: "Lisinopril", code: `${RX}314076` },
    ],
  };
  const asked: string[][] = [];
  const tables = (fails: boolean) => ({
    about: async (codes: string[]) => {
      asked.push(codes);
      if (asked.length === 2 && fails) throw new Error("no ingredients");
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
  const about = await view.codesSaid(answers, { tables: tables(false) });
  assert.deepEqual(asked, [[`${RX}314076`], [`${RX}29046`]]);
  assert.equal(about.get(`${RX}29046`).name.label, "lisinopril");
  asked.length = 0;
  const partial = await view.codesSaid(answers, { tables: tables(true) });
  assert.deepEqual([...partial.keys()], [`${RX}314076`]);
});
