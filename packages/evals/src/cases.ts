// A case: a synthetic person's downloads (the vocabulary kit's copies plus a generator's), its key, and the pod made
// from the downloads. `prepare` makes the downloads and the pod once per input and checks the downloads are the
// bytes the key was written against.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { componentsOf } from "@cascade-runtime/runtime/node";
import { openPod, type Pod } from "cascade-runtime";
import type { Claim, Tie } from "./citations.js";
import { type Environment, pinnedPod } from "./pinned.js";
import { CASES, WORK } from "./paths.js";
import { valid } from "./schemas.js";

export interface Case {
  readonly id: string;
  readonly synthetic: true;
  readonly person: { readonly name: string; readonly pronoun: string };
  readonly today: string;
  readonly description: {
    readonly summary: string;
    readonly who: string;
    readonly sources: string;
    readonly planted: string;
    readonly traps: string;
    readonly guidelines: readonly string[];
    readonly from: string;
  };
  readonly downloads: {
    readonly kit: readonly { readonly from: string; readonly to: string }[];
    readonly uses?: readonly { readonly case: string }[];
    readonly generate: string;
    readonly sha256: string;
  };
  readonly imports: readonly string[];
  readonly reading: readonly string[];
}

export interface KeyItem {
  readonly id: string;
  readonly kind: "gap" | "trap" | "near-trap";
  readonly title: string;
  readonly lookingFor: string;
  readonly evidence: readonly (Claim & { readonly says?: string })[];
  readonly absent?: readonly string[];
  readonly links: readonly string[];
  readonly found: string;
  readonly partly?: string;
  readonly wrong: readonly string[];
  readonly notWrong?: readonly string[];
  readonly wording?: readonly {
    readonly pattern: string;
    readonly means: string;
  }[];
  readonly pod: "visible" | "deeper" | "narrative-only";
  readonly guideline?: string;
  /** What must be absent for the item to hold, its kind and since when: an absence that ties to it is held to this. */
  readonly absentMatch?: Tie;
  readonly find?: readonly {
    readonly question: string;
    readonly where?: readonly string[];
  }[];
}

export interface Key {
  readonly case: string;
  readonly written: string;
  readonly items: readonly KeyItem[];
  readonly preExisting?: readonly {
    readonly id: string;
    readonly says: string;
    readonly legitimateFind?: boolean;
  }[];
  readonly generic?: readonly string[];
}

export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** The case ids there are: each folder of `cases/` holding a case.json. */
export async function caseIds(): Promise<string[]> {
  return (await readdir(CASES, { withFileTypes: true }))
    .filter(
      (it) => it.isDirectory() && existsSync(join(CASES, it.name, "case.json")),
    )
    .map((it) => it.name)
    .sort();
}

/** The case, held to its schema; anything not marked synthetic is refused. */
export async function loadCase(id: string): Promise<Case> {
  const path = join(CASES, id, "case.json");
  const found = valid<Case>(
    "case",
    JSON.parse(await readFile(path, "utf8")),
    path,
  );
  if (found.id !== id) throw new Error(`${path} names itself ${found.id}`);
  return found;
}

export async function loadKey(
  id: string,
): Promise<{ key: Key; sha256: string; prose: string }> {
  const path = join(CASES, id, "key.json");
  const text = await readFile(path, "utf8");
  const prose = await readFile(join(CASES, id, "key.md"), "utf8");
  return {
    key: valid<Key>("key", JSON.parse(text), path),
    sha256: sha256(text + "\n" + prose),
    prose,
  };
}

/** Every file under `folder`, as paths relative to it with forward slashes, sorted. */
export async function filesUnder(folder: string): Promise<string[]> {
  return (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((it) => it.isFile())
    .map((it) =>
      relative(folder, join(it.parentPath, it.name)).replaceAll("\\", "/"),
    )
    .sort();
}

/** The SHA-256 of the lines `<file's sha256>  <path>`, sorted by path: `sha256sum` over the folder, hashed. */
export async function digestOf(folder: string): Promise<string> {
  let lines = "";
  for (const file of await filesUnder(folder))
    lines += `${sha256(await readFile(join(folder, file)))}  ${file}\n`;
  return sha256(lines);
}

const PACKAGE_JSON = fileURLToPath(
  import.meta.resolve("cascade-runtime/package.json"),
);

export interface Component {
  readonly name: string;
  readonly repository: string;
  readonly commit: string;
  readonly source: string;
  readonly uncommitted?: number;
}

/** The commits of the vocabulary, the adapters and the Bridge the runtime resolves, and the vocabulary's folder. */
export async function components(): Promise<{
  vocabulary: string;
  resolved: Component[];
}> {
  const parts = await componentsOf(dirname(PACKAGE_JSON));
  const resolved: Component[] = [];
  let vocabulary = "";
  for (const component of [parts.config.vocabulary, ...parts.config.adapters]) {
    const found = await parts.resolve(component);
    if (component === parts.config.vocabulary) vocabulary = found.folder;
    resolved.push({
      name: component.repository.split("/").pop() ?? component.repository,
      repository: component.repository,
      commit: found.version,
      source: found.source,
      ...(found.uncommitted === undefined
        ? {}
        : { uncommitted: found.uncommitted }),
    });
  }
  const bridge = await parts.bridge();
  resolved.push({
    name: "cascade-bridge-rs",
    repository: "https://github.com/jayostis/cascade-bridge-rs",
    commit: bridge.commit,
    source: bridge.source,
  });
  return { vocabulary, resolved };
}

/** The runtime's own commit, and how many files differ from it. */
export function harnessCommit(): { commit: string; uncommitted: number } {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dirname(PACKAGE_JSON),
      encoding: "utf8",
    }).trim();
  try {
    return {
      commit: git("rev-parse", "HEAD"),
      uncommitted: git("status", "--porcelain").split("\n").filter(Boolean)
        .length,
    };
  } catch {
    return { commit: "unknown", uncommitted: 0 };
  }
}

export interface Prepared {
  readonly case: string;
  readonly downloads: string;
  readonly downloadsSha256: string;
  readonly pods: string;
  readonly pod: string;
  readonly components: readonly Component[];
  /** For a pinned run: the runtime build that made the pod and reads it, its cascade-mcp, and the environment's key. */
  readonly runtime?: string;
  readonly mcp?: string;
  readonly environment?: string;
  readonly imports: readonly {
    readonly download: string;
    readonly refused?: string;
    readonly records: number;
  }[];
  readonly documents: readonly {
    readonly file: string;
    readonly bytes: number;
  }[];
}

const sameComponents = (a: readonly Component[], b: readonly Component[]) =>
  JSON.stringify(a.map((it) => [it.repository, it.commit])) ===
  JSON.stringify(b.map((it) => [it.repository, it.commit]));

/**
 * The case's downloads and its pod in `work/<case>/`, made once per downloads and components: the kit's copies from
 * the vocabulary, the generator's files beside them, the digest checked against the case's, then each import in order.
 */
export async function prepare(
  id: string,
  log: (line: string) => void = () => undefined,
  env?: Environment,
): Promise<Prepared> {
  const found = await loadCase(id);
  const folder = join(WORK, env === undefined ? id : `${id}@${env.key}`);
  const record = join(folder, "prepared.json");
  const { vocabulary, resolved } =
    env === undefined
      ? await components()
      : {
          vocabulary: join(env.folder, "cascade-vocabulary"),
          resolved: env.components,
        };
  if (env !== undefined && env.commits["cascade-vocabulary"] === undefined)
    throw new Error(
      "a pinned run pins cascade-vocabulary, which holds the kits' downloads",
    );
  if (existsSync(record)) {
    const kept = JSON.parse(await readFile(record, "utf8")) as Prepared;
    if (
      kept.downloadsSha256 === found.downloads.sha256 &&
      sameComponents(kept.components, resolved) &&
      existsSync(join(kept.pods, kept.pod))
    )
      return kept;
  }
  const used: string[] = [];
  for (const { case: other } of found.downloads.uses ?? [])
    used.push((await prepare(other, log, env)).downloads);
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  const downloads = join(folder, "downloads");
  await mkdir(downloads, { recursive: true });
  for (const { from, to } of found.downloads.kit)
    await cp(join(vocabulary, from), join(downloads, to), { recursive: true });
  execFileSync(
    process.execPath,
    [join(CASES, id, found.downloads.generate), downloads, ...used],
    { stdio: "inherit" },
  );
  const digest = await digestOf(downloads);
  if (digest !== found.downloads.sha256)
    throw new Error(
      `${id}'s downloads are not the ones its key was written against: digest ${digest}, the case says ${found.downloads.sha256}. A kit download or the generator changed; check the key against the new downloads before updating the digest.`,
    );
  const pods = join(folder, "pods");
  log(`${id}: importing ${found.imports.length} downloads into a new pod`);
  const imports: Prepared["imports"][number][] = [];
  if (env !== undefined)
    for (const { path, ...it } of pinnedPod(env, "build", join(pods, id), [
      found.person.name,
      ...found.imports.map((name) => join(downloads, name)),
    ]) as { path: string; records: number; refused?: string }[])
      imports.push({
        download: relative(downloads, path).replaceAll("\\", "/"),
        ...it,
      });
  const pod =
    env === undefined
      ? await openPod(join(pods, id), { title: found.person.name })
      : undefined;
  if (pod !== undefined)
    try {
      for (const name of found.imports) {
        const path = join(downloads, name);
        let sources;
        try {
          sources = await pod.look(path);
        } catch (error) {
          imports.push({
            download: name,
            records: 0,
            refused: (error as Error).message,
          });
          continue;
        }
        const done = await pod.import(path, { aboutSubject: true });
        imports.push({
          download: name,
          records: sources.reduce(
            (sum, it) =>
              sum + Object.values(it.records ?? {}).reduce((a, b) => a + b, 0),
            0,
          ),
          ...(done.refused ? { refused: String(done.refused) } : {}),
        });
      }
    } finally {
      await pod.close();
    }
  const documents: { file: string; bytes: number }[] = [];
  for (const file of found.reading)
    documents.push({
      file,
      bytes: (await readFile(join(downloads, file))).length,
    });
  const prepared: Prepared = {
    case: id,
    downloads,
    downloadsSha256: digest,
    pods,
    pod: id,
    components: resolved,
    imports,
    documents,
    ...(env === undefined
      ? {}
      : { runtime: env.runtime, mcp: env.mcp, environment: env.key }),
  };
  await writeFile(record, JSON.stringify(prepared, null, 2) + "\n");
  return prepared;
}

/**
 * The case's pod, opened to read; the caller closes it. The tables are configured once per process, by the command
 * that runs (or a test's setup), never here: the runtime refuses it once any pod has opened.
 */
export async function openPrepared(prepared: Prepared): Promise<Pod> {
  return openPod(join(prepared.pods, prepared.pod));
}
