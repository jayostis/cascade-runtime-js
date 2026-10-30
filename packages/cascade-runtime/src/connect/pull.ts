import { ccdaContents, RESOURCE_TYPE } from "@cascade-runtime/fhir-pull";
import { type Connection, FHIR_ID, held } from "./connect.js";
import { ConnectionFailure } from "./outcome.js";
import { limited, type Limits, type QueryPlan, type Search } from "./plan.js";
import { type Answer, parsed, Requests } from "./requests.js";

export interface PulledEntry {
  /** `<fhirBase>/<type>/<id>`. */
  readonly fullUrl: string;
  /** The resource exactly as the hospital sent it. */
  readonly resource: object;
}

/**
 * A C-CDA document a DocumentReference of the pull holds, as the pull read it, or why it could not: the hospital's
 * answer, the limit on bytes, an address on another origin, or an answer that is no C-CDA document.
 */
export interface PulledDocument {
  /** `DocumentReference/<id>`. */
  readonly documentReference: string;
  /** The content's position in the DocumentReference's `content`, from 0. */
  readonly content: number;
  /** The attachment's `url` as written; none for one given inline. */
  readonly url?: string;
  /** The URL read, or the DocumentReference's for one given inline. */
  readonly retrievedFrom?: string;
  readonly bytes?: Uint8Array;
  readonly notRead?: string;
}

/** A patient's records as one pull from one hospital found them: what an import is made from. */
export interface Pull {
  /** The connection's FHIR base, with no trailing slash: the `cascade:serverBaseUrl` the adapter names records from. */
  readonly fhirBase: string;
  /** The patient, by the hospital's id. */
  readonly patient: string;
  /** The hospital's name, as the directory row gives it. */
  readonly source: string;
  /** When the last response arrived, as an `xsd:dateTime` in UTC in its canonical form, as a store gives it back. */
  readonly retrievedAt: string;
  /** Each distinct resource once, by type and id, the first seen kept. */
  readonly bundle: {
    readonly resourceType: "Bundle";
    readonly type: "collection";
    readonly entry: readonly PulledEntry[];
  };
  /** References of a backfill type the hospital would not serve, as the records wrote them. */
  readonly missing: readonly string[];
  /** The plan's searches, each made. */
  readonly searches: readonly Search[];
  /**
   * Searches the hospital refused: one of their pages answered 400, 403 or 404, a page after the first 410, or a page
   * held a record that is not the patient's, of which nothing is kept.
   */
  readonly denied: readonly Search[];
  /** The C-CDA documents its DocumentReferences hold, where one holds any: each read, or said why not. */
  readonly documents?: readonly PulledDocument[];
}

export interface PullOptions {
  readonly limits?: Partial<Limits>;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
}

const REFERENCE = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})$/;
const NOT_SERVED = new Set([403, 404, 410]);
const SEARCH_REFUSED = new Set([400, 403, 404]);
const LATER_PAGE_REFUSED = new Set([...SEARCH_REFUSED, 410]);

/** Whether the resource is the patient, or names them as its `subject` or `patient`, relative or under the base. */
function isPatients(resource: unknown, base: string, patient: string): boolean {
  if (typeof resource !== "object" || resource === null) return false;
  const {
    resourceType,
    id,
    subject,
    patient: named,
  } = resource as Record<string, unknown>;
  if (resourceType === "Patient") return id === patient;
  const { reference } = (subject ?? named ?? {}) as { reference?: unknown };
  if (typeof reference !== "string") return false;
  const relative = reference.startsWith(`${base}/`)
    ? reference.slice(base.length + 1)
    : reference;
  return relative.replace(/\/_history\/[^/]+$/, "") === `Patient/${patient}`;
}

/** Every `reference` string anywhere in the value. */
function references(value: unknown, found: string[]): string[] {
  if (Array.isArray(value)) for (const item of value) references(item, found);
  else if (typeof value === "object" && value !== null)
    for (const [key, item] of Object.entries(value))
      if (key === "reference" && typeof item === "string") found.push(item);
      else references(item, found);
  return found;
}

const EXPIRED_DESCRIPTION = /^the access token (has )?expired\.?$/i;

const saysExpired = (challenge: string): boolean => {
  const parameter =
    /(?:^|[\s,])error_description=(?:"([^"]*)"|([^\s,"]*))/i.exec(challenge);
  return EXPIRED_DESCRIPTION.test(parameter?.[1] ?? parameter?.[2] ?? "");
};

/**
 * Pulls the connected patient's records: the Patient read by id, one search per entry of the plan with each `next`
 * link followed as given, then each missing reference of a backfill type read by id. Every data request goes to the
 * FHIR base's origin, and only there with the bearer token.
 */
export async function pull(
  connection: Connection,
  plan: QueryPlan,
  options: PullOptions = {},
): Promise<Pull> {
  const { token, fetch } = held(connection);
  const now = options.now ?? (() => new Date());
  const requests = new Requests(fetch, limited(options.limits), options.signal);
  const base = connection.fhirBase;
  const origin = new URL(base).origin;
  const patient = encodeURIComponent(connection.patient);
  const entries = new Map<string, PulledEntry>();
  const missing: string[] = [];
  const denied: Search[] = [];
  let retrievedAt = now();

  const get = async (
    url: URL,
    what: string,
  ): Promise<{ answer: Answer; url: URL }> => {
    if (url.origin !== origin)
      throw new ConnectionFailure(
        "host-not-allowed",
        `a request for ${what} would go to ${url.origin}, not the FHIR base's origin`,
        { origin: url.origin, resourceType: what },
      );
    const answer = await requests.send(url, {
      what,
      headers: {
        Accept: "application/fhir+json",
        Authorization: `Bearer ${token}`,
      },
      retry: true,
      follow: origin,
    });
    retrievedAt = now();
    if (answer.status === 401) {
      const expired =
        saysExpired(answer.headers.get("WWW-Authenticate") ?? "") ||
        (connection.expiresAt !== undefined &&
          connection.expiresAt.getTime() <= retrievedAt.getTime());
      throw new ConnectionFailure(
        "unauthorized",
        expired
          ? `${origin} refused ${what} with 401: the access token expired, so connect again`
          : `${origin} refused ${what} with 401: the hospital did not accept the access token (it may have expired or been revoked), so connect again`,
        { origin, status: 401, resourceType: what },
      );
    }
    return { answer, url };
  };
  const getDocument = async (url: URL): Promise<{ answer: Answer }> => {
    const answer = await requests.send(url, {
      what: "a C-CDA document",
      headers: {
        Accept:
          "application/xml, application/cda+xml, application/fhir+json;q=0.5",
        Authorization: `Bearer ${token}`,
      },
      retry: true,
      follow: origin,
    });
    retrievedAt = now();
    if (answer.status === 401)
      throw new ConnectionFailure(
        "unauthorized",
        `${origin} refused a C-CDA document with 401: the hospital did not accept the access token, so connect again`,
        { origin, status: 401, resourceType: "Binary" },
      );
    return { answer };
  };
  const failed = (answer: Answer, what: string) =>
    new ConnectionFailure(
      "hospital-error",
      `${origin} answered ${answer.status} to ${what}`,
      { origin, status: answer.status, resourceType: what },
    );
  const keep = (resource: unknown, what: string): void => {
    const { resourceType, id } = (resource ?? {}) as Record<string, unknown>;
    if (
      typeof resourceType !== "string" ||
      typeof id !== "string" ||
      !RESOURCE_TYPE.test(resourceType) ||
      !FHIR_ID.test(id)
    )
      throw new ConnectionFailure(
        "hospital-error",
        `${origin}'s answer for ${what} holds a resource with no FHIR type and id`,
        { origin, resourceType: what },
      );
    const key = `${resourceType}/${id}`;
    if (!entries.has(key))
      entries.set(key, {
        fullUrl: `${base}/${key}`,
        resource: resource as object,
      });
  };

  const read = await get(new URL(`${base}/Patient/${patient}`), "Patient");
  if (read.answer.status !== 200) throw failed(read.answer, "Patient");
  keep(parsed(read.answer, read.url, "Patient"), "Patient");

  for (const search of plan.searches) {
    const first = new URL(`${base}/${search.type}`);
    first.searchParams.set("patient", connection.patient);
    if (search.category !== undefined)
      first.searchParams.set("category", search.category);
    const pages = new Set<string>();
    let next: URL | undefined = first;
    while (next !== undefined) {
      if (pages.has(next.href))
        throw new ConnectionFailure(
          "hospital-error",
          `${origin}'s next link for ${search.type} goes back to a page already read`,
          { origin, resourceType: search.type },
        );
      pages.add(next.href);
      const { answer, url } = await get(next, search.type);
      if (
        (pages.size > 1 ? LATER_PAGE_REFUSED : SEARCH_REFUSED).has(
          answer.status,
        )
      ) {
        denied.push(search);
        break;
      }
      if (answer.status !== 200) throw failed(answer, search.type);
      const page = parsed(answer, url, search.type);
      const found = (Array.isArray(page.entry) ? page.entry : []).flatMap(
        (entry: unknown) => {
          if (typeof entry !== "object" || entry === null) return [];
          const { resource, search: mode } = entry as Record<string, unknown>;
          return (mode as { mode?: unknown } | undefined)?.mode === "outcome" ||
            (resource as { resourceType?: unknown } | undefined)
              ?.resourceType === "OperationOutcome"
            ? []
            : [resource];
        },
      );
      if (
        !found.every((resource) =>
          isPatients(resource, base, connection.patient),
        )
      ) {
        denied.push(search);
        break;
      }
      for (const resource of found) keep(resource, search.type);
      next = nextOf(page, url, search.type, origin);
    }
  }

  const wanted = new Set(plan.backfill);
  const asked = new Set<string>();
  for (const reference of references(
    [...entries.values()].map(({ resource }) => resource),
    [],
  )) {
    const relative = reference.startsWith(`${base}/`)
      ? reference.slice(base.length + 1)
      : reference;
    const match = REFERENCE.exec(relative);
    if (match === null || !wanted.has(match[1]!)) continue;
    if (entries.has(relative) || asked.has(relative)) continue;
    asked.add(relative);
    const { answer, url } = await get(
      new URL(`${base}/${relative}`),
      match[1]!,
    );
    if (NOT_SERVED.has(answer.status)) missing.push(reference);
    else if (answer.status !== 200) throw failed(answer, match[1]!);
    else keep(parsed(answer, url, match[1]!), match[1]!);
  }

  const documents: PulledDocument[] = [];
  const readAt = new Map<
    string,
    Pick<PulledDocument, "retrievedFrom" | "bytes" | "notRead">
  >();
  for (const { fullUrl, resource } of [...entries.values()]) {
    const documentReference = fullUrl.slice(base.length + 1);
    for (const { content, attachment } of ccdaContents(
      resource as Record<string, unknown>,
    )) {
      const url =
        typeof attachment.url === "string" ? attachment.url : undefined;
      const said = {
        documentReference,
        content,
        ...(url !== undefined && { url }),
      };
      if (typeof attachment.data === "string") {
        const bytes = decoded(attachment.data);
        documents.push(
          bytes !== undefined && isCcda(bytes)
            ? { ...said, retrievedFrom: fullUrl, bytes }
            : { ...said, notRead: "its inline data is no C-CDA document" },
        );
        continue;
      }
      if (url === undefined) {
        documents.push({ ...said, notRead: "it gives neither data nor a url" });
        continue;
      }
      let at: URL;
      try {
        at = new URL(iriSafe(new URL(url, `${base}/`).href));
      } catch {
        documents.push({ ...said, notRead: "its url is no address" });
        continue;
      }
      if (at.username !== "" || at.password !== "") {
        documents.push({
          ...said,
          notRead: "its url carries a user name or password",
        });
        continue;
      }
      const already = readAt.get(at.href);
      if (already !== undefined) {
        documents.push({ ...said, ...already });
        continue;
      }
      if (at.origin !== origin) {
        documents.push({
          ...said,
          notRead: `it is at ${at.origin}, not the FHIR base's origin, where the token is not sent`,
        });
        continue;
      }
      let answer: Answer;
      try {
        ({ answer } = await getDocument(at));
      } catch (error) {
        if (
          !(error instanceof ConnectionFailure) ||
          error.kind === "unauthorized" ||
          error.kind === "cancelled"
        )
          throw error;
        readAt.set(at.href, { notRead: error.message });
        documents.push({ ...said, notRead: error.message });
        continue;
      }
      const bytes = answer.status === 200 ? fromAnswer(answer) : undefined;
      const read =
        answer.status !== 200
          ? { notRead: `the hospital answered ${answer.status}` }
          : bytes !== undefined && isCcda(bytes)
            ? { retrievedFrom: at.href, bytes }
            : { notRead: "the hospital's answer is no C-CDA document" };
      readAt.set(at.href, read);
      documents.push({ ...said, ...read });
    }
  }

  return {
    fhirBase: base,
    patient: connection.patient,
    source: connection.row.name,
    retrievedAt: retrievedAt.toISOString().replace(/\.?0+Z$/, "Z"),
    bundle: {
      resourceType: "Bundle",
      type: "collection",
      entry: [...entries.values()],
    },
    missing,
    searches: plan.searches,
    denied,
    ...(documents.length > 0 && { documents }),
  };
}

/** The bytes a base64 string holds, or undefined where it is no canonical base64. */
function decoded(data: string): Uint8Array | undefined {
  try {
    const text = atob(data);
    return Uint8Array.from(text, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** A document's bytes from the hospital's answer: the body as sent, or a Binary resource's data. */
function fromAnswer(answer: Answer): Uint8Array | undefined {
  if (!/json/i.test(answer.headers.get("Content-Type") ?? ""))
    return answer.body;
  try {
    const binary = JSON.parse(new TextDecoder().decode(answer.body)) as {
      resourceType?: unknown;
      data?: unknown;
    };
    return binary.resourceType === "Binary" && typeof binary.data === "string"
      ? decoded(binary.data)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The URL with each character the IRI grammar refuses, and a URL leaves as written (`|`, `^`, `\``, `{`, `}`),
 * percent-encoded, so that it is the IRI `pav:retrievedFrom` states.
 */
function iriSafe(href: string): string {
  return [...href]
    .map((character) =>
      character.charCodeAt(0) <= 0x20 || '<>"{}|^`\\'.includes(character)
        ? encodeURIComponent(character)
        : character,
    )
    .join("");
}

/**
 * Whether the bytes read as XML whose root is a CDA ClinicalDocument. A document type declaration before the root,
 * even one that declares no entity, is refused on purpose: no DTD reaches the Bridge by this path.
 */
function isCcda(bytes: Uint8Array): boolean {
  return /^(\uFEFF)?\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<(\w+:)?ClinicalDocument[\s>/]/.test(
    new TextDecoder().decode(bytes.subarray(0, 4096)),
  );
}

/** The page's `next` link, exactly as given, resolved only if it is relative. */
function nextOf(
  page: Record<string, unknown>,
  url: URL,
  what: string,
  origin: string,
): URL | undefined {
  const links = Array.isArray(page.link) ? page.link : [];
  const link = links.find(
    (l): l is { url: unknown } =>
      typeof l === "object" && l !== null && l.relation === "next",
  );
  if (link === undefined) return undefined;
  if (typeof link.url !== "string")
    throw new ConnectionFailure(
      "hospital-error",
      `${origin}'s next link for ${what} has no address`,
      { origin, resourceType: what },
    );
  try {
    return new URL(link.url, url);
  } catch {
    throw new ConnectionFailure(
      "hospital-error",
      `${origin}'s next link for ${what} is not an address`,
      { origin, resourceType: what },
    );
  }
}
