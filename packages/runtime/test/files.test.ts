import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { ExportedFiles, folderOf, MemoryFiles } from "../src/files.js";
import {
  type FolderPack,
  packFolder,
  unpackFolder,
} from "../src/folder-pack.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { FetchedFiles } from "../src/web/fetched-files.js";
import { got, type Kept, kept } from "./kept.js";

const POD = "https://pod.example/";
const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes && new TextDecoder().decode(bytes);
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

/**
 * The runtime reaches everything it reads or writes, a pod, the vocabulary, an export, through `Files`: bytes by a path
 * under one root, or by the IRI that path has. The same calls work over memory, over a folder on disk and over the files
 * an app holds, and none reaches outside its root.
 */
describe("Reading and writing files by path · Files, MemoryFiles, FolderFiles, ExportedFiles", () => {
  /**
   * Each leaf runs over both kinds, naming the kind in the message. Each holds `subject/7c/a.ttl`, written by path,
   * `records/b.ttl`, written by IRI, and `records/long.ttl` (`0123456789`); no leaf writes a file.
   */
  describe("given files in memory, and given a folder on disk", () => {
    let folder: string;
    let kinds: [string, MemoryFiles | FolderFiles][];

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "files-"));
      kinds = [
        ["memory", new MemoryFiles(POD)],
        ["folder", new FolderFiles(folder, POD)],
      ];
      for (const [, files] of kinds) {
        await files.write("subject/7c/a.ttl", bytes("a"));
        await files.write(`${POD}records/b.ttl`, bytes("b"));
        await files.write("records/long.ttl", bytes("0123456789"));
      }
    });

    after(() => rm(folder, { recursive: true, force: true }));

    it("reads what was written, by its path and by its IRI", async () => {
      for (const [kind, files] of kinds) {
        assert.equal(
          text(await files.read(`${POD}subject/7c/a.ttl`)),
          "a",
          kind,
        );
        assert.equal(text(await files.read("records/b.ttl")), "b", kind);
      }
    });

    it("returns undefined for a file that is not there, for a folder, and for a path below a file", async () => {
      for (const [kind, files] of kinds) {
        for (const nothing of [
          "records/none.ttl",
          "records/b.ttl/export.xml",
          "records",
        ])
          assert.equal(
            await files.read(nothing),
            undefined,
            `${kind} ${nothing}`,
          );
        assert.equal(
          await files.readRange("records/none.ttl", 0, 1),
          undefined,
          kind,
        );
      }
    });

    it("lists the files under a folder by path, in order, and none for a file or for a folder that is not there", async () => {
      for (const [kind, files] of kinds) {
        assert.deepEqual(
          await files.list(""),
          ["records/b.ttl", "records/long.ttl", "subject/7c/a.ttl"],
          kind,
        );
        assert.deepEqual(
          await files.list("subject"),
          ["subject/7c/a.ttl"],
          kind,
        );
        assert.deepEqual(await files.list("records/b.ttl"), [], kind);
        assert.deepEqual(await files.list("nowhere"), [], kind);
      }
    });

    it("returns from `readRange()` the bytes asked for, counted from the end for a negative start, and never more than the file holds", async () => {
      for (const [kind, files] of kinds)
        for (const [start, length, expected] of [
          [0, 3, "012"],
          [-2, 2, "89"],
          [-20, 3, "012"],
          [8, 5, "89"],
          [10, 5, ""],
        ] as const)
          assert.equal(
            text(await files.readRange("records/long.ttl", start, length)),
            expected,
            `${kind} ${start} ${length}`,
          );
    });

    it("rejects a read of a path outside its root", async () => {
      for (const [kind, files] of kinds)
        for (const outside of [
          "https://elsewhere.example/a.ttl",
          "../a.ttl",
          "/a.ttl",
        ])
          await assert.rejects(
            files.read(outside),
            /is not a path under/,
            `${kind} ${outside}`,
          );
    });

    it("rejects a write, a `list()` and a ranged read outside its root", async () => {
      for (const [kind, files] of kinds) {
        await assert.rejects(
          files.write("../a.ttl", bytes("x")),
          /is not a path under/,
          `${kind} write`,
        );
        await assert.rejects(
          files.list(".."),
          /is not a path under/,
          `${kind} list`,
        );
        await assert.rejects(
          files.readRange("../a.ttl", 0, 1),
          /is not a path under/,
          `${kind} readRange`,
        );
      }
    });
  });

  describe("folderOf(path)", () => {
    it("returns the folder a path is in, and an empty string for a file at the root", () => {
      assert.equal(
        folderOf("runtime/vectors/arrivals/story.json"),
        "runtime/vectors/arrivals",
      );
      assert.equal(folderOf("story.json"), "");
    });
  });

  /**
   * A reader of `held.json` must see a whole version of it while it is written again. Eight readers read it and list the
   * folder as it is written 40 times, with versions of 50 kB and 100 kB. Another program's file, `held.json.notmine.writing`,
   * is in the folder from the start.
   */
  describe("given a folder on disk whose file is written 40 times while eight readers read it and list the folder", () => {
    const VERSIONS = [1, 2].map((n) =>
      JSON.stringify({ n, rows: "x".repeat(n * 50_000) }),
    );
    let folder: string;
    let outcome: Kept<{
      seen: Set<string | undefined>;
      listed: Set<string>;
    }>;

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "files-"));
      outcome = await kept(async () => {
        const files = new FolderFiles(folder, POD);
        await files.write("held.json", bytes(VERSIONS[0] ?? ""));
        let writing = true;
        const writer = (async () => {
          try {
            for (let time = 0; time < 40; time += 1)
              await files.write("held.json", bytes(VERSIONS[time % 2] ?? ""));
          } finally {
            writing = false;
          }
        })();
        await files.write("held.json.notmine.writing", new Uint8Array());
        const seen = new Set<string | undefined>();
        const listed = new Set<string>();
        const readers = [1, 1, 1, 1, 0, 0, 0, 0].map(async (pause) => {
          while (writing) {
            seen.add(text(await files.read("held.json")));
            for (const path of await files.list("")) listed.add(path);
            if (pause)
              await new Promise((resolve) => setTimeout(resolve, pause));
          }
        });
        await Promise.all([writer, ...readers]);
        return { seen, listed };
      });
    });

    after(() => rm(folder, { recursive: true, force: true }));

    it("returns to every read the whole of one version of the file or the whole of the other", () => {
      const { seen } = got(outcome);
      assert.ok(seen.size > 0, "no reader read the file");
      for (const read of seen)
        assert.ok(VERSIONS.includes(read ?? ""), "a read was cut short");
    });

    it("lists no file that is half written", () => {
      const { listed } = got(outcome);
      assert.ok(listed.has("held.json"), "no listing held the file");
      assert.deepEqual(
        [...listed].filter(
          (path) =>
            path !== "held.json" && path !== "held.json.notmine.writing",
        ),
        [],
      );
    });

    it("lists another program's file whose name ends as a half-written file's does", () => {
      assert.ok(got(outcome).listed.has("held.json.notmine.writing"));
    });
  });

  describe("ExportedFiles", () => {
    it("returns a copy of the bytes an app holds, of a Buffer and of a Uint8Array made in another realm", async () => {
      const held: [string, Uint8Array][] = [
        ["a/buffer.xml", Buffer.from("abc")],
        ["a/realm.xml", runInNewContext("new Uint8Array([97, 98, 99])")],
      ];
      const files = new ExportedFiles(new Map(held), "a");
      for (const [path, original] of held) {
        const read = await files.read(path);
        assert.equal(text(read), "abc", path);
        read?.fill(0);
        assert.equal(text(original), "abc", `${path} after the copy changed`);
      }
    });
  });
});

const COMPONENTS = "https://site.example/components/";
const PACKED_FILES = new Map([
  ["queries/a.rq", bytes("SELECT * {}")],
  ["bom.ttl", new Uint8Array([0xef, 0xbb, 0xbf, 0x40])],
  ["schema/b.bin", new Uint8Array([0xff, 0x00, 0xc3])],
]);
const UNPACKED = "fixtures/c.json";

/** Every read of `FetchedFiles` over the folder `c/`, and what it asked the server, with the pack served or not. */
interface Fetching {
  /** The text of the first read, and what had been asked once it was made. */
  readonly first: {
    readonly text: string | undefined;
    readonly asked: string[];
  };
  /** The failure of the read that needed the pack while the pack's address answered 500. */
  readonly pending: unknown;
  /** Two more rounds of reads and a listing. */
  readonly rounds: readonly {
    readonly query: string | undefined;
    readonly fixture: string | undefined;
    readonly missing: Uint8Array | undefined;
    readonly queries: string[];
  }[];
  readonly asked: string[];
}

/** Fetches through a fake `fetch` that serves the folder `c/` and, when `packed`, the pack `c.json`, which answers 500 once. */
async function fetching(packed: boolean): Promise<Fetching> {
  const pack = packFolder([...PACKED_FILES.keys(), UNPACKED], PACKED_FILES);
  const served = new Map<string, string>([
    [`c/${UNPACKED}`, "{}"],
    ["c/queries/a.rq", "SELECT * {}"],
    ["c/files.json", JSON.stringify(["queries/a.rq", UNPACKED])],
  ]);
  if (packed) served.set("c.json", JSON.stringify(pack));
  const asked: string[] = [];
  let failing = true;
  const fetchedNow = globalThis.fetch;
  globalThis.fetch = (url) => {
    const path = String(url instanceof Request ? url.url : url).slice(
      COMPONENTS.length,
    );
    asked.push(path);
    if (path === "c.json" && failing) {
      failing = false;
      return Promise.resolve(new Response(null, { status: 500 }));
    }
    const body = served.get(path);
    return Promise.resolve(
      new Response(body ?? null, { status: body === undefined ? 404 : 200 }),
    );
  };
  try {
    const files = new FetchedFiles(`${COMPONENTS}c/`, undefined, {
      pack: `${COMPONENTS}c.json`,
    });
    const first = {
      text: text(await files.read("queries/a.rq")),
      asked: [...asked],
    };
    let pending: unknown;
    try {
      await files.read(UNPACKED);
    } catch (failure) {
      pending = failure;
    }
    const rounds = [];
    for (let time = 0; time < 2; time += 1)
      rounds.push({
        query: text(await files.read("queries/a.rq")),
        fixture: text(await files.read(UNPACKED)),
        missing: await files.read("none.ttl"),
        queries: await files.list("queries"),
      });
    return { first, pending, rounds, asked };
  } finally {
    globalThis.fetch = fetchedNow;
  }
}

/**
 * In a browser the vocabulary and a sample's pod are folders on a web server. `FetchedFiles` reads one over HTTP, and in
 * one request where the server also holds the folder's pack: one JSON file that holds every file of the folder.
 */
describe("Fetching a folder of files in a web page · FetchedFiles, packFolder(), unpackFolder()", () => {
  describe("packFolder(paths, files), unpackFolder(pack)", () => {
    const pack = packFolder([...PACKED_FILES.keys(), UNPACKED], PACKED_FILES);

    it("returns from `unpackFolder()` the bytes that were packed, once the pack has been through JSON", () => {
      assert.deepEqual(
        unpackFolder(JSON.parse(JSON.stringify(pack)) as FolderPack),
        PACKED_FILES,
      );
    });

    it("writes as base64 only the file that is not UTF-8 text", () => {
      assert.deepEqual(Object.keys(pack.base64), ["schema/b.bin"]);
    });
  });

  /**
   * One `FetchedFiles` reads the folder `c/` of `https://site.example/components/`, whose pack is `c.json`. The pack's
   * address answers 500 the first time it is asked. It is read once with the pack served and once with the address
   * answering 404, and the server is asked every question the reads cause. Each read changes what the next fetches, so
   * the leaves read what the reads left.
   */
  describe("given a `FetchedFiles` with a pack's address", () => {
    let withPack: Kept<Fetching>;
    let withoutPack: Kept<Fetching>;

    before(async () => {
      withPack = await kept(() => fetching(true));
      withoutPack = await kept(() => fetching(false));
    });

    it("fetches the first file read on its own, before the pack", () => {
      for (const [kind, run] of [
        ["with the pack served", got(withPack)],
        ["without the pack", got(withoutPack)],
      ] as const) {
        assert.equal(run.first.text, "SELECT * {}", kind);
        assert.deepEqual(run.first.asked, ["c/queries/a.rq"], kind);
      }
    });

    it("rejects a read that needs the pack while the pack's address responds 500", () => {
      for (const [kind, run] of [
        ["with the pack served", got(withPack)],
        ["without the pack", got(withoutPack)],
      ] as const) {
        assert.ok(run.pending instanceof Error, `${kind}: the read resolved`);
        assert.match(run.pending.message, /c.json answered 500/, kind);
      }
    });

    it("fetches the pack again after that failure, and each file once however often it is read", () => {
      for (const [kind, run] of [
        ["with the pack served", got(withPack)],
        ["without the pack", got(withoutPack)],
      ] as const) {
        assert.equal(run.rounds.length, 2, kind);
        for (const round of run.rounds) {
          assert.equal(round.query, "SELECT * {}", kind);
          assert.equal(round.fixture, "{}", kind);
          assert.equal(round.missing, undefined, kind);
        }
        assert.deepEqual(
          run.asked.filter((path) => path !== "c/files.json").sort(),
          [
            "c.json",
            "c.json",
            "c/queries/a.rq",
            `c/${UNPACKED}`,
            "c/none.ttl",
          ].sort(),
          kind,
        );
      }
    });

    it("reads files, and lists folders, from the pack where one is served, with no request for `files.json`", () => {
      const run = got(withPack);
      for (const round of run.rounds)
        assert.deepEqual(round.queries, ["queries/a.rq"]);
      assert.ok(!run.asked.includes("c/files.json"), run.asked.join(", "));
    });

    it("reads the folder itself, and `files.json` to list it, where the pack's address responds 404", () => {
      const run = got(withoutPack);
      for (const round of run.rounds)
        assert.deepEqual(round.queries, ["queries/a.rq"]);
      assert.deepEqual(
        run.asked.filter((path) => path === "c/files.json"),
        ["c/files.json"],
        run.asked.join(", "),
      );
    });

    it("rejects, saying it is no pack of a folder, a pack's address that serves other JSON", async () => {
      const fetchedNow = globalThis.fetch;
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify({ paths: [] })));
      try {
        const bad = new FetchedFiles(`${COMPONENTS}c/`, undefined, {
          pack: `${COMPONENTS}bad.json`,
        });
        await assert.rejects(bad.list(""), /bad.json is no pack of a folder/);
      } finally {
        globalThis.fetch = fetchedNow;
      }
    });
  });

  /**
   * Vite and most hosts answer a missing path with the app's own page, status 200 and `text/html`, so a file that is not
   * there reads as a page. The server here does so, answers 503 for `down.ttl`, and serves `queries/a.rq` as text and
   * lists it with the page `about.html` in `files.json`.
   */
  describe("given a server that sends its app's own page for a missing file", () => {
    const PAGE = "<!doctype html><title>The app</title>";
    const served = new Map<string, string>([
      ["c/files.json", JSON.stringify(["queries/a.rq", "about.html"])],
      ["c/queries/a.rq", "SELECT * {}"],
    ]);
    let fetchedNow: typeof globalThis.fetch;

    const folder = () =>
      new FetchedFiles(`${COMPONENTS}c/`, undefined, {
        pack: `${COMPONENTS}c.json`,
      });

    before(() => {
      fetchedNow = globalThis.fetch;
      globalThis.fetch = (url) => {
        const asked = String(url instanceof Request ? url.url : url);
        const body = served.get(asked.slice(COMPONENTS.length));
        return Promise.resolve(
          new Response(body ?? PAGE, {
            status: asked.endsWith("down.ttl") ? 503 : 200,
            headers: {
              "content-type":
                body === undefined ? "text/html; charset=utf-8" : "text/plain",
            },
          }),
        );
      };
    });

    after(() => {
      globalThis.fetch = fetchedNow;
    });

    it("returns undefined for a missing file the server sends an HTML page for", async () => {
      assert.equal(await folder().read("none.ttl"), undefined);
    });

    it("reads the folder itself when the pack's address gets that page", async () => {
      const files = folder();
      assert.deepEqual(await files.list(""), ["about.html", "queries/a.rq"]);
      assert.equal(text(await files.read("queries/a.rq")), "SELECT * {}");
    });

    it("returns the page for an HTML file `files.json` names", async () => {
      const files = folder();
      await files.list("");
      assert.equal(text(await files.read("about.html")), PAGE);
    });

    it("rejects a read the server responds to with 503", async () => {
      await assert.rejects(folder().read("down.ttl"), /503/);
    });
  });
});
