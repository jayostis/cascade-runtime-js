import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "preact-render-to-string";

const view = await import(
  new URL("../../starter/summary.mjs", import.meta.url).href
);

const ALLERGIES = "pod/My active allergies";
const CONDITIONS = "pod/My active conditions";
const LABS = "pod/My lab results";
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
  ]);
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
          [ALLERGIES]: [{ entry: "e1", allergen: "Penicillin" }],
          [LABS]: [{ entry: "e2", test: "Glucose" }],
        },
        {
          pod: "alex-rivera",
          signIn: () => "",
          findHospital: "?hospitals",
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
  const CVX = "http://hl7.org/fhir/sid/cvx/";
  const ICD = "http://hl7.org/fhir/sid/icd-10-cm/";
  const SCT = "http://snomed.info/sct/";
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
