import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { before, test } from "node:test";
import { Refusal } from "@cascade-runtime/runtime";
import {
  type Bundle,
  demoHospital,
  type DemoHospital,
  type DemoHospitalOptions,
} from "@cascade-runtime/demo-hospital";
import { loadHospital } from "@cascade-runtime/demo-hospital/node";
import {
  connect,
  type ConnectOptions,
  ConnectionFailure,
  DEMO_PLAN,
  type DirectoryRow,
  type FailureKind,
  type Limits,
  pull,
  type Pull,
  type QueryPlan,
  type Registration,
  type SignIn,
  loopbackSignIn,
} from "cascade-runtime";

const A_NORTH = "pt-1001";
const B_NORTH = "pt-1002";
const FAST: Partial<Limits> = { retryDelayMs: 0 };
const REGISTRATION: Registration = {
  clientId: "cascade-test-app",
  redirectUri: "https://app.test.invalid/callback",
  scopes: ["launch/patient", "patient/*.rs", "patient/*.read"],
};

type Loaded = Omit<DemoHospitalOptions, "autoApprove" | "now">;
let north: Loaded;
let south: Loaded;
let row: DirectoryRow;
let happy: Pull;

/** Every request a test's `fetch` sent, and every token and code it saw come back. */
interface Seen {
  readonly requests: Request[];
  readonly secrets: Set<string>;
}

type Fetch = typeof globalThis.fetch;
type Answer = (request: Request) => Promise<Response>;
/** Changes what a hospital answers: given the request and the hospital, gives the response. */
type Alter = (request: Request, hospital: Answer) => Promise<Response>;

/** A `fetch` that sends each demo hospital's origin to its function and refuses every other address. */
function routed(
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
      const body = (await response.clone().json()) as { access_token?: string };
      if (body.access_token) seen.secrets.add(body.access_token);
    }
    return response;
  };
}

/** A sign-in that hands the authorize URL to the hospital, which approves at once, and follows its redirect. */
function direct(fetch: Fetch): SignIn {
  return async (authorize) => {
    const response = await fetch(authorize, { redirect: "manual" });
    return new URL(response.headers.get("Location")!);
  };
}

interface Setup {
  readonly alter?: Alter;
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

async function pulled(setup: Setup = {}): Promise<{ pull: Pull; seen: Seen }> {
  const seen: Seen = { requests: [], secrets: new Set() };
  const hospital = demoHospital({
    ...north,
    autoApprove: "autoApprove" in setup ? setup.autoApprove : A_NORTH,
    ...(setup.now ? { now: setup.now } : {}),
  });
  const fetch = routed(
    [hospital],
    [new URL(north.hospital.fhirBase).origin],
    seen,
    setup.alter,
  );
  try {
    const connection = await connect(row, setup.registration ?? REGISTRATION, {
      signIn: (setup.signIn ?? direct)(fetch),
      fetch,
      ...setup.connectOptions,
    });
    setup.between?.();
    const result = await pull(connection, setup.plan ?? DEMO_PLAN, {
      limits: { ...FAST, ...setup.limits },
    });
    return { pull: result, seen };
  } catch (error) {
    throw Object.assign(error as object, { seen });
  }
}

function keyed(bundle: Bundle): Map<string, unknown> {
  return new Map(
    (bundle.entry ?? []).map(({ resource }) => [
      `${resource.resourceType}/${resource.id}`,
      resource,
    ]),
  );
}

function keysOf(result: Pull): string[] {
  return result.bundle.entry.map(({ fullUrl }) =>
    fullUrl.slice(`${result.fhirBase}/`.length),
  );
}

async function freePort(): Promise<{ port: number; server: Server }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  return { port: address.port, server };
}

/** Rewrites a search page's `next` link. */
function nextRewritten(to: (next: URL) => URL): Alter {
  return async (request, hospital) => {
    const response = await hospital(request);
    if (!response.headers.get("Content-Type")?.includes("fhir"))
      return response;
    const body = (await response.json()) as {
      link?: { relation: string; url: string }[];
    };
    for (const link of body.link ?? [])
      if (link.relation === "next") link.url = to(new URL(link.url)).href;
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: response.headers,
    });
  };
}

function isSearch(request: Request, type: string): boolean {
  const url = new URL(request.url);
  return url.pathname.endsWith(`/${type}`) && url.searchParams.has("patient");
}

before(async () => {
  north = await loadHospital("cascade-north");
  south = await loadHospital("cascade-south");
  row = {
    name: north.hospital.name,
    vendor: "demo",
    fhirBase: north.hospital.fhirBase,
  };
  happy = (await pulled()).pull;
});

test("a pull from North signed in as patient A holds A's North record, each resource once and as the hospital sent it", async () => {
  const { pull: result, seen } = await pulled();
  assert.equal(result.patient, A_NORTH);
  assert.equal(result.fhirBase, north.hospital.fhirBase);
  const expected = keyed(north.patients[A_NORTH]!);
  assert.deepEqual(keysOf(result).sort(), [...expected.keys()].sort());
  for (const { fullUrl, resource } of result.bundle.entry)
    assert.deepEqual(
      resource,
      expected.get(fullUrl.slice(`${result.fhirBase}/`.length)),
    );
  const elsewhere = [
    ...keyed(north.patients[B_NORTH]!).values(),
    ...Object.values(south.patients).flatMap((b) => [...keyed(b).values()]),
  ].map((other) => JSON.stringify(other));
  for (const { resource } of result.bundle.entry)
    assert.ok(!elsewhere.includes(JSON.stringify(resource)));
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.denied, []);

  const urls = seen.requests.map((r) => new URL(r.url));
  const [hidden] = north.hospital.hiddenFromSearch;
  assert.ok(urls.some((u) => u.pathname.endsWith(`/${hidden}`)));
  assert.ok(urls.some((u) => u.searchParams.has("_page")));
  const searches = urls
    .filter((u) => u.searchParams.has("patient"))
    .map((u) => u.href);
  assert.equal(new Set(searches).size, searches.length);
  const origin = new URL(north.hospital.fhirBase).origin;
  assert.ok(urls.every((u) => u.origin === origin));
  const token = seen.requests.findIndex((r) =>
    new URL(r.url).pathname.endsWith("/token"),
  );
  seen.requests.forEach((r, at) =>
    assert.equal(r.headers.has("Authorization"), at > token, r.url),
  );
});

test("a pull retries a 503, a 429 and a transport error and gets the same records", async () => {
  const failed = new Set<string>();
  const once =
    (type: string, answer: () => Promise<Response>): Alter =>
    async (request, hospital) => {
      if (isSearch(request, type) && !failed.has(type)) {
        failed.add(type);
        return answer();
      }
      return hospital(request);
    };
  const alters = [
    once("Condition", async () => new Response(null, { status: 503 })),
    once(
      "AllergyIntolerance",
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "0" } }),
    ),
    once("Immunization", () => Promise.reject(new TypeError("reset"))),
  ];
  const { pull: result } = await pulled({
    alter: (request, hospital) =>
      alters.reduce<Answer>(
        (next, alter) => (r) => alter(r, next),
        hospital,
      )(request),
  });
  assert.equal(failed.size, 3);
  assert.deepEqual(keysOf(result).sort(), keysOf(happy).sort());
});

test("a loopback sign-in takes the redirect with the state sent, ignores another, and closes", async () => {
  const { port, server } = await freePort();
  await new Promise((resolve) => server.close(resolve));
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const strays: number[] = [];
  const { pull: result } = await pulled({
    registration: { ...REGISTRATION, redirectUri },
    signIn: (fetch) =>
      loopbackSignIn({
        open: async (authorize) => {
          strays.push(
            (await globalThis.fetch(`${redirectUri}?code=x&state=other`))
              .status,
          );
          const approved = await fetch(authorize, { redirect: "manual" });
          await globalThis.fetch(approved.headers.get("Location")!);
        },
      }),
  });
  assert.deepEqual(strays, [400]);
  assert.equal(result.patient, A_NORTH);
  await assert.rejects(globalThis.fetch(redirectUri));
});

test("connecting and pulling end in a typed outcome, never a Refusal, carrying no secret", async () => {
  let clock = new Date();
  const later: Setup = {
    now: () => clock,
    between: () => {
      clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
    },
  };
  const swapState: (fetch: Fetch) => SignIn = (fetch) => async (a) => {
    const back = await direct(fetch)(a);
    back.searchParams.set("state", "another");
    return back;
  };
  const occupied = await freePort();
  const rows: [string, () => Setup, FailureKind][] = [
    [
      "the sign-in page's Cancel",
      () => ({
        autoApprove: undefined,
        signIn: (fetch) => async (authorize) => {
          const form = new URLSearchParams(authorize.searchParams);
          form.set("patient", A_NORTH);
          form.set("decision", "cancel");
          const response = await fetch(authorize.origin + authorize.pathname, {
            method: "POST",
            body: form,
            redirect: "manual",
          });
          return new URL(response.headers.get("Location")!);
        },
      }),
      "cancelled",
    ],
    [
      "the caller's signal aborted",
      () => ({ connectOptions: { signal: AbortSignal.abort() } }),
      "cancelled",
    ],
    [
      "the sign-in returns another state",
      () => ({ signIn: swapState }),
      "state-mismatch",
    ],
    [
      "the sign-in returns access_denied with another state",
      () => ({
        signIn: () => async () =>
          new URL(`${REGISTRATION.redirectUri}?error=access_denied&state=x`),
      }),
      "state-mismatch",
    ],
    [
      "the sign-in returns a URL off the redirect URI",
      () => ({
        signIn: (fetch) => async (a) => {
          const back = await direct(fetch)(a);
          back.pathname = "/elsewhere";
          return back;
        },
      }),
      "state-mismatch",
    ],
    [
      "a next link to another host",
      () => ({
        alter: nextRewritten((u) => {
          u.hostname = "elsewhere.demo.invalid";
          return u;
        }),
      }),
      "host-not-allowed",
    ],
    [
      "a next link over http:",
      () => ({
        alter: nextRewritten(
          (u) => new URL(u.href.replace(/^https:/, "http:")),
        ),
      }),
      "host-not-allowed",
    ],
    [
      "a redirect from a search to another host",
      () => ({
        alter: async (request, hospital) =>
          isSearch(request, "Condition")
            ? new Response(null, {
                status: 302,
                headers: {
                  Location: "https://elsewhere.demo.invalid/fhir/Condition",
                },
              })
            : hospital(request),
      }),
      "host-not-allowed",
    ],
    [
      "responseBytes below one page",
      () => ({ limits: { responseBytes: 200 } }),
      "cap-exceeded",
    ],
    [
      "requests below the plan's count",
      () => ({ limits: { requests: 3 } }),
      "cap-exceeded",
    ],
    ["the token's hour past before the pull", () => later, "unauthorized"],
    [
      "a search always answered 503",
      () => ({
        limits: { retries: 1 },
        alter: async (request, hospital) =>
          isSearch(request, "Condition")
            ? new Response(null, { status: 503 })
            : hospital(request),
      }),
      "retries-exhausted",
    ],
    [
      "the loopback's port already in use",
      () => ({
        registration: {
          ...REGISTRATION,
          redirectUri: `http://127.0.0.1:${occupied.port}/callback`,
        },
        signIn: () => loopbackSignIn({ open: () => undefined }),
      }),
      "sign-in-unavailable",
    ],
    [
      "discovery without S256",
      () => ({
        alter: async (request, hospital) => {
          const response = await hospital(request);
          if (!request.url.endsWith("/.well-known/smart-configuration"))
            return response;
          const body = (await response.json()) as Record<string, unknown>;
          body.code_challenge_methods_supported = ["plain"];
          return Response.json(body);
        },
      }),
      "hospital-error",
    ],
    [
      "a type North does not serve",
      () => ({ plan: { searches: [{ type: "Procedure" }], backfill: [] } }),
      "hospital-error",
    ],
  ];
  try {
    for (const [change, setup, kind] of rows) {
      const failure = await pulled(setup()).then(
        () => assert.fail(`${change}: no failure`),
        (error: unknown) => error,
      );
      assert.ok(failure instanceof ConnectionFailure, change);
      assert.ok(!(failure instanceof Refusal), change);
      assert.equal(failure.kind, kind, change);
      assert.equal(failure.cause, undefined, change);
      const { seen, ...shown } = failure as ConnectionFailure & { seen: Seen };
      const text = `${failure.message} ${JSON.stringify(shown)}`;
      for (const secret of seen.secrets)
        assert.ok(!text.includes(secret), `${change}: carries a secret`);
    }
  } finally {
    occupied.server.close();
  }
});
