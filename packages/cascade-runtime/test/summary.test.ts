import assert from "node:assert/strict";
import { test } from "node:test";

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

test("a pod's page with a connection holds its tiles and the connection's box; every box's first link, outside the box, closes it", () => {
  const back = "/pods/alex-rivera/";
  const page = [
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
    view.newPodDialog({ people: [], pods: [], action: "make" }),
  ].join("\n");
  assert.equal((page.match(/<a class="tile"/g) ?? []).length, 2);
  const boxes = page.split('<div class="dialog"').slice(1);
  assert.equal(boxes.length, 4);
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

test("Escape follows the open box's own close link, and with none clears the hash", () => {
  const press = (close?: { click: () => void }): string => {
    let keydown = (_event: object): void => {};
    const location = { hash: "#connection" };
    const page = {
      defaultView: { location },
      addEventListener: (type: string, listener: typeof keydown) => {
        if (type === "keydown") keydown = listener;
      },
      querySelector: () => close ?? null,
    };
    view.sortAndFilter(page);
    keydown({ key: "Escape" });
    return location.hash;
  };
  let clicked = 0;
  assert.equal(press({ click: () => (clicked += 1) }), "#connection");
  assert.equal(clicked, 1);
  assert.equal(press(), "");
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
