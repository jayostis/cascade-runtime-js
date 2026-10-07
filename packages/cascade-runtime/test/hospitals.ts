import {
  demoHospital,
  type DemoHospital,
  type DemoHospitalOptions,
} from "@cascade-runtime/demo-hospital";
import {
  connect,
  type ConnectOptions,
  DEMO_PLAN,
  type DirectoryRow,
  type Limits,
  pull,
  type Pull,
  type QueryPlan,
  type Registration,
  type SignIn,
} from "cascade-runtime";

export const FAST: Partial<Limits> = { retryDelayMs: 0 };
export const REGISTRATION: Registration = {
  clientId: "cascade-test-app",
  redirectUri: "https://app.test.invalid/callback",
  scopes: ["launch/patient", "patient/*.rs", "patient/*.read"],
};

export type Loaded = Omit<DemoHospitalOptions, "autoApprove" | "now">;

/** Every request a test's `fetch` sent, and every token and code it saw come back. */
export interface Seen {
  readonly requests: Request[];
  readonly secrets: Set<string>;
}

export type Fetch = typeof globalThis.fetch;
export type Answer = (request: Request) => Promise<Response>;
/** Changes what a hospital answers: given the request and the hospital, gives the response. */
export type Alter = (request: Request, hospital: Answer) => Promise<Response>;

/** The directory row of a demo hospital. */
export function rowOf({ hospital }: Loaded): DirectoryRow {
  return { name: hospital.name, vendor: "demo", fhirBase: hospital.fhirBase };
}

/** A `fetch` that sends each demo hospital's origin to its function and refuses every other address. */
export function routed(
  hospitals: readonly DemoHospital[],
  origins: readonly string[],
  seen: Seen,
  alter: Alter = (request, hospital) => hospital(request),
): Fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    seen.requests.push(request.clone());
    const at = origins.indexOf(new URL(request.url).origin);
    if (at < 0) throw new TypeError(`no route to ${request.url}`);
    const response = await alter(request, hospitals[at]!);
    const location = response.headers.get("Location");
    const code = location && new URL(location).searchParams.get("code");
    if (code) seen.secrets.add(code);
    if (new URL(request.url).pathname.endsWith("/token")) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { access_token?: string };
      if (body.access_token) seen.secrets.add(body.access_token);
    }
    return response;
  };
}

/** A sign-in that hands the authorize URL to the hospital, which approves at once, and follows its redirect. */
export function direct(fetch: Fetch): SignIn {
  return async (authorize) => {
    const response = await fetch(authorize, { redirect: "manual" });
    return new URL(response.headers.get("Location")!);
  };
}

export interface Setup {
  readonly row?: DirectoryRow;
  readonly alter?: Alter;
  /** The patient the hospital approves at once; given as `undefined`, it shows its sign-in page. */
  readonly autoApprove?: string;
  readonly now?: () => Date;
  readonly signIn?: (fetch: Fetch) => SignIn;
  readonly registration?: Registration;
  readonly connectOptions?: Partial<ConnectOptions>;
  readonly limits?: Partial<Limits>;
  readonly plan?: QueryPlan;
  /** Runs between connecting and pulling. */
  readonly between?: () => void;
}

/** Signs in to the demo hospital as the patient and pulls with `DEMO_PLAN`, unless the setup says otherwise. */
export async function pulled(
  at: Loaded,
  patient: string,
  setup: Setup = {},
): Promise<{ pull: Pull; seen: Seen }> {
  const seen: Seen = { requests: [], secrets: new Set() };
  const hospital = demoHospital({
    ...at,
    autoApprove: "autoApprove" in setup ? setup.autoApprove : patient,
    ...(setup.now ? { now: setup.now } : {}),
  });
  const fetch = routed(
    [hospital],
    [new URL(at.hospital.fhirBase).origin],
    seen,
    setup.alter,
  );
  try {
    const connection = await connect(
      setup.row ?? rowOf(at),
      setup.registration ?? REGISTRATION,
      {
        signIn: (setup.signIn ?? direct)(fetch),
        fetch,
        ...setup.connectOptions,
      },
    );
    setup.between?.();
    const result = await pull(connection, setup.plan ?? DEMO_PLAN, {
      limits: { ...FAST, ...setup.limits },
    });
    return { pull: result, seen };
  } catch (error) {
    throw Object.assign(error as object, { seen });
  }
}
