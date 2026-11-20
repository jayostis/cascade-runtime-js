import {
  type Row,
  storedRows,
  STORED_KINDS,
  type Stored,
} from "./perf-report.js";

/**
 * The counts of a pod as a page reads them, for the tests of the pages: ten pod records in 41 files holding 1,000
 * statements and 10 MiB, of which 600 statements are in versions (10 of them the links to their records, which count as
 * history), 300 in records and revisions, 20 bookkeeping and 80 derived.
 */
export function held(): Stored {
  const kinds: Record<string, [number, number, number]> = {
    records: [10, 100, 524288],
    versions: [10, 600, 3145728],
    revisions: [10, 200, 524288],
    acts: [2, 10, 262144],
    "stored-documents": [1, 0, 5242880],
    views: [3, 80, 262144],
    "creation-settings": [5, 10, 524288],
  };
  return {
    kinds: Object.fromEntries(
      STORED_KINDS.map((kind) => {
        const [files = 0, statements = 0, bytes = 0] = kinds[kind] ?? [];
        return [kind, { files, statements, bytes }];
      }),
    ) as Stored["kinds"],
    podRecords: 10,
    versionLinks: 10,
    predicates: {
      cascade: 700,
      prov: 100,
      pav: 50,
      dct: 50,
      rdf: 90,
      other: 10,
    },
    onDisk: { files: 41, bytes: 10485760, blocks: 12582912 },
    beside: { files: 3, bytes: 2097152 },
    database: {
      file: 2097152,
      statements: 900,
      terms: 400,
      tables: 1048576,
      indexes: 524288,
      largest: [{ name: "term", kind: "table", bytes: 786432 }],
    },
  };
}

/** The rows the harness writes for `stored`, of 647 source entries, as a file of one build has them. */
export const rowsOfHeld = (
  stored: Stored = held(),
  dataset = "synthea-10y",
): Row[] =>
  storedRows(
    `stored-${dataset}`,
    `dataset=${dataset} sha256=${"a".repeat(64)} records=647`,
    stored,
    647,
  );
