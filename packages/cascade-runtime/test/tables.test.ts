import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import {
  fileStem,
  iri,
  literal,
  MemoryFiles,
  ntriples,
  OxigraphStore,
  type Triple,
} from "@cascade-runtime/runtime";
import { checkouts, findRoot } from "@cascade-runtime/runtime/node";
import { partsOf, type ResolvedParts } from "../src/node/resolved.js";
import { openPodWith } from "../src/pod.js";
import { Tables } from "../src/tables.js";

const FEED = "https://tables.example/feed.ttl";
const DCAT = "http://www.w3.org/ns/dcat#";
const SPDX = "http://spdx.org/rdf/terms#";
const PROV = "http://www.w3.org/ns/prov#";
const CURRENT = `${DCAT}hasCurrentVersion`;
const REVISION_OF = `${PROV}wasRevisionOf`;
const PREFIXES = `PREFIX jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX pav: <http://purl.org/pav/>
PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
PREFIX health: <https://ns.cascadeprotocol.org/health/v1#>
`;

/** The test feed as it is served: its catalog and each file under it, by URL. */
interface Served {
  readonly catalog: readonly Triple[];
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** What is served as the feed in place of its catalog. */
  readonly text?: string;
}

let parts: ResolvedParts;
let feed: Served;
/** The test feed with each series' first version current. */
let first: Served;
/** The test feed's vaccine-groups series, its first version and its second. */
let groups: { series: string; first: string; second: string };
let scratch: string;

before(async () => {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const components = await checkouts(root);
  parts = await partsOf(components);
  const { folder } = await components.resolve(
    components.config.tables.repository,
  );
  const valid = join(folder, "fixtures", "feeds", "valid");
  const catalog = await new OxigraphStore().parse(
    await readFile(join(valid, "feed.ttl")),
    FEED,
  );
  const files = new Map<string, Uint8Array>();
  for (const [, predicate, url] of catalog)
    if (predicate.value === `${DCAT}downloadURL`)
      files.set(
        url.value,
        await readFile(join(valid, ...new URL(url.value).pathname.split("/"))),
      );
  feed = { catalog, files };
  const revised = (version: string): string =>
    catalog.find(
      ([subject, predicate]) =>
        subject.value === version && predicate.value === REVISION_OF,
    )?.[2].value ?? version;
  first = {
    files,
    catalog: catalog.map(([subject, predicate, object]) =>
      predicate.value === CURRENT
        ? [subject, predicate, iri(revised(object.value))]
        : [subject, predicate, object],
    ),
  };
  const series = catalog.find(
    ([, predicate, object]) =>
      predicate.value.endsWith("#tableKind") &&
      object.value.endsWith("#VaccineGroups"),
  )?.[0].value;
  const second = catalog.find(
    ([subject, predicate]) =>
      subject.value === series && predicate.value === CURRENT,
  )?.[2].value;
  assert.ok(series !== undefined && second !== undefined);
  groups = { series, second, first: revised(second) };
  assert.notEqual(groups.first, second);
  scratch = await mkdtemp(join(tmpdir(), "cascade-tables-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function fetchOf(served: Served): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === FEED)
      return new Response(
        served.text ?? new TextDecoder().decode(ntriples(served.catalog)),
      );
    const bytes = served.files.get(url);
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(bytes.slice());
  };
}

function tablesOver(
  served: Served,
  files = new MemoryFiles("urn:test:tables/"),
): Tables {
  return new Tables({
    files,
    feeds: [FEED],
    vocabulary: parts.vocabulary,
    newStore: parts.newStore,
    fetch: fetchOf(served),
  });
}

/** The URL of a version's rows. */
function rowsUrl(served: Served, version: string): string {
  const distribution = served.catalog.find(
    ([subject, predicate]) =>
      subject.value === version && predicate.value === `${DCAT}distribution`,
  )?.[2];
  const url = served.catalog.find(
    ([subject, predicate]) =>
      subject.value === distribution?.value &&
      predicate.value === `${DCAT}downloadURL`,
  )?.[2].value;
  assert.ok(url);
  return url;
}

async function gunzipped(bytes: Uint8Array): Promise<string> {
  return new Response(
    new Blob([bytes.slice()])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
  ).text();
}

async function gzipped(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}

async function hex(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice())),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The feed with the version's rows changed by `change`, and the checksum the feed gives for them made theirs. */
async function withRows(
  served: Served,
  version: string,
  change: (nquads: string) => string,
): Promise<Served> {
  const url = rowsUrl(served, version);
  const was = served.files.get(url);
  assert.ok(was);
  const bytes = await gzipped(change(await gunzipped(was)));
  const [oldSum, newSum] = [await hex(was), await hex(bytes)];
  return {
    files: new Map([...served.files, [url, bytes]]),
    catalog: served.catalog.map(([subject, predicate, object]) =>
      predicate.value === `${SPDX}checksumValue` && object.value === oldSum
        ? [subject, predicate, literal(newSum)]
        : [subject, predicate, object],
    ),
  };
}

test("a pod opened after a check keeps the planted newer version adopts it: it records the version, files the Same it newly joins and files again the Same that used the replaced one", async () => {
  const store = new MemoryFiles("urn:test:tables/");
  const before = tablesOver(first, store);
  const [kept] = await before.check();
  assert.equal(kept?.kept.length, 3);
  assert.ok((await before.current()).includes(groups.first));

  const folder = join(scratch, "pods", "hana");
  let pod = await openPodWith({ ...parts, tables: before }, folder);
  const shots = [
    ["141", "2025-10-01"],
    ["150", "2025-10-01"],
    ["140", "2024-10-01"],
    ["141", "2024-10-01"],
  ].map(
    (
      [code, date],
      index,
    ) => `<urn:cascade:output-${index}> a health:ImmunizationRecord .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  health:vaccineCode "${code}" ; health:administrationDate "${date}"^^<http://www.w3.org/2001/XMLSchema#date> ;
  rec:patient <${pod.subject}> .`,
  );
  const entered = await pod.enter(`${PREFIXES}
<urn:cascade:this-entry> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole jdg:patient ] .
${shots.join("\n")}`);
  assert.equal(entered.refused, undefined);
  assert.equal(entered.matched?.refused, undefined);
  await pod.close();

  const after = tablesOver(feed, store);
  const [checked] = await after.check({ cache: "no-cache" });
  assert.deepEqual(checked?.refused, []);
  assert.ok(checked?.kept.includes(groups.second));
  pod = await openPodWith({ ...parts, tables: after }, folder);
  try {
    assert.equal(pod.opened?.refused, undefined);
    assert.deepEqual(pod.opened?.unheld, []);
    assert.deepEqual(
      await pod.ask({
        query: `${PREFIXES}SELECT ?version WHERE { <${groups.series}> pav:hasCurrentVersion ?version }`,
      }),
      [{ version: groups.second }],
    );
    const sames = await pod.ask({
      query: `${PREFIXES}SELECT ?used (GROUP_CONCAT(?code; separator=" ") AS ?codes) WHERE {
        ?judgment jdg:justification jdg:SameMappedCodeAndDate ; prov:used ?used ; prov:hadMember ?record .
        VALUES ?used { <${groups.first}> <${groups.second}> }
        ?record pav:hasCurrentVersion/health:vaccineCode ?code
      } GROUP BY ?judgment ?used`,
    });
    const codes = ({ used = "", codes = "" }) =>
      `${used === groups.first ? "first" : "second"}: ${codes.split(" ").sort().join(" ")}`;
    assert.deepEqual(sames.map(codes).sort(), [
      "first: 141 150",
      "second: 140 141",
      "second: 141 150",
    ]);
  } finally {
    await pod.close();
  }
  const again = await openPodWith({ ...parts, tables: after }, folder);
  assert.equal(again.opened, undefined);
  await again.close();
});

test("a check keeps nothing of a version that does not verify, and tries a feed or rows it cannot read later", async () => {
  const cases: [string, () => Promise<Served>, RegExp, "refused" | "later"][] =
    [
      [
        "rows not of the checksum the feed gives",
        async () => ({
          ...feed,
          files: new Map([
            ...feed.files,
            [rowsUrl(feed, groups.second), await gzipped("")],
          ]),
        }),
        /checksum/,
        "refused",
      ],
      [
        "rows that do not give the version's name",
        () =>
          withRows(feed, groups.second, (nquads) =>
            nquads.replace("/cvx/140>", "/cvx/149>"),
          ),
        /name/,
        "refused",
      ],
      [
        "a row outside the version's graph",
        () =>
          withRows(feed, groups.second, (nquads) =>
            nquads.replace(`<${groups.second}> .`, "<urn:example:other> ."),
          ),
        /outside the graph/,
        "refused",
      ],
      [
        "rows that are not N-Quads",
        () =>
          withRows(
            feed,
            groups.second,
            (nquads) => `${nquads}not a quad <${groups.second}> .\n`,
          ),
        /not N-Quads/,
        "refused",
      ],
      [
        "rows the feed's site no longer serves",
        async () => ({
          ...feed,
          files: new Map(
            [...feed.files].filter(
              ([url]) => url !== rowsUrl(feed, groups.second),
            ),
          ),
        }),
        /404/,
        "later",
      ],
      [
        "a feed that is not Turtle",
        async () => ({ ...feed, text: "<not> <Turtle" }),
        /not Turtle/,
        "later",
      ],
    ];
  const store = new MemoryFiles("urn:test:tables/");
  await tablesOver(first, store).check();
  for (const [input, served, reason, outcome] of cases) {
    const tables = tablesOver(await served(), store);
    const [checked] = await tables.check();
    const said =
      outcome === "later"
        ? (checked?.later ?? "")
        : (checked?.refused.find(({ version }) => version === groups.second)
            ?.reason ?? "");
    assert.match(said, reason, input);
    assert.ok(!checked?.kept.includes(groups.second), input);
    assert.ok(!(await tables.current()).includes(groups.second), input);
    assert.equal(
      await store.read(`${fileStem(groups.second)}.ttl`),
      undefined,
      input,
    );
  }
});
