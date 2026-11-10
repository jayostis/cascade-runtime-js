import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { keptRows, prunedRows } from "../src/node/rowCache.js";

describe("keptRows", () => {
  let folder: string;
  let bytes: Uint8Array<ArrayBuffer>;
  let hash: string;
  let url: string;
  let asked: string[];
  let live: typeof fetch;
  let fetching: typeof fetch;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "rows-"));
    bytes = new TextEncoder().encode("rows");
    hash = createHash("sha256").update(bytes).digest("hex");
    url = `https://tables.example/rows/${hash}.nq.gz`;
    asked = [];
    live = async (input) => {
      asked.push(String(input));
      return new Response(bytes);
    };
    fetching = keptRows(live, folder);
  });

  after(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  describe("given a row file named by its content", () => {
    it("fetches it once, then reads it from the folder", async () => {
      await fetching(url);
      const again = await fetching(url);
      assert.deepEqual(new Uint8Array(await again.arrayBuffer()), bytes);
      assert.deepEqual(asked, [url]);
    });

    it("fetches it again when its bytes no longer hash to its name", async () => {
      await writeFile(join(folder, `${hash}.nq.gz`), "damaged");
      await fetching(url);
      assert.equal(asked.length, 2);
      assert.deepEqual(
        new Uint8Array(await readFile(join(folder, `${hash}.nq.gz`))),
        bytes,
      );
    });

    it("still answers when the folder cannot be written", async () => {
      const blocked = join(folder, "regular-file");
      await writeFile(blocked, "not a folder");
      const unkept = keptRows(live, join(blocked, "rows"));
      const answered = await unkept(url);
      assert.deepEqual(new Uint8Array(await answered.arrayBuffer()), bytes);
    });
  });

  describe("given a file not named by its content", () => {
    it("fetches it every time", async () => {
      asked.length = 0;
      await fetching("https://tables.example/feed.ttl");
      await fetching("https://tables.example/feed.ttl");
      assert.deepEqual(asked, [
        "https://tables.example/feed.ttl",
        "https://tables.example/feed.ttl",
      ]);
    });
  });
});

describe("prunedRows", () => {
  let folder: string;
  let now: number;
  let hash: string;
  let left: string[];

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "rows-"));
    now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const bytes = new TextEncoder().encode("read again");
    hash = createHash("sha256").update(bytes).digest("hex");
    const aged = async (name: string, age: number): Promise<void> => {
      await writeFile(
        join(folder, name),
        name === `${hash}.nq.gz` ? bytes : name,
      );
      const when = new Date(now - age);
      await utimes(join(folder, name), when, when);
    };
    await aged(`${"a".repeat(64)}.nq.gz`, 31 * day);
    await aged(`${"b".repeat(64)}.nq.gz`, 29 * day);
    await aged(`${hash}.nq.gz`, 31 * day);
    await aged(`${"c".repeat(64)}.nq.gz.1.tmp`, 2 * 60 * 60 * 1000);
    await aged(`${"d".repeat(64)}.nq.gz.2.tmp`, 60 * 1000);
    await aged("notes.nq.gz", 31 * day);
    await aged("someone-elses.tmp", 2 * 60 * 60 * 1000);
    const live: typeof fetch = async () => new Response("never asked");
    await keptRows(live, folder)(`https://tables.example/rows/${hash}.nq.gz`);
    await prunedRows(folder, now + 1000);
    left = (await readdir(folder)).sort();
  });

  after(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("drops stale files, keeps those read lately or not its own", () => {
    assert.deepEqual(
      left,
      [
        `${"b".repeat(64)}.nq.gz`,
        `${"d".repeat(64)}.nq.gz.2.tmp`,
        `${hash}.nq.gz`,
        "notes.nq.gz",
        "someone-elses.tmp",
      ].sort(),
    );
  });

  it("does nothing for a folder that is not there", async () => {
    await prunedRows(join(folder, "absent"), now);
  });
});
