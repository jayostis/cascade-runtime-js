import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadHospital } from "@cascade-runtime/demo-hospital/node";
import { searchDirectory, TEST_DIRECTORY } from "cascade-runtime";
import { launcherSettings } from "./launcher-settings.js";

const DATA = fileURLToPath(
  new URL(
    "../../../data/",
    import.meta.resolve("@cascade-runtime/demo-hospital/node"),
  ),
);

test("the test directory's demo rows are the demo hospitals, every one of them", async () => {
  const demo = TEST_DIRECTORY.filter(({ vendor }) => vendor === "demo");
  const folders = (await readdir(DATA, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const hospitals = await Promise.all(
    folders.map(async (folder) => (await loadHospital(folder)).hospital),
  );
  assert.deepEqual(
    demo
      .map(({ name, fhirBase }) => ({ name, fhirBase }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    hospitals
      .map(({ name, fhirBase }) => ({ name, fhirBase }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
});

test("the launcher's row asks for a patient's own login and approval, with PKCE, as a public client", () => {
  const row = TEST_DIRECTORY.find(({ vendor }) => vendor === "smart-launcher");
  assert.ok(row);
  const { launchType, patient, skipLogin, skipAuth, clientType, pkce } =
    launcherSettings(row.fhirBase);
  assert.deepEqual(
    { launchType, patient, skipLogin, skipAuth, clientType, pkce },
    {
      launchType: 3,
      patient: "",
      skipLogin: 0,
      skipAuth: 0,
      clientType: 0,
      pkce: 2,
    },
  );
});

test("a search of the directory gives the rows whose name or places hold a word beginning with each word given", () => {
  const cases: [string, string[]][] = [
    [
      "",
      [
        "Cascade North Demo Hospital",
        "Cascade South Demo Hospital",
        "SMART Health IT Sandbox",
      ],
    ],
    [
      "   ",
      [
        "Cascade North Demo Hospital",
        "Cascade South Demo Hospital",
        "SMART Health IT Sandbox",
      ],
    ],
    ["north", ["Cascade North Demo Hospital"]],
    ["cascade", ["Cascade North Demo Hospital", "Cascade South Demo Hospital"]],
    ["CASCADE south", ["Cascade South Demo Hospital"]],
    ["bellingham", ["Cascade North Demo Hospital"]],
    ["olym", ["Cascade South Demo Hospital"]],
    ["mount vern", ["Cascade North Demo Hospital"]],
    ["mount m", ["Cascade North Demo Hospital"]],
    ["Olýmpia", ["Cascade South Demo Hospital"]],
    ["smart", ["SMART Health IT Sandbox"]],
    ["orth", []],
    ["seattle", []],
  ];
  for (const [text, names] of cases)
    assert.deepEqual(
      searchDirectory(TEST_DIRECTORY, text).map(({ name }) => name),
      names,
      text,
    );
});
