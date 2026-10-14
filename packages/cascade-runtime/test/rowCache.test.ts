import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keptRows } from "../src/node/rowCache.js";

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
