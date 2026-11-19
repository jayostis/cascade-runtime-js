import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { DatabaseKeyRefused } from "../src/database.js";
import { Refusal } from "../src/refusal.js";
import { openDatabase } from "../src/node/sqlite.js";

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

  it("registers each function it is given on the connection, for SQL to call", () => {
    const db = openDatabase(join(folder, "functions.db"), {
      functions: [
        {
          name: "twice",
          deterministic: true,
          apply: (value) => Number(value) * 2,
        },
      ],
    });
    assert.deepEqual(db.prepare("SELECT twice(21) AS v").get(), { v: 42 });
    db.close();
  });

  it("seals the file, its write-ahead log and its shared memory with ChaCha20-Poly1305 under the key as it is, and reopens it with that key", async () => {
    const first = openDatabase(sealed, { key: KEY });
    assert.equal(first.prepare("PRAGMA cipher").get()?.cipher, "chacha20");
    assert.equal(first.prepare("PRAGMA kdf_iter").get()?.kdf_iter, 1);
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

  it("throws DatabaseKeyRefused, a Refusal carrying the engine's error, for a sealed file without its key or with another, and for a plain file given a key", () => {
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
          error instanceof Refusal &&
          error.cause instanceof Error,
        name,
      );
    }
  });

  it("refuses a key that is not 32 bytes", () => {
    assert.throws(
      () =>
        openDatabase(join(folder, "short.db"), { key: new Uint8Array(16) }),
      /32 bytes/,
    );
  });
});
