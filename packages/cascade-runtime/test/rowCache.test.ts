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
import { test } from "node:test";
import { keptRows, prunedRows } from "../src/node/rowCache.js";

test("a row file named by its content is fetched once and then read from the folder, unless its bytes no longer hash to its name", async () => {
  const folder = await mkdtemp(join(tmpdir(), "rows-"));
  try {
    const bytes = new TextEncoder().encode("rows");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const url = `https://tables.example/rows/${hash}.nq.gz`;
    const asked: string[] = [];
    const live: typeof fetch = async (input) => {
      asked.push(String(input));
      return new Response(bytes);
    };
    const fetching = keptRows(live, folder);
    await fetching(url);
    const again = await fetching(url);
    assert.deepEqual(new Uint8Array(await again.arrayBuffer()), bytes);
    await fetching("https://tables.example/feed.ttl");
    await fetching("https://tables.example/feed.ttl");
    assert.deepEqual(asked, [
      url,
      "https://tables.example/feed.ttl",
      "https://tables.example/feed.ttl",
    ]);
    await writeFile(join(folder, `${hash}.nq.gz`), "damaged");
    await fetching(url);
    assert.equal(asked.length, 4);
    assert.deepEqual(
      new Uint8Array(await readFile(join(folder, `${hash}.nq.gz`))),
      bytes,
    );
    const blocked = join(folder, "regular-file");
    await writeFile(blocked, "not a folder");
    const unkept = keptRows(live, join(blocked, "rows"));
    const answered = await unkept(url);
    assert.deepEqual(new Uint8Array(await answered.arrayBuffer()), bytes);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("pruning the folder drops a row file unread for 30 days and a half-written file an hour old, and keeps what a read touched", async () => {
  const folder = await mkdtemp(join(tmpdir(), "rows-"));
  try {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const bytes = new TextEncoder().encode("read again");
    const hash = createHash("sha256").update(bytes).digest("hex");
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
    const live: typeof fetch = async () => new Response("never asked");
    await keptRows(live, folder)(`https://tables.example/rows/${hash}.nq.gz`);
    await prunedRows(folder, now + 1000);
    assert.deepEqual(
      (await readdir(folder)).sort(),
      [
        `${"b".repeat(64)}.nq.gz`,
        `${"d".repeat(64)}.nq.gz.2.tmp`,
        `${hash}.nq.gz`,
      ].sort(),
    );
    await prunedRows(join(folder, "absent"), now);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
