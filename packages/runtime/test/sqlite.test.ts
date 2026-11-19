import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { DatabaseKeyRefused } from "../src/database.js";
import { readText } from "../src/files.js";
import { Refusal } from "../src/refusal.js";
import { databaseAt, openDatabase } from "../src/node/sqlite.js";
import { STATEMENTS_SCHEMA } from "../src/statements.js";
import { vocabulary } from "./vocabulary.js";

const KEY = new Uint8Array(32).fill(7);
const OTHER = new Uint8Array(32).fill(8);
const MARKER = "marker-in-the-clear";

/**
 * The runtime keeps a pod's answers in a SQLite database beside it. The core sees only a `Database` of prepared
 * statements; the opener makes one on a file, sealed with a key when it is given one.
 */
describe("Opening a pod's SQLite database · openDatabase()", () => {
  let folder: string;
  let sealed: string;
  let plain: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "sqlite-"));
    sealed = join(folder, "sealed.db");
    plain = join(folder, "plain.db");
  });

  it("opens in write-ahead mode with temporary tables in memory, and runs prepared statements and a transaction", () => {
    const db = openDatabase(plain);
    assert.equal(db.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(db.prepare("PRAGMA temp_store").get()?.temp_store, 2);
    db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT)");
    const put = db.prepare("INSERT INTO t (k, v) VALUES (?, ?)");
    db.transaction(() => {
      put.run(1, "a");
      put.run(2, "b");
    });
    const select = db.prepare("SELECT v FROM t WHERE k >= ? ORDER BY k");
    assert.deepEqual(select.all(1), [{ v: "a" }, { v: "b" }]);
    assert.deepEqual([...select.iterate(2)], [{ v: "b" }]);
    db.close();
  });

  it("keeps none of what a transaction wrote when its work throws, and throws what the work threw", () => {
    const db = openDatabase(join(folder, "rollback.db"));
    db.exec("CREATE TABLE t (v TEXT)");
    const thrown = new Error("the work failed");
    assert.throws(
      () =>
        db.transaction(() => {
          db.prepare("INSERT INTO t VALUES (?)").run("kept?");
          throw thrown;
        }),
      (error) => error === thrown,
    );
    assert.deepEqual(db.prepare("SELECT v FROM t").all(), []);
    db.close();
  });

  it("registers each function it is given on the connection, for SQL to call with any number of arguments", () => {
    const db = openDatabase(join(folder, "functions.db"), {
      functions: [
        {
          name: "twice",
          deterministic: true,
          apply: (...values) =>
            values.reduce<number>((sum, value) => sum + Number(value) * 2, 0),
        },
      ],
    });
    assert.deepEqual(
      db.prepare("SELECT twice(21) AS v, twice(20, 1) AS w").get(),
      { v: 42, w: 42 },
    );
    db.close();
  });

  it("seals the file, its write-ahead log and its shared memory with ChaCha20-Poly1305 under the key as it is, and reopens it with that key", async () => {
    const first = openDatabase(sealed, { key: KEY });
    const setting = (name: string) =>
      Object.values(first.prepare(`PRAGMA ${name}`).get() ?? {}).map(String);
    assert.deepEqual(setting("cipher"), ["chacha20"]);
    assert.deepEqual(setting("kdf_iter"), ["1"]);
    first.exec("CREATE TABLE t (v TEXT)");
    first.prepare("INSERT INTO t VALUES (?)").run(MARKER);
    const written = [sealed, `${sealed}-wal`, `${sealed}-shm`].filter((path) =>
      existsSync(path),
    );
    assert.ok(written.includes(`${sealed}-wal`));
    for (const path of written) {
      const bytes = (await readFile(path)).toString("latin1");
      assert.ok(!bytes.includes(MARKER), path);
    }
    first.close();

    const bytes = (await readFile(sealed)).toString("latin1");
    assert.ok(!bytes.includes(MARKER));
    assert.ok(!bytes.startsWith("SQLite format 3"));
    const again = openDatabase(sealed, { key: KEY });
    assert.deepEqual(again.prepare("SELECT v FROM t").all(), [{ v: MARKER }]);
    again.close();
  });

  it("throws DatabaseKeyRefused, no Refusal, carrying the engine's error, for a sealed file without its key or with another, and for a plain file given a key", () => {
    openDatabase(plain).close();
    for (const [name, path, key] of [
      ["another key", sealed, OTHER],
      ["no key", sealed, undefined],
      ["a key for a plain file", plain, KEY],
    ] as const) {
      assert.throws(
        () => openDatabase(path, key === undefined ? {} : { key }),
        (error) =>
          error instanceof DatabaseKeyRefused &&
          !(error instanceof Refusal) &&
          error.cause instanceof Error,
        name,
      );
    }
  });

  it("refuses a key that is not 32 bytes", () => {
    assert.throws(
      () => openDatabase(join(folder, "short.db"), { key: new Uint8Array(16) }),
      /32 bytes/,
    );
  });
});

/** A store's dump as Oxigraph writes it, of `graphs` graphs each of `each` statements; `broken`, its last line is none. */
function dumpOf(graphs: number, each: number, broken = false): Uint8Array {
  const lines = ["# a dump"];
  for (let g = 0; g < graphs; g++) {
    lines.push(`<urn:x:graph-${g}> {`);
    for (let s = 0; s < each; s++)
      lines.push(
        `<urn:x:s-${g}-${s % 8}> <urn:x:p-${s % 40}> "value ${g} ${s}" .`,
      );
    lines.push("}");
  }
  if (broken) lines.splice(lines.length - 1, 0, "not a statement .");
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

const GRAPHS = 200;
const EACH = 200;
const graphsOf = (count: number): string[] =>
  Array.from({ length: count }, (_, g) => `urn:x:graph-${g}`);

/**
 * A pod's database is built whole from a store's dump when it names no build of the pod's files. The build is long for a
 * large pod, so it runs on a thread of its own, into a file of its own put in place once the build is whole.
 */
describe("Building a pod's database whole beside it · databaseAt()", () => {
  let folder: string;
  let schema: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "beside-"));
    schema = await readText(await vocabulary(), STATEMENTS_SCHEMA);
  });

  it("builds it on another thread, sealed under the key, and puts it in place: the event loop never waits half as long as the build", async () => {
    const path = join(folder, "sealed", "ab", "pod");
    const beside = databaseAt(path);
    let last = performance.now();
    let longest = 0;
    const ticks = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 1);
    const started = performance.now();
    let took: number;
    try {
      await beside.builtWhole({
        schema,
        views: [],
        dump: dumpOf(GRAPHS, EACH),
        graphs: graphsOf(GRAPHS),
        fingerprint: "built",
        key: KEY,
      });
      took = performance.now() - started;
      // A tick held up by work that ended the build fires only once the timers run again.
      await new Promise((tick) => setTimeout(tick, 5));
    } finally {
      clearInterval(ticks);
    }
    assert.ok(
      longest < took / 2,
      `the event loop waited ${Math.round(longest)} ms at once in a build of ${Math.round(took)} ms`,
    );
    assert.equal(existsSync(`${path}-build`), false);
    const db = beside.open({ key: KEY, functions: [] });
    try {
      assert.equal(
        Number(db.prepare("SELECT count(*) AS n FROM quad").get()?.n),
        GRAPHS * EACH,
      );
      assert.equal(
        db.prepare("SELECT fingerprint FROM ledger").get()?.fingerprint,
        "built",
      );
    } finally {
      db.close();
    }
  });

  it("leaves the database it had in place, and no file of the build, when the build fails part way", async () => {
    const path = join(folder, "kept.db");
    const beside = databaseAt(path);
    await beside.builtWhole({
      schema,
      views: [],
      dump: dumpOf(2, 3),
      graphs: graphsOf(2),
      fingerprint: "before",
    });
    await assert.rejects(
      beside.builtWhole({
        schema,
        views: [],
        dump: dumpOf(2, 3, true),
        graphs: graphsOf(2),
        fingerprint: "after",
      }),
      /no N-Triples statement/,
    );
    assert.equal(existsSync(`${path}-build`), false);
    const db = beside.open({ functions: [] });
    try {
      assert.equal(
        db.prepare("SELECT fingerprint FROM ledger").get()?.fingerprint,
        "before",
      );
    } finally {
      db.close();
    }
  });
});
