/** What `breakingOf` found in a pull request's body: the lines of its `## Breaking` section, or what is wrong with it. */
export interface BreakingSection {
  readonly lines: readonly string[];
  readonly problem?: string;
}

/** The problem of a body with no `## Breaking` section, which a pull request merged before the check has. */
export const NO_SECTION = "the body has no `## Breaking` section";

const BOM = String.fromCharCode(0xfeff);
const LINE_END = new RegExp(
  `\\r\\n|[\\n\\r${String.fromCharCode(0x2028, 0x2029)}]`,
);
const HEADING = /^##[ \t]+Breaking[ \t]*$/;
const ANY_HEADING = /^#{1,6}[ \t]/;
const RULE = /^-{3,}$/;
const DEPENDS_ON = /^Depends-On:/i;
const ITEM = /^(?:[-*+]|\d+\.)[ \t]+/;
const NONE = /^none\.?$/i;
const ARROW = "->";

/**
 * The `## Breaking` section of a pull request's body: one `old -> new` or `old -> removed` line for each rename or removal
 * a caller sees, or `None`. Comments are not read; a byte order mark is dropped, and a lone carriage return, U+2028 and
 * U+2029 end a line as `\n` does. The section ends at the next heading, a `---` rule or a `Depends-On:` line. A body with
 * no section, an empty one, a line that is not an arrow and `None` beside lines each come back with a `problem` saying so;
 * `None` alone is no lines and no problem.
 */
export function breakingOf(body: string | null | undefined): BreakingSection {
  const rows = (body ?? "")
    .replaceAll(BOM, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(LINE_END);
  const start = rows.findIndex((row) => HEADING.test(row));
  if (start === -1) return { lines: [], problem: NO_SECTION };
  const rest = rows.slice(start + 1);
  const end = rest.findIndex((row) => {
    const text = row.trim();
    return ANY_HEADING.test(row) || RULE.test(text) || DEPENDS_ON.test(text);
  });
  const lines = (end === -1 ? rest : rest.slice(0, end))
    .map((row) => row.trim().replace(ITEM, "").trim())
    .filter((row) => row !== "" && row !== "-" && row !== "*" && row !== "+");
  if (lines.length === 0)
    return {
      lines: [],
      problem:
        "the `## Breaking` section is empty: list each `old -> new` or `old -> removed`, or write None",
    };
  const none = lines.filter((line) => NONE.test(line)).length;
  if (none > 0 && lines.length === none) return { lines: [] };
  if (none > 0)
    return {
      lines: [],
      problem: "the `## Breaking` section has None beside lines",
    };
  const loose = lines.find((line) => !line.includes(ARROW));
  if (loose !== undefined)
    return {
      lines: [],
      problem: `"${loose}" is not \`old -> new\` or \`old -> removed\``,
    };
  return { lines };
}

/**
 * The pull requests the commits among `subjects` (commit titles, oldest first) merged, each once: a merge commit's
 * `Merge pull request #N`, a squash or rebase merge's `(#N)` at the end of its title.
 */
export function mergedPullRequests(subjects: readonly string[]): number[] {
  const found: number[] = [];
  for (const subject of subjects) {
    const number =
      /^Merge pull request #(\d+) /.exec(subject)?.[1] ??
      /\(#(\d+)\)\s*$/.exec(subject)?.[1];
    if (number !== undefined && !found.includes(Number(number)))
      found.push(Number(number));
  }
  return found;
}

/** A pull request whose body `breakingNotes` reads; `repository` is its repository's name when that is not the runtime's. */
export interface PullRequestBody {
  readonly pr: number;
  readonly body: string | null;
  readonly repository?: string;
}

/**
 * The top of a build's release notes: each line of each pull request's `## Breaking` section, naming its pull request
 * (and its repository when that is not the runtime's), or "Breaking changes: none". A line said again, as a runtime pull
 * request carries a vocabulary one forward, appears once, under the first pull request. A section present but not
 * readable appears as a line saying so; a body with no section (one merged before the check) adds nothing.
 */
export function breakingNotes(entries: readonly PullRequestBody[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { pr, body, repository } of entries) {
    const name = `${repository ?? ""}#${pr}`;
    const { lines: found, problem } = breakingOf(body);
    if (problem !== undefined && problem !== NO_SECTION)
      lines.push(`- ${name}: Breaking section unreadable (${problem})`);
    for (const line of found) {
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(`- ${line} (${name})`);
    }
  }
  return lines.length === 0
    ? "Breaking changes: none\n"
    : `## Breaking changes\n\n${lines.join("\n")}\n`;
}

const PAGE = 100;
const GITHUB = "https://github.com/";
const CARRIED =
  /<(https:\/\/github\.com\/[^\s/>]+\/[^\s/>]+)\/tree\/([0-9a-f]+)\/>/g;

/** A component of a build, as its notes' "It carries" table names it: the repository's URL and the commit built. */
export interface Carried {
  readonly repository: string;
  readonly commit: string;
}

/** The components the "It carries" table of a build's notes names. */
export function carriedBy(notes: string | null | undefined): Carried[] {
  return [...(notes ?? "").matchAll(CARRIED)].map(([, repository, commit]) => ({
    repository: repository as string,
    commit: commit as string,
  }));
}

type Get = (path: string) => Promise<unknown>;

async function mergedBetween(
  get: Get,
  repository: string,
  base: string,
  head: string,
): Promise<number[]> {
  const subjects: string[] = [];
  for (let page = 1; ; page += 1) {
    const { commits } = (await get(
      `/repos/${repository}/compare/${base}...${head}?per_page=${PAGE}&page=${page}`,
    )) as { commits: { commit: { message: string } }[] };
    subjects.push(
      ...commits.map(({ commit }) => commit.message.split("\n")[0] ?? ""),
    );
    if (commits.length < PAGE) break;
  }
  return mergedPullRequests(subjects);
}

/** The bodies of pull requests `numbers`; a number that is an issue, which a commit's `(#N)` may name, has none. */
async function bodiesOf(
  get: Get,
  repository: string,
  numbers: readonly number[],
  name?: string,
): Promise<PullRequestBody[]> {
  const entries: PullRequestBody[] = [];
  for (const pr of numbers) {
    const issue = (await get(`/repos/${repository}/issues/${pr}`)) as {
      body: string | null;
      pull_request?: unknown;
    };
    if (issue.pull_request !== undefined)
      entries.push({
        pr,
        body: issue.body,
        ...(name === undefined ? {} : { repository: name }),
      });
  }
  return entries;
}

/**
 * The breaking-changes notes of the build of `sha`, from the pull requests merged since the newest build before it, in the
 * runtime and in each of `components` (the vocabulary and the adapters this build carries, which the previous build's
 * notes name at their commits). `get` answers a path of GitHub's API; one it refuses throws, so a build never leaves a line
 * out unseen. A repository with no earlier build has nothing to compare with and says none, as does a component the
 * earlier build did not carry. A build made while another's release is still unmade also lists that build's pull
 * requests: more, never fewer.
 */
export async function breakingSince(
  repository: string,
  sha: string,
  get: Get,
  components: readonly Carried[] = [],
): Promise<string> {
  const releases: {
    tag_name: string;
    created_at: string;
    body: string | null;
  }[] = [];
  for (let page = 1; ; page += 1) {
    const found = (await get(
      `/repos/${repository}/releases?per_page=${PAGE}&page=${page}`,
    )) as typeof releases;
    releases.push(...found);
    if (found.length < PAGE) break;
  }
  const previous = releases
    .filter(
      (release) =>
        release.tag_name.startsWith("build-") &&
        release.tag_name !== `build-${sha}`,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (previous === undefined) return breakingNotes([]);
  const entries = await bodiesOf(
    get,
    repository,
    await mergedBetween(get, repository, previous.tag_name, sha),
  );
  const before = carriedBy(previous.body);
  for (const { repository: url, commit } of components) {
    const was = before.find((carried) => carried.repository === url)?.commit;
    if (was === undefined || was === commit) continue;
    const path = url.slice(GITHUB.length);
    entries.push(
      ...(await bodiesOf(
        get,
        path,
        await mergedBetween(get, path, was, commit),
        path.slice(path.lastIndexOf("/") + 1),
      )),
    );
  }
  return breakingNotes(entries);
}
