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
// A build's functions, which no entry of the package exports.
import { pruneRows, withKeptRows } from "../src/node/rowCache.js";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Building the package fetches the rows of every reference table, about 200 MB. The build keeps them in a folder, each
 * file named by the SHA-256 of its bytes, and reads them from there the next time.
 */
describe("Row files kept between builds of the package", () => {
  describe("withKeptRows(fetch, folder)", () => {
    const bytes = new TextEncoder().encode("rows");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const url = `https://tables.example/rows/${hash}.nq.gz`;
    let folder: string;

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "rows-"));
    });

    after(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    /** A fetch that notes each address it is asked for. */
    const fetching = (): { live: typeof fetch; asked: string[] } => {
      const asked: string[] = [];
      const live: typeof fetch = async (input) => {
        asked.push(String(input));
        return new Response(bytes);
      };
      return { live, asked };
    };

    it("fetches a row file named by its content once, then reads it from the folder", async () => {
      const { live, asked } = fetching();
      const kept = withKeptRows(live, join(folder, "once"));
      await kept(url);
      const again = await kept(url);
      assert.deepEqual(asked, [url]);
      assert.deepEqual(new Uint8Array(await again.arrayBuffer()), bytes);
    });

    it("fetches anything else each time", async () => {
      const { live, asked } = fetching();
      const kept = withKeptRows(live, join(folder, "other"));
      await kept("https://tables.example/feed.ttl");
      await kept("https://tables.example/feed.ttl");
      assert.deepEqual(asked, [
        "https://tables.example/feed.ttl",
        "https://tables.example/feed.ttl",
      ]);
    });

    it("fetches a kept file again, and puts it right, when its bytes no longer hash to its name", async () => {
      const { live, asked } = fetching();
      const at = join(folder, "damaged");
      const kept = withKeptRows(live, at);
      await kept(url);
      await writeFile(join(at, `${hash}.nq.gz`), "damaged");
      await kept(url);
      assert.equal(asked.length, 2);
      assert.deepEqual(
        new Uint8Array(await readFile(join(at, `${hash}.nq.gz`))),
        bytes,
      );
    });

    it("returns what it fetched when the folder cannot be written", async () => {
      const blocked = join(folder, "regular-file");
      await writeFile(blocked, "not a folder");
      const answered = await withKeptRows(
        fetching().live,
        join(blocked, "rows"),
      )(url);
      assert.deepEqual(new Uint8Array(await answered.arrayBuffer()), bytes);
    });
  });

  describe("pruneRows(folder, now)", () => {
    const now = Date.now();
    const bytes = new TextEncoder().encode("read again");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const unread = `${"a".repeat(64)}.nq.gz`;
    const recent = `${"b".repeat(64)}.nq.gz`;
    const halfWritten = `${"c".repeat(64)}.nq.gz.1.tmp`;
    const justStarted = `${"d".repeat(64)}.nq.gz.2.tmp`;
    let folder: string;
    let kept: string[];

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "rows-"));
      const aged = async (name: string, age: number): Promise<void> => {
        await writeFile(
          join(folder, name),
          name === `${hash}.nq.gz` ? bytes : name,
        );
        const when = new Date(now - age);
        await utimes(join(folder, name), when, when);
      };
      await aged(unread, 31 * DAY);
      await aged(recent, 29 * DAY);
      await aged(`${hash}.nq.gz`, 31 * DAY);
      await aged(halfWritten, 2 * HOUR);
      await aged(justStarted, 60 * 1000);
      await aged("notes.nq.gz", 31 * DAY);
      await aged("someone-elses.tmp", 2 * HOUR);
      // A read touches the file it finds, which the live fetch is never asked for.
      const live: typeof fetch = async () => new Response("never asked");
      await withKeptRows(
        live,
        folder,
      )(`https://tables.example/rows/${hash}.nq.gz`);
      await pruneRows(folder, now + 1000);
      kept = (await readdir(folder)).sort();
    });

    after(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    it("drops a row file no read has touched for 30 days", () => {
      assert.ok(!kept.includes(unread), "a file unread for 31 days");
    });

    it("keeps a row file a read has touched within 30 days", () => {
      assert.ok(kept.includes(recent), "a file unread for 29 days");
    });

    it("keeps an old file that a read has just touched", () => {
      assert.ok(kept.includes(`${hash}.nq.gz`));
    });

    it("drops a half-written file an hour old, and keeps a newer one", () => {
      assert.ok(!kept.includes(halfWritten), "a file two hours old");
      assert.ok(kept.includes(justStarted), "a file a minute old");
    });

    it("keeps every file the build did not write", () => {
      assert.ok(kept.includes("notes.nq.gz"), "a row file named by no hash");
      assert.ok(
        kept.includes("someone-elses.tmp"),
        "a half-written file of another name",
      );
    });

    it("does nothing for a folder that does not exist", async () => {
      await assert.doesNotReject(pruneRows(join(folder, "absent"), now));
    });
  });
});
