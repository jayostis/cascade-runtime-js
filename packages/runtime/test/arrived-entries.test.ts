import assert from "node:assert/strict";
import { test } from "node:test";
import { ArrivedEntries, type TakenRecord } from "../src/matcher.js";
import { byCodePoint } from "../src/names.js";

const SEEDS = Number(process.env["CASCADE_RANDOM_SEEDS"] ?? 8);
const FIRST_SEED = Number(process.env["CASCADE_RANDOM_FIRST_SEED"] ?? 1);

/** Mulberry32: the same seed draws the same Sames. */
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

const pair = (one: string, other: string) => `${one} ${other}`;

function arrivedBefore(a: TakenRecord, b: TakenRecord): boolean {
  const [x, y] = [
    [...a.arrived, a.name],
    [...b.arrived, b.name],
  ];
  for (let at = 0; at < x.length; at++)
    if (x[at] !== y[at]) return (x[at] ?? "") < (y[at] ?? "");
  return false;
}

/** The entries as star() found them before a run kept them: every Same, each time, but those holding a member read that arrived with the record or after. */
function fromScratch(
  records: ReadonlyMap<string, TakenRecord>,
  different: ReadonlySet<string>,
  sames: readonly (readonly string[])[],
  record: TakenRecord,
): (name: string) => string {
  const parent = new Map<string, string>();
  const root = (name: string): string => {
    let at = name;
    for (
      let up = parent.get(at);
      up !== undefined && up !== at;
      up = parent.get(at)
    )
      at = up;
    parent.set(name, at);
    return at;
  };
  const later = (name: string): boolean => {
    const other = records.get(name);
    return other !== undefined && !arrivedBefore(other, record);
  };
  for (const members of sames) {
    if (members.some(later)) continue;
    const split = members.some((one) =>
      members.some((other) => different.has(pair(one, other))),
    );
    const [least = ""] = [...members].sort(byCodePoint);
    for (const one of members)
      for (const other of split ? members : [least])
        if (one !== other && !different.has(pair(one, other)))
          parent.set(root(one), root(other));
  }
  return root;
}

/** Each name with the least name of its entry. */
function partition(
  names: readonly string[],
  root: (name: string) => string,
): Map<string, string> {
  const least = new Map<string, string>();
  for (const name of names) {
    const was = least.get(root(name));
    if (was === undefined || byCodePoint(name, was) < 0)
      least.set(root(name), name);
  }
  return new Map(names.map((name) => [name, least.get(root(name)) ?? ""]));
}

test("the kept entries equal those found from scratch, records asked in any order, Sames filed between and Differents splitting", () => {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
    const draw = random(seed);
    const pick = <T>(all: readonly T[]): T =>
      all[Math.floor(draw() * all.length)] as T;
    const names = Array.from(
      { length: 60 },
      (_, at) =>
        `urn:uuid:${seed}-${String(Math.floor(draw() * 1e6)).padStart(6, "0")}-${at}`,
    );
    const records = new Map<string, TakenRecord>();
    for (const name of names.slice(0, 50))
      records.set(name, {
        name,
        classes: new Set(),
        version: `${name}-version`,
        arrived: [
          `2026-01-${String(1 + Math.floor(draw() * 28)).padStart(2, "0")}T00:00:00`,
          draw() < 0.2 ? "5" : "",
        ],
        activities: [],
        revisedBy: [],
      });
    const taken = [...records.values()];
    const different = new Set<string>();
    for (let k = 0; k < 15; k++) {
      const [one, other] = [pick(names), pick(names)];
      if (one !== other) different.add(pair(one, other)).add(pair(other, one));
    }
    const drawSame = (): string[] => [
      ...new Set(
        Array.from({ length: 2 + Math.floor(draw() * 4) }, () => pick(names)),
      ),
    ];
    const sames = Array.from({ length: 30 }, drawSame);
    for (const [one, other] of sames)
      if (other !== undefined && draw() < 0.4)
        different.add(pair(one ?? "", other)).add(pair(other, one ?? ""));
    const kept = new ArrivedEntries(records, different, sames);
    const counted = [...sames];
    let asked: TakenRecord | undefined;
    for (let step = 0; step < 120; step++) {
      if (draw() < 0.3) {
        const members =
          asked !== undefined && draw() < 0.5
            ? [
                ...new Set([
                  ...taken
                    .filter((one) => arrivedBefore(one, asked as TakenRecord))
                    .map(({ name }) => name)
                    .slice(0, 3),
                  pick(names),
                ]),
              ]
            : drawSame();
        kept.add(members);
        counted.push(members);
        continue;
      }
      asked =
        draw() < 0.7 && asked !== undefined
          ? (taken.filter(
              (one) => !arrivedBefore(one, asked as TakenRecord),
            )[0] ?? pick(taken))
          : pick(taken);
      assert.deepEqual(
        partition(names, kept.before(asked)),
        partition(names, fromScratch(records, different, counted, asked)),
        `seed ${seed} step ${step}`,
      );
    }
  }
});
