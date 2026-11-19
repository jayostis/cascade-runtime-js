import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { openDatabase } from "../src/node/sqlite.js";

const KEY = new Uint8Array(32).fill(7);
const OTHER = new Uint8Array(32).fill(8);

/**
 * The runtime keeps a pod's answers in a SQLite database beside it. The core sees only a `Database` of prepared
 * statements; the opener makes one on a file, sealed with a key when it is given one.
 */
describe("Opening a pod's SQLite database · openDatabase()", () => {
  let folder: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "sqlite-"));
  });

  it("opens in write-ahead mode with temporary tables in memory, and runs prepared statements and a transaction", () => {
    const db = openDatabase(join(folder, "plain.db"));
    assert.equal(db.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(db.prepare("PRAGMA temp_store").get()?.temp_store, 2);
    db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT)");
    const put = db.prepare("INSERT INTO t (k, v) VALUES (?, ?)");
    db.transaction(() => {
      put.run(1, "a");
      put.run(2, "b");
    });
    assert.deepEqual(
      db.prepare("SELECT v FROM t WHERE k >= ? ORDER BY k").all(1),
      [{ v: "a" }, { v: "b" }],
    );
    db.close();
  });

  it("reopens an encrypted database with its key, refuses another key, and leaves no plaintext on disk", async () => {
    const path = join(folder, "sealed.db");
    const first = openDatabase(path, KEY);
    first.exec("CREATE TABLE t (v TEXT)");
    first.prepare("INSERT INTO t VALUES (?)").run("marker-in-the-clear");
    first.close();

    const again = openDatabase(path, KEY);
    assert.deepEqual(again.prepare("SELECT v FROM t").all(), [
      { v: "marker-in-the-clear" },
    ]);
    again.close();

    assert.throws(() => openDatabase(path, OTHER));
    assert.throws(() => openDatabase(path));

    const bytes = (await readFile(path)).toString("latin1");
    assert.ok(!bytes.includes("marker-in-the-clear"));
    assert.ok(!bytes.startsWith("SQLite format 3"));
  });

  it("refuses a key that is not 32 bytes", () => {
    assert.throws(
      () => openDatabase(join(folder, "short.db"), new Uint8Array(16)),
      /32 bytes/,
    );
  });
});
