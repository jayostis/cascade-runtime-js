import { type Connection, held, trimmed } from "./connect.js";
import { ConnectionFailure } from "./outcome.js";
import { LIMITS, type Limits, type QueryPlan, type Search } from "./plan.js";
import { type Answer, parsed, Requests } from "./requests.js";

export interface PulledEntry {
  /** `<fhirBase>/<type>/<id>`. */
  readonly fullUrl: string;
  /** The resource exactly as the hospital sent it. */
  readonly resource: object;
}

/** A patient's records as one pull from one hospital found them: what an import is made from. */
export interface Pull {
  /** The directory row's FHIR base, as given: the `bridge:serverBaseUrl` the adapter names records from. */
  readonly fhirBase: string;
  /** The patient, by the hospital's id. */
  readonly patient: string;
  /** When the last response arrived, as an `xsd:dateTime`. */
  readonly retrievedAt: string;
  /** Each distinct resource once, by type and id, the first seen kept. */
  readonly bundle: {
    readonly resourceType: "Bundle";
    readonly type: "collection";
    readonly entry: readonly PulledEntry[];
  };
  /** References of a backfill type the hospital would not serve, as the records wrote them. */
  readonly missing: readonly string[];
  /** Searches the hospital answered with 403. */
  readonly denied: readonly Search[];
}

export interface PullOptions {
  readonly limits?: Partial<Limits>;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
}

const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;
const REFERENCE = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})$/;
const NOT_SERVED = new Set([403, 404, 410]);

/** Every `reference` string anywhere in the value. */
function references(value: unknown, found: string[]): string[] {
  if (Array.isArray(value)) for (const item of value) references(item, found);
  else if (typeof value === "object" && value !== null)
    for (const [key, item] of Object.entries(value))
      if (key === "reference" && typeof item === "string") found.push(item);
      else references(item, found);
  return found;
}

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
  const requests = new Requests(
    fetch,
    { ...LIMITS, ...options.limits },
    options.signal,
  );
  const base = trimmed(connection.fhirBase);
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
    if (answer.status === 401)
      throw new ConnectionFailure(
        "unauthorized",
        `${origin} answered 401 to ${what}`,
        { origin, status: 401, resourceType: what },
      );
    return { answer, url };
  };
  const failed = (answer: Answer, what: string) =>
    new ConnectionFailure(
      "hospital-error",
      `${origin} answered ${answer.status} to ${what}`,
      { origin, status: answer.status, resourceType: what },
    );
  const keep = (resource: unknown): void => {
    if (typeof resource !== "object" || resource === null) return;
    const { resourceType, id } = resource as Record<string, unknown>;
    if (typeof resourceType !== "string" || typeof id !== "string") return;
    if (!FHIR_ID.test(id)) return;
    const key = `${resourceType}/${id}`;
    if (!entries.has(key))
      entries.set(key, { fullUrl: `${base}/${key}`, resource });
  };

  const read = await get(new URL(`${base}/Patient/${patient}`), "Patient");
  if (read.answer.status !== 200) throw failed(read.answer, "Patient");
  keep(parsed(read.answer, read.url, "Patient"));

  for (const search of plan.searches) {
    const first = new URL(`${base}/${search.type}`);
    first.searchParams.set("patient", connection.patient);
    if (search.category !== undefined)
      first.searchParams.set("category", search.category);
    let next: URL | undefined = first;
    while (next !== undefined) {
      const { answer, url } = await get(next, search.type);
      if (answer.status === 403) {
        denied.push(search);
        break;
      }
      if (answer.status !== 200) throw failed(answer, search.type);
      const page = parsed(answer, url, search.type);
      for (const entry of Array.isArray(page.entry) ? page.entry : []) {
        if (typeof entry !== "object" || entry === null) continue;
        const { resource, search: mode } = entry as Record<string, unknown>;
        if ((mode as { mode?: unknown } | undefined)?.mode === "outcome")
          continue;
        keep(resource);
      }
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
    else keep(parsed(answer, url, match[1]!));
  }

  return {
    fhirBase: connection.fhirBase,
    patient: connection.patient,
    retrievedAt: retrievedAt.toISOString(),
    bundle: {
      resourceType: "Bundle",
      type: "collection",
      entry: [...entries.values()],
    },
    missing,
    denied,
  };
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
