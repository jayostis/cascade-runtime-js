/** A hospital an app can connect to. */
export interface DirectoryRow {
  readonly name: string;
  readonly vendor: string;
  /** The FHIR base, over `https:`: what names every record pulled from it. */
  readonly fhirBase: string;
}

/** Who the app is at one vendor, in one environment. */
export interface Registration {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

export interface Search {
  readonly type: string;
  readonly category?: string;
}

/** What to fetch from a vendor's hospitals, beside the Patient, which is always read by id. */
export interface QueryPlan {
  readonly searches: readonly Search[];
  /** The types whose references a search left unresolved are read by id. */
  readonly backfill: readonly string[];
}

export const DEMO_PLAN: QueryPlan = {
  searches: [
    { type: "Condition" },
    { type: "AllergyIntolerance" },
    { type: "MedicationRequest" },
    { type: "Immunization" },
    { type: "Procedure" },
    { type: "Encounter" },
    { type: "Observation", category: "laboratory" },
    { type: "Observation", category: "vital-signs" },
  ],
  backfill: ["Encounter"],
};

export interface Limits {
  /** Tries after the first, for a 429, a 5xx, a transport error or a timeout. */
  readonly retries: number;
  /** The first wait before a retry, doubled for each one after. */
  readonly retryDelayMs: number;
  /** The longest wait before a retry, a `Retry-After` included. */
  readonly maxRetryDelayMs: number;
  readonly requestTimeoutMs: number;
  /** One response's body. */
  readonly responseBytes: number;
  /** Every body one call reads. */
  readonly pullBytes: number;
  /** Every request one call sends, retries and redirects included. */
  readonly requests: number;
}

const MiB = 1024 * 1024;

export const LIMITS: Limits = {
  retries: 3,
  retryDelayMs: 500,
  maxRetryDelayMs: 8000,
  requestTimeoutMs: 30_000,
  responseBytes: 20 * MiB,
  pullBytes: 256 * MiB,
  requests: 2000,
};

/** The defaults, with each limit given replacing its own; one given as `undefined` keeps the default. */
export function limited(given: Partial<Limits> = {}): Limits {
  const limits: Record<string, number> = { ...LIMITS };
  for (const [name, value] of Object.entries(given))
    if (value !== undefined) limits[name] = value;
  return limits as unknown as Limits;
}
