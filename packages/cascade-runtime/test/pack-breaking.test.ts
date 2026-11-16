import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  breakingNotes,
  breakingOf,
  breakingSince,
  mergedPullRequests,
} from "../pack/breaking.js";

const CHECK = fileURLToPath(
  new URL("../../../../scripts/breaking-check.mjs", import.meta.url),
);

const body = (section: string) => `Closes #1\n\n## Breaking\n${section}\n\n## Tests\nran\n`;

/** GitHub as `breakingSince` reads it: an answer for each path, and a refusal for any other. */
const github =
  (answers: Record<string, unknown>) =>
  async (path: string): Promise<unknown> => {
    if (!(path in answers)) throw new Error(`GitHub refused ${path}`);
    return answers[path];
  };

/**
 * The `## Breaking` lines of each pull request, which the build notes of a release open with, and the check that a pull
 * request has them.
 */
describe("Breaking changes in a build's notes · breakingOf(), mergedPullRequests(), breakingNotes(), breakingSince()", () => {
  describe("breakingOf(body)", () => {
    it("returns the lines of the section, each without its bullet", () => {
      assert.deepEqual(
        breakingOf(
          body("- `aboutSubject` -> `claim`\n* `look` -> removed\n\n`claimed` -> `claimedProfiles`"),
        ),
        {
          lines: [
            "`aboutSubject` -> `claim`",
            "`look` -> removed",
            "`claimed` -> `claimedProfiles`",
          ],
        },
      );
    });

    it("returns no lines and no problem for None", () => {
      assert.deepEqual(breakingOf(body("None")), { lines: [] });
      assert.deepEqual(breakingOf(body("<!-- say which -->\nnone.\n")), {
        lines: [],
      });
    });

    it("reads a body written with Windows line ends", () => {
      assert.deepEqual(
        breakingOf(body("- a -> b").replaceAll("\n", "\r\n")),
        { lines: ["a -> b"] },
      );
    });

    it("stops the section at the next heading", () => {
      assert.deepEqual(
        breakingOf("## Breaking\n- a -> b\n### Why\n- not a -> line\n"),
        { lines: ["a -> b"] },
      );
    });

    it("reports a problem, naming what is wrong, for each body the check must refuse", () => {
      const refused: [string | null, RegExp][] = [
        [null, /no `## Breaking` section/],
        ["", /no `## Breaking` section/],
        ["## Tests\nran\n", /no `## Breaking` section/],
        ["<!-- ## Breaking\nNone -->", /no `## Breaking` section/],
        [body(""), /empty/],
        [body("<!-- old -> new, or None -->"), /empty/],
        [body("- \n  \n"), /empty/],
        [body("it renames a thing"), /"it renames a thing" is not/],
        [body("None\n- a -> b"), /None beside lines/],
        [body("Nothing"), /"Nothing" is not/],
      ];
      for (const [text, problem] of refused)
        assert.match(breakingOf(text).problem ?? "", problem, String(text));
    });
  });

  describe("mergedPullRequests(subjects)", () => {
    it("returns the numbers of the merge commits, oldest first, and no other commit", () => {
      assert.deepEqual(
        mergedPullRequests([
          "Merge pull request #12 from jayostis/feat/a",
          "Merge branch 'main' into feat/a",
          "feat(runtime): a squash that names #13",
          "Merge pull request #9 from someone/fix/b",
          "Merge pull request #12 from jayostis/feat/a",
        ]),
        [12, 9],
      );
    });
  });

  describe("breakingNotes(entries)", () => {
    it("opens with a heading and names the pull request of each line", () => {
      assert.equal(
        breakingNotes([
          { pr: 12, body: body("- a -> b\n- c -> removed") },
          { pr: 14, body: body("None") },
          { pr: 15, body: body("- d -> e") },
        ]),
        "## Breaking changes\n\n- a -> b (#12)\n- c -> removed (#12)\n- d -> e (#15)\n",
      );
    });

    it("says Breaking changes: none when no pull request lists a line", () => {
      assert.equal(breakingNotes([]), "Breaking changes: none\n");
      assert.equal(
        breakingNotes([
          { pr: 1, body: body("None") },
          { pr: 2, body: null },
          { pr: 3, body: "## Tests\nran" },
        ]),
        "Breaking changes: none\n",
      );
    });
  });

  describe("breakingSince(repository, sha, get)", () => {
    const answers = {
      "/repos/o/r/releases?per_page=30": [
        { tag_name: "build-new" },
        { tag_name: "v1" },
        { tag_name: "build-prev" },
        { tag_name: "build-older" },
      ],
      "/repos/o/r/compare/build-prev...new?per_page=100&page=1": {
        commits: [
          { commit: { message: "Merge pull request #5 from o/a\n\nfeat" } },
          { commit: { message: "Merge branch 'main' into a" } },
          { commit: { message: "Merge pull request #6 from o/b" } },
        ],
      },
      "/repos/o/r/pulls/5": { body: body("- a -> b") },
      "/repos/o/r/pulls/6": { body: body("None") },
    };

    it("collects the lines of every pull request merged since the build before this one", async () => {
      assert.equal(
        await breakingSince("o/r", "new", github(answers)),
        "## Breaking changes\n\n- a -> b (#5)\n",
      );
    });

    it("reads every page of a long history", async () => {
      const full = Array.from({ length: 100 }, () => ({
        commit: { message: "a commit" },
      }));
      assert.equal(
        await breakingSince(
          "o/r",
          "new",
          github({
            ...answers,
            "/repos/o/r/compare/build-prev...new?per_page=100&page=1": {
              commits: full,
            },
            "/repos/o/r/compare/build-prev...new?per_page=100&page=2":
              answers["/repos/o/r/compare/build-prev...new?per_page=100&page=1"],
          }),
        ),
        "## Breaking changes\n\n- a -> b (#5)\n",
      );
    });

    it("says none when the repository has no build before this one", async () => {
      assert.equal(
        await breakingSince(
          "o/r",
          "new",
          github({
            "/repos/o/r/releases?per_page=30": [{ tag_name: "build-new" }],
          }),
        ),
        "Breaking changes: none\n",
      );
    });

    it("throws when GitHub refuses a pull request, so a build never omits a line unseen", async () => {
      const { "/repos/o/r/pulls/6": _, ...without } = answers;
      await assert.rejects(
        breakingSince("o/r", "new", github(without)),
        /GitHub refused \/repos\/o\/r\/pulls\/6/,
      );
    });
  });

  describe("when the pull request's body is checked by scripts/breaking-check.mjs", () => {
    const checked = async (pullRequestBody: string | null) => {
      const event = join(await mkdtemp(join(tmpdir(), "cr-")), "event.json");
      await writeFile(
        event,
        JSON.stringify({ pull_request: { body: pullRequestBody } }),
      );
      return spawnSync(process.execPath, [CHECK], {
        env: { ...process.env, GITHUB_EVENT_PATH: event },
        encoding: "utf8",
      });
    };

    it("exits 0 for a body that lists lines or says None", async () => {
      assert.equal((await checked(body("- a -> b"))).status, 0);
      assert.equal((await checked(body("None"))).status, 0);
    });

    it("exits 1, saying what is wrong, for a body with no section or an empty one", async () => {
      const missing = await checked("## Tests\nran");
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /no `## Breaking` section/);
      const empty = await checked(body(""));
      assert.equal(empty.status, 1);
      assert.match(empty.stderr, /empty/);
      assert.equal((await checked(null)).status, 1);
    });
  });
});
