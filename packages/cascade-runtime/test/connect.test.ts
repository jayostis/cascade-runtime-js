import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { before, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { Refusal } from "@cascade-runtime/runtime";
import { type Bundle } from "@cascade-runtime/demo-hospital";
import { loadHospital } from "@cascade-runtime/demo-hospital/node";
import {
  ConnectionFailure,
  type DirectoryRow,
  type FailureKind,
  type Pull,
  type SignIn,
  loopbackSignIn,
} from "cascade-runtime";
import {
  type Alter,
  type Answer,
  direct,
  type Fetch,
  type Loaded,
  pulled as pulledAt,
  REGISTRATION,
  rowOf,
  type Seen,
  type Setup,
} from "./hospitals.js";

const A_NORTH = "pt-1001";
const B_NORTH = "pt-1002";

let north: Loaded;
let south: Loaded;
let row: DirectoryRow;
let happy: { pull: Pull; seen: Seen };

function pulled(setup: Setup = {}): Promise<{ pull: Pull; seen: Seen }> {
  return pulledAt(north, A_NORTH, setup);
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

/** Changes the JSON body of each answer to a request `which` picks. */
function rewritten(
  which: (request: Request) => boolean,
  change: (body: Record<string, unknown>, request: Request) => void,
): Alter {
  return async (request, hospital) => {
    const response = await hospital(request);
    if (!which(request)) return response;
    const body = (await response.json()) as Record<string, unknown>;
    change(body, request);
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: response.headers,
    });
  };
}

function firstResource(body: Record<string, unknown>): Record<string, unknown> {
  return (body.entry as { resource: Record<string, unknown> }[])[0]!.resource;
}

const isToken = (request: Request) =>
  new URL(request.url).pathname.endsWith("/token");

function isSearch(request: Request, type: string): boolean {
  const url = new URL(request.url);
  return url.pathname.endsWith(`/${type}`) && url.searchParams.has("patient");
}

before(async () => {
  north = await loadHospital("cascade-north");
  south = await loadHospital("cascade-south");
  row = rowOf(north);
  happy = await pulled();
});

test("a pull from North signed in as patient A holds A's North record, each resource once and as the hospital sent it", async () => {
  const { pull: result, seen } = happy;
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
  ];
  for (const { resource } of result.bundle.entry)
    assert.ok(!elsewhere.some((other) => isDeepStrictEqual(other, resource)));
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

test("a pull retries a 503, a 429 and a transport error, and from a base written with a trailing slash names everything without it", async () => {
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
    row: { ...row, fhirBase: `${row.fhirBase}/` },
    limits: { retries: undefined },
    alter: (request, hospital) =>
      alters.reduce<Answer>(
        (next, alter) => (r) => alter(r, next),
        hospital,
      )(request),
  });
  assert.equal(failed.size, 3);
  assert.equal(result.fhirBase, row.fhirBase);
  assert.deepEqual(
    result.bundle.entry.map(({ fullUrl }) => fullUrl).sort(),
    happy.pull.bundle.entry.map(({ fullUrl }) => fullUrl).sort(),
  );
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
  const spare = await freePort();
  await new Promise((resolve) => spare.server.close(resolve));
  const rows: [string, () => Setup, FailureKind, RegExp?][] = [
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
      "the loopback cannot open the sign-in page",
      () => ({
        registration: {
          ...REGISTRATION,
          redirectUri: `http://127.0.0.1:${spare.port}/callback`,
        },
        signIn: () =>
          loopbackSignIn({
            open: () => {
              throw new Error("no browser");
            },
          }),
      }),
      "sign-in-unavailable",
    ],
    [
      "a FHIR base that is no address",
      () => ({ row: { ...row, fhirBase: "not an address" } }),
      "hospital-error",
    ],
    [
      "a FHIR base with a query",
      () => ({ row: { ...row, fhirBase: `${row.fhirBase}?tenant=a` } }),
      "hospital-error",
    ],
    [
      "a redirect URI that is no address",
      () => ({
        registration: { ...REGISTRATION, redirectUri: "not an address" },
      }),
      "sign-in-unavailable",
    ],
    [
      "the token endpoint answers 502 with a page",
      () => ({
        alter: async (request, hospital) =>
          isToken(request)
            ? new Response("<html>Bad gateway</html>", {
                status: 502,
                headers: { "Content-Type": "text/html" },
              })
            : hospital(request),
      }),
      "hospital-error",
      /refused the token exchange with 502/,
    ],
    [
      "the token endpoint cannot be reached",
      () => ({
        alter: async (request, hospital) =>
          isToken(request)
            ? Promise.reject(new TypeError("reset"))
            : hospital(request),
      }),
      "retries-exhausted",
    ],
    [
      "the token's patient is not a FHIR id",
      () => ({
        alter: rewritten(isToken, (body) => {
          body.patient = "pt 1001!";
        }),
      }),
      "hospital-error",
      /token response/,
    ],
    [
      "a searched resource whose id is not a FHIR id",
      () => ({
        alter: rewritten(
          (request) => isSearch(request, "Condition"),
          (body) => {
            firstResource(body).id = "not an id!";
          },
        ),
      }),
      "hospital-error",
    ],
    [
      "a searched resource whose type is not a FHIR type",
      () => ({
        alter: rewritten(
          (request) => isSearch(request, "Condition"),
          (body) => {
            firstResource(body).resourceType = "Condition/x";
          },
        ),
      }),
      "hospital-error",
    ],
    [
      "a next link back to the page it is on",
      () => ({
        alter: rewritten(
          (request) => isSearch(request, "Condition"),
          (body, request) => {
            body.link = [{ relation: "next", url: request.url }];
          },
        ),
      }),
      "hospital-error",
      /next link/,
    ],
    [
      "a redirect a browser hides the address of",
      () => ({
        alter: async (request, hospital) =>
          isSearch(request, "Condition") ? Response.error() : hospital(request),
      }),
      "hospital-error",
      /browser/,
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
      () => ({
        plan: { searches: [{ type: "DocumentReference" }], backfill: [] },
      }),
      "hospital-error",
    ],
  ];
  try {
    for (const [change, setup, kind, message] of rows) {
      const failure = await pulled(setup()).then(
        () => assert.fail(`${change}: no failure`),
        (error: unknown) => error,
      );
      assert.ok(failure instanceof ConnectionFailure, change);
      assert.ok(!(failure instanceof Refusal), change);
      assert.equal(failure.kind, kind, change);
      if (message) assert.match(failure.message, message, change);
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
