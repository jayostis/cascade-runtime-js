import type { Files } from "@cascade-runtime/runtime";
import { type Html, markup } from "./html.js";

const DOWNLOADS = "conformance/priya-natarajan/scripted-input/priya/downloads/";
const FHIR_FILE = `${DOWNLOADS}x-e2/apple_health_export/clinical-records/AllergyIntolerance-alg-aspirin-1.json`;
const KESTREL_FILE = `${DOWNLOADS}kestrel-harbor-health-summary.xml`;
const FERNHILL_FILE = `${DOWNLOADS}fernhill-family-clinic-summary.xml`;
const RECORD_FILE = "conformance/priya-natarajan/expected/allergies.ttl";

const RXNORM_OID = "2.16.840.1.113883.6.88";
const ALLERGY_TEMPLATE = "2.16.840.1.113883.10.20.22.4.7";
const REACTION_TEMPLATE = "2.16.840.1.113883.10.20.22.4.9";

/** One source or the record: where it is, what it is, and the values the example reads from it, each at the path it has there. */
export interface Shown {
  readonly title: string;
  readonly from: string;
  readonly file: string;
  readonly rows: readonly (readonly [path: string, value: string])[];
}

/** Priya Natarajan's aspirin allergy in three sources and as the one record they become. */
export interface OneFact {
  readonly sources: readonly Shown[];
  readonly record: Shown;
}

function need(found: string | undefined, what: string, file: string): string {
  if (found === undefined) throw new Error(`${file} has no ${what}`);
  return found;
}

async function text(files: Files, file: string): Promise<string> {
  const read = await files.read(file);
  if (read === undefined) throw new Error(`${file} is not in the vocabulary`);
  return new TextDecoder().decode(read);
}

interface Coding {
  readonly system?: string;
  readonly code?: string;
}

function fhirRows(source: string): Shown["rows"] {
  const resource = JSON.parse(source) as {
    code?: { coding?: Coding[] };
    reaction?: { manifestation?: { coding?: Coding[] }[] }[];
  };
  const substance = resource.code?.coding?.find(
    ({ system }) => system === "http://www.nlm.nih.gov/research/umls/rxnorm",
  )?.code;
  const reaction =
    resource.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.code;
  return [
    ["/code/coding/code", need(substance, "RxNorm code", FHIR_FILE)],
    [
      "/reaction/manifestation/coding/code",
      need(reaction, "reaction code", FHIR_FILE),
    ],
  ];
}

const CCDA_ENTRY =
  "/ClinicalDocument/component/structuredBody/component/section/entry/act/entryRelationship/observation";

const escaped = (value: string): string => value.replaceAll(".", "\\.");

/** The values of the allergy entry whose substance is the RxNorm code `substance`, read from that entry alone. */
function ccdaRows(
  source: string,
  file: string,
  substance: string,
): Shown["rows"] {
  const entries = source.split(
    new RegExp(`(?=<templateId root="${escaped(ALLERGY_TEMPLATE)}"\\s*/>)`),
  );
  const entry = entries.find((one) =>
    new RegExp(
      `<playingEntity[^>]*>\\s*<code\\s+code="${escaped(substance)}"[^>]*codeSystem="${escaped(RXNORM_OID)}"`,
    ).test(one),
  );
  const reaction = new RegExp(
    `<templateId root="${escaped(REACTION_TEMPLATE)}"[\\s\\S]*?<value [^>]*\\bcode="([^"]+)"`,
  ).exec(entry ?? "")?.[1];
  return [
    [
      `${CCDA_ENTRY}/participant/participantRole/playingEntity/code/@code`,
      need(
        entry === undefined ? undefined : substance,
        `entry for RxNorm code ${substance}`,
        file,
      ),
    ],
    [
      `${CCDA_ENTRY}/entryRelationship/observation/value/@code`,
      need(
        reaction,
        `reaction code in the entry for RxNorm code ${substance}`,
        file,
      ),
    ],
  ];
}

/** The record of the substance with the RxNorm code `substance`. */
function recordRows(source: string, substance: string): Shown["rows"] {
  const block = source
    .split(/^\[\] a /m)
    .find((one) => one.includes(`/rxnorm/${substance}>`));
  const property = (name: string, pattern: string): string =>
    need(
      new RegExp(`cascade:${name} ${pattern}`).exec(block ?? "")?.[1],
      name,
      RECORD_FILE,
    );
  return [
    ["cascade:allergen", `"${property("allergen", '"([^"]*)"')}"`],
    ["cascade:allergenCode", property("allergenCode", "<([^>]+)>")],
    [
      "cascade:reactionManifestationCode",
      property("reactionManifestationCode", "<([^>]+)>"),
    ],
  ];
}

/**
 * Priya Natarajan's aspirin allergy as FHIR and as two C-CDAs, and the record it becomes, read from the vocabulary's
 * conformance folder: no value on the page is typed in it. Throws when a file is missing or holds no such value.
 */
export async function readOneFact(vocabulary: Files): Promise<OneFact> {
  const [fhir, kestrel, fernhill, record] = await Promise.all([
    text(vocabulary, FHIR_FILE),
    text(vocabulary, KESTREL_FILE),
    text(vocabulary, FERNHILL_FILE),
    text(vocabulary, RECORD_FILE),
  ]);
  const fhirCode = fhirRows(fhir);
  const substance = need(fhirCode[0]?.[1], "RxNorm code", FHIR_FILE);
  return {
    sources: [
      {
        title: "FHIR R4 JSON",
        from: "an Apple Health export",
        file: FHIR_FILE,
        rows: fhirCode,
      },
      {
        title: "C-CDA",
        from: "Kestrel Harbor Health's summary",
        file: KESTREL_FILE,
        rows: ccdaRows(kestrel, KESTREL_FILE, substance),
      },
      {
        title: "C-CDA",
        from: "Fernhill Family Clinic's summary",
        file: FERNHILL_FILE,
        rows: ccdaRows(fernhill, FERNHILL_FILE, substance),
      },
    ],
    record: {
      title: "One Cascade record",
      from: "what all three become",
      file: RECORD_FILE,
      rows: recordRows(record, substance),
    },
  };
}

/** A file of the vocabulary as GitHub shows it, from the tree the files are read from. */
function address(vocabulary: Files, file: string): string {
  return vocabulary.iri.replace("/tree/", "/blob/") + file;
}

/** A path that may break after a slash and nowhere else. */
function breakAtSlashes(path: string): Html {
  const [first = "", ...rest] = path.split("/");
  return markup`${first}${rest.map((step) => markup`/<wbr>${step}`)}`;
}

function card(
  vocabulary: Files,
  className: string,
  { title, from, file, rows }: Shown,
): Html {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return markup`<div class="${className}">
<h3>${title}</h3>
<p class="about">${from}: <a href="${address(vocabulary, file)}"><code>${name}</code></a></p>
<dl>
${rows.map(([path, value]) => markup`<dt>${breakAtSlashes(path)}</dt><dd><code>${value}</code></dd>\n`)}</dl>
</div>
`;
}

/** The three forms, lines joining them, and the record. */
export function oneFactView(
  vocabulary: Files,
  { sources, record }: OneFact,
): Html {
  return markup`<div class="fact">
<div class="forms">
${sources.map((source) => card(vocabulary, "form", source))}</div>
<div class="join" aria-hidden="true"></div>
${card(vocabulary, "record", record)}</div>
`;
}
