import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { before, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { Refusal } from "@cascade-runtime/runtime";
import { type Bundle, recordsAt } from "@the-cascade-protocol/sandbox";
import { loadHospital } from "@the-cascade-protocol/sandbox/node";
import { answerSignIn } from "@the-cascade-protocol/sandbox/testing";
import {
  ConnectionFailure,
  connectFiles,
  pullFiles,
  DEMO_PLAN,
  type DirectoryRow,
  type FailureKind,
  type Pull,
  type SignIn,
  loopbackSignIn,
} from "cascade-runtime";
import {
  type Alter,
  type Answer,
  answering,
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

function pulled(setup: Setup = {}): ReturnType<typeof pulledAt> {
  return pulledAt(north, A_NORTH, setup);
}

function keyed(bundle: Bundle): Map<string, unknown> {
  return new Map(
    recordsAt(bundle).map((resource) => [
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

test("a pull from North signed in as patient A holds A's North record, each resource once and as the hospital sent it, with the plan's searches", async () => {
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
  assert.deepEqual(result.searches, DEMO_PLAN.searches);

  const urls = seen.requests.map((r) => new URL(r.url));
  const [hidden] = north.hospital.hiddenFromSearch;
  assert.ok(urls.some((u) => u.pathname.endsWith(`/${hidden}`)));
  assert.ok(urls.some((u) => u.searchParams.has("_page")));
  const searches = urls
    .filter((u) => u.searchParams.has("patient"))
    .map((u) => u.href);
  assert.equal(new Set(searches).size, searches.length);
  assert.ok(
    urls.some(
      (u) =>
        u.pathname.endsWith("/DiagnosticReport") &&
        u.searchParams.has("patient"),
    ),
    "the plan searches the hospital's diagnostic reports",
  );
  const origin = new URL(north.hospital.fhirBase).origin;
  assert.ok(urls.every((u) => u.origin === origin));
  const token = seen.requests.findIndex((r) =>
    new URL(r.url).pathname.endsWith("/token"),
  );
  seen.requests.forEach((r, at) =>
    assert.equal(r.headers.has("Authorization"), at > token, r.url),
  );
});

test("a search the hospital refuses (400, 403 or 404, a later page 410, or a page holding another patient's record) is in both searches and denied, keeps only the pages it answered for the patient, and the pull goes on; an OperationOutcome among the entries refuses nothing and is not kept", async () => {
  const search = (type: string) => ({ type }) as const;
  const unserved = search("CarePlan");
  const laterRefused = new Map([
    ["Condition", 403],
    ["Observation", 404],
    ["MedicationRequest", 410],
  ]);
  const plan = [
    unserved,
    ...[...laterRefused.keys()].map(search),
    search("Immunization"),
    search("Encounter"),
    search("AllergyIntolerance"),
  ];
  assert.ok(!north.hospital.types.includes(unserved.type));
  const typeOf = (request: Request) =>
    new URL(request.url).pathname.split("/").at(-1)!;
  const { pull: result } = await pulled({
    plan: { searches: plan, backfill: [] },
    alter: async (request, hospital) => {
      const type = typeOf(request);
      const later = laterRefused.get(type);
      if (later !== undefined && new URL(request.url).searchParams.has("page"))
        return new Response(null, { status: later });
      if (isSearch(request, "Immunization"))
        return new Response(null, { status: 400 });
      const response = await hospital(request);
      if (!isSearch(request, type)) return response;
      const body = (await response.json()) as Record<string, unknown>;
      if (type === "AllergyIntolerance")
        body.entry = [
          ...(body.entry as unknown[]),
          { resource: { resourceType: "OperationOutcome", id: "warning" } },
        ];
      else if (type === "Encounter")
        firstResource(body).subject = { reference: `Patient/${B_NORTH}` };
      else {
        const next = new URL(request.url);
        next.searchParams.set("page", "2");
        body.link = [{ relation: "next", url: next.href }];
      }
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: response.headers,
      });
    },
  });
  assert.deepEqual(result.searches, plan);
  assert.deepEqual(result.denied, plan.slice(0, -1));
  const kept = (type: string) =>
    keysOf(result).filter((key) => key.startsWith(`${type}/`));
  for (const type of laterRefused.keys())
    assert.ok(kept(type).length > 0, `page 1's ${type} records are kept`);
  assert.deepEqual(
    kept("Encounter"),
    [],
    "no record of a page naming another patient is kept",
  );
  assert.ok(
    kept("AllergyIntolerance").length > 0,
    "the searches after are made, an OperationOutcome on a page refusing nothing",
  );
  assert.deepEqual(kept("OperationOutcome"), [], "an outcome is no record");
});

test("a demo pull of a patient with notes fetches each of them, by the plan's search for DocumentReference", async () => {
  const notesOf = (bundle: Bundle) =>
    recordsAt(bundle)
      .filter(({ resourceType }) => resourceType === "DocumentReference")
      .map(({ id }) => `DocumentReference/${id}`);
  const [patient, bundle] =
    Object.entries(north.patients).find(
      ([, each]) => notesOf(each).length > 0,
    ) ?? assert.fail("no patient at North holds a note");
  const searches = DEMO_PLAN.searches.filter(
    ({ type }) => type === "DocumentReference",
  );
  assert.equal(searches.length, 1);
  const { pull: result } = await pulledAt(north, patient, {
    plan: { searches, backfill: [] },
  });
  assert.deepEqual(result.denied, []);
  assert.deepEqual(
    keysOf(result)
      .filter((key) => key.startsWith("DocumentReference/"))
      .sort(),
    notesOf(bundle).sort(),
  );
});

test("a pull reads the C-CDA document each DocumentReference of one holds, from the hospital with its token, and says why of each it could not read, never stopping for one", async () => {
  const ccd = '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"/>';
  const base = north.hospital.fhirBase;
  const structured = {
    system: "http://terminology.hl7.org/CodeSystem/v3-HL7DocumentFormatCodes",
    code: "urn:hl7-org:sdwg:ccda-structuredBody:2.1",
  };
  const reference = (
    id: string,
    attachment: Record<string, unknown>,
    format: object | undefined = structured,
  ) => ({
    resourceType: "DocumentReference",
    id,
    status: "current",
    subject: { reference: `Patient/${A_NORTH}` },
    content: [
      {
        attachment: { contentType: "application/pdf", url: `Binary/${id}-pdf` },
      },
      {
        attachment: { contentType: "application/xml", ...attachment },
        ...(format && { format }),
      },
    ],
  });
  const references = [
    reference("raw", { url: "Binary/raw" }),
    reference("binary", { url: `${base}/Binary/binary` }),
    reference("inline", { data: btoa(ccd) }),
    reference("gone", { url: "Binary/gone" }),
    reference("elsewhere", { url: "https://elsewhere.example/Binary/x" }),
    reference("large", { url: "Binary/large" }),
    reference("not-a-ccd", { url: "Binary/not-a-ccd" }),
    reference(
      "unstructured",
      { url: "Binary/unstructured" },
      {
        ...structured,
        code: "urn:hl7-org:sdwg:ccda-nonXMLBody:2.1",
      },
    ),
  ];
  const isBinary = (request: Request, id: string) =>
    new URL(request.url).pathname.endsWith(`/Binary/${id}`);
  const { pull: result, seen } = await pulled({
    plan: { searches: [{ type: "DocumentReference" }], backfill: [] },
    limits: { responseBytes: 64 * 1024 },
    alter: async (request, hospital) => {
      if (isSearch(request, "DocumentReference"))
        return Response.json({
          resourceType: "Bundle",
          type: "searchset",
          entry: references.map((resource) => ({ resource })),
        });
      if (isBinary(request, "raw"))
        return new Response(ccd, {
          headers: { "Content-Type": "application/xml" },
        });
      if (isBinary(request, "binary"))
        return Response.json(
          {
            resourceType: "Binary",
            contentType: "application/xml",
            data: btoa(ccd),
          },
          { headers: { "Content-Type": "application/fhir+json" } },
        );
      if (isBinary(request, "gone")) return new Response(null, { status: 404 });
      if (isBinary(request, "large"))
        return new Response("<ClinicalDocument>" + " ".repeat(70 * 1024), {
          headers: { "Content-Type": "application/xml" },
        });
      if (isBinary(request, "not-a-ccd"))
        return new Response("<html/>", {
          headers: { "Content-Type": "text/html" },
        });
      return hospital(request);
    },
  });
  const decoder = new TextDecoder();
  assert.deepEqual(
    result.documents?.map(
      ({ documentReference, content, url, retrievedFrom, bytes, notRead }) => [
        documentReference,
        content,
        url,
        retrievedFrom,
        bytes === undefined ? undefined : decoder.decode(bytes),
        notRead,
      ],
    ),
    [
      [
        "DocumentReference/raw",
        1,
        "Binary/raw",
        `${base}/Binary/raw`,
        ccd,
        undefined,
      ],
      [
        "DocumentReference/binary",
        1,
        `${base}/Binary/binary`,
        `${base}/Binary/binary`,
        ccd,
        undefined,
      ],
      [
        "DocumentReference/inline",
        1,
        undefined,
        `${base}/DocumentReference/inline`,
        ccd,
        undefined,
      ],
      [
        "DocumentReference/gone",
        1,
        "Binary/gone",
        undefined,
        undefined,
        "the hospital answered 404",
      ],
      [
        "DocumentReference/elsewhere",
        1,
        "https://elsewhere.example/Binary/x",
        undefined,
        undefined,
        `it is at https://elsewhere.example, not the FHIR base's origin, where the token is not sent`,
      ],
      [
        "DocumentReference/large",
        1,
        "Binary/large",
        undefined,
        undefined,
        `${new URL(base).origin}'s answer for a C-CDA document passed the limit on bytes`,
      ],
      [
        "DocumentReference/not-a-ccd",
        1,
        "Binary/not-a-ccd",
        undefined,
        undefined,
        "the hospital's answer is no C-CDA document",
      ],
    ],
  );
  const binaries = seen.requests.filter((request) =>
    new URL(request.url).pathname.includes("/Binary/"),
  );
  assert.ok(
    binaries.every((request) =>
      request.headers.get("Authorization")?.startsWith("Bearer "),
    ),
  );
  assert.ok(
    !binaries.some((request) =>
      /-pdf$|unstructured|elsewhere/.test(request.url),
    ),
    "only a structured C-CDA document is read, and only from the FHIR base's origin",
  );
  assert.equal(
    keysOf(result).filter((key) => key.startsWith("DocumentReference/")).length,
    references.length,
  );
});

/** A pull whose one search finds the DocumentReferences, each holding a CCD at the url, its Binaries answered as given. */
function ccdPulled(
  urls: readonly string[],
  binary: (request: Request) => Response | Promise<Response> | undefined,
  setup: Setup = {},
): ReturnType<typeof pulled> {
  const format = {
    system: "http://terminology.hl7.org/CodeSystem/v3-HL7DocumentFormatCodes",
    code: "urn:hl7-org:sdwg:ccda-structuredBody:2.1",
  };
  return pulled({
    plan: { searches: [{ type: "DocumentReference" }], backfill: [] },
    ...setup,
    alter: async (request, hospital) => {
      if (isSearch(request, "DocumentReference"))
        return Response.json({
          resourceType: "Bundle",
          type: "searchset",
          entry: urls.map((url, at) => ({
            resource: {
              resourceType: "DocumentReference",
              id: `ccd-${at}`,
              status: "current",
              subject: { reference: `Patient/${A_NORTH}` },
              content: [
                { attachment: { contentType: "application/xml", url }, format },
              ],
            },
          })),
        });
      return (await binary(request)) ?? hospital(request);
    },
  });
}

const CCD_XML =
  '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"/>';
const isBinaryRequest = (request: Request) =>
  new URL(request.url).pathname.includes("/Binary/");

test("a cancel while the pull reads its C-CDA documents ends the pull as a cancel, and a 401 on one ends it as a 401", async () => {
  const controller = new AbortController();
  await assert.rejects(
    ccdPulled(
      ["Binary/a", "Binary/b", "Binary/c"],
      (request) => {
        if (!isBinaryRequest(request)) return undefined;
        controller.abort();
        return new Response(CCD_XML, {
          headers: { "Content-Type": "application/xml" },
        });
      },
      { signal: controller.signal },
    ),
    (error: unknown) =>
      error instanceof ConnectionFailure && error.kind === "cancelled",
  );
  await assert.rejects(
    ccdPulled(["Binary/a"], (request) =>
      isBinaryRequest(request)
        ? new Response(null, { status: 401 })
        : undefined,
    ),
    (error: unknown) =>
      error instanceof ConnectionFailure && error.kind === "unauthorized",
  );
});

test("a C-CDA document redirected to another host, or at a url with a user name, is not read and not asked for again; one url two DocumentReferences name is read once; and an address the IRI grammar refuses is kept percent-encoded", async () => {
  const base = north.hospital.fhirBase;
  const { pull: result, seen } = await ccdPulled(
    [
      "Binary/moved",
      `https://user:pw@${new URL(base).host}${new URL(base).pathname}/Binary/u`,
      "Binary/one",
      "Binary/one",
      "Binary/a|b",
    ],
    (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/Binary/moved"))
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/Binary/x" },
        });
      if (/\/Binary\/(one|a(%7C|\|)b)$/.test(path))
        return new Response(CCD_XML, {
          headers: { "Content-Type": "application/xml" },
        });
      return undefined;
    },
  );
  const documents = result.documents ?? [];
  assert.deepEqual(
    documents.map(({ documentReference, retrievedFrom, notRead }) => [
      documentReference,
      retrievedFrom,
      notRead,
    ]),
    [
      [
        "DocumentReference/ccd-0",
        undefined,
        `${new URL(base).origin} redirected a C-CDA document to https://evil.example, which is not the FHIR base's origin`,
      ],
      [
        "DocumentReference/ccd-1",
        undefined,
        "its url carries a user name or password",
      ],
      ["DocumentReference/ccd-2", `${base}/Binary/one`, undefined],
      ["DocumentReference/ccd-3", `${base}/Binary/one`, undefined],
      ["DocumentReference/ccd-4", `${base}/Binary/a%7Cb`, undefined],
    ],
  );
  const binaries = seen.requests
    .filter(isBinaryRequest)
    .map((request) => new URL(request.url).pathname.split("/").pop());
  assert.deepEqual(
    binaries,
    ["moved", "one", "a%7Cb"],
    "each url read once, none with a user name, nothing sent to evil.example",
  );
  assert.equal(documents[2]!.bytes, documents[3]!.bytes);
  const saved = pullFiles(result, "north");
  assert.deepEqual(
    [...saved.keys()].filter((path) => path.includes("document-")),
    ["north/document-1.xml", "north/document-2.xml"],
    "one file for the document two DocumentReferences name",
  );
});

test("a pull reads an Organization its records name and its searches left out, once, by id", async () => {
  const lab = {
    resourceType: "Organization",
    id: "org-lab-1",
    name: "North Laboratory",
  };
  const isLab = (request: Request) =>
    new URL(request.url).pathname.endsWith("/Organization/org-lab-1");
  const { pull: result, seen } = await pulled({
    alter: async (request, hospital) => {
      if (isLab(request)) return Response.json(lab);
      const response = await hospital(request);
      if (!isSearch(request, "Observation")) return response;
      const body = (await response.json()) as {
        entry?: { resource: Record<string, unknown> }[];
      };
      for (const { resource } of body.entry ?? [])
        resource.performer = [{ reference: "Organization/org-lab-1" }];
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: response.headers,
      });
    },
  });
  assert.equal(seen.requests.filter(isLab).length, 1);
  assert.deepEqual(
    result.bundle.entry
      .filter(
        ({ resource }) =>
          (resource as { resourceType?: string }).resourceType ===
          "Organization",
      )
      .map(({ fullUrl, resource }) => [fullUrl, resource]),
    [[`${result.fhirBase}/Organization/org-lab-1`, lab]],
  );
});

test("the server's report is its CapabilityStatement, asked with no token, with the base, the client id and the SMART configuration the sign-in read, which connectFiles saves", async () => {
  const { report, seen } = await pulled({ report: true });
  assert.equal(report?.fhirBase, north.hospital.fhirBase);
  assert.equal(report?.clientId, REGISTRATION.clientId);
  const capability = report?.capability as {
    resourceType?: unknown;
    implementation?: { url?: unknown };
  };
  assert.equal(capability.resourceType, "CapabilityStatement");
  assert.equal(capability.implementation?.url, north.hospital.fhirBase);
  const asked = seen.requests.at(-1)!;
  assert.equal(new URL(asked.url).href, `${north.hospital.fhirBase}/metadata`);
  assert.equal(asked.headers.has("Authorization"), false);
  const discovery = seen.requests.filter(({ url }) =>
    url.endsWith("/.well-known/smart-configuration"),
  );
  assert.equal(discovery.length, 1);
  assert.equal(
    (report?.smartConfiguration as { authorization_endpoint?: unknown })
      .authorization_endpoint,
    `${north.hospital.fhirBase}/authorize`,
  );
  assert.equal(connectFiles(report!, "north").size, 3);
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
  const switched = (simulateError: string): Setup => ({
    autoApprove: undefined,
    signIn: (fetch) => (authorize) => {
      authorize.searchParams.set("simulate_error", simulateError);
      return answerSignIn(fetch, authorize, A_NORTH);
    },
  });
  const occupied = await freePort();
  const spare = await freePort();
  await new Promise((resolve) => spare.server.close(resolve));
  const rows: [string, () => Setup, FailureKind, RegExp?][] = [
    [
      "the switch token_invalid_token",
      () => switched("token_invalid_token"),
      "hospital-error",
      /refused the token exchange with 401: invalid_client/,
    ],
    [
      "the switch token_invalid_scope",
      () => switched("token_invalid_scope"),
      "hospital-error",
      /refused the token exchange with 401: invalid_scope/,
    ],
    [
      "the switch request_invalid_token",
      () => switched("request_invalid_token"),
      "unauthorized",
      /refused Patient with 401: the hospital did not accept the access token \(it may have expired or been revoked\), so connect again/,
    ],
    [
      "the switch request_expired_token",
      () => switched("request_expired_token"),
      "unauthorized",
      /refused Patient with 401: the access token expired, so connect again/,
    ],
    [
      "a switch the sandbox does not know, which it answers with invalid_request",
      () => ({
        signIn: (fetch) => async (authorize) => {
          authorize.searchParams.set("simulate_error", "no_such_switch");
          return direct(fetch)(authorize);
        },
      }),
      "hospital-error",
      /the hospital refused the sign-in: invalid_request/,
    ],
    [
      "the sign-in page's Cancel",
      () => ({
        autoApprove: undefined,
        signIn: answering(A_NORTH, "cancel"),
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
    [
      "the token's hour past before the pull",
      () => later,
      "unauthorized",
      /the access token expired, so connect again/,
    ],
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
      "a search's first page answered 410",
      () => ({
        alter: async (request, hospital) =>
          isSearch(request, "Condition")
            ? new Response(null, { status: 410 })
            : hospital(request),
      }),
      "hospital-error",
      /answered 410 to Condition/,
    ],
    [
      "a search answered 405",
      () => ({
        alter: async (request, hospital) =>
          isSearch(request, "Condition")
            ? new Response(null, { status: 405 })
            : hospital(request),
      }),
      "hospital-error",
      /answered 405 to Condition/,
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
