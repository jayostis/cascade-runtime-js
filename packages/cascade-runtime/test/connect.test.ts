import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { after, before, describe, it } from "node:test";
import { Refusal } from "@cascade-runtime/runtime";
import {
  type Bundle,
  demoRemapFetch,
  recordsAt,
} from "@the-cascade-protocol/sandbox";
import { loadHospital, serveDemo } from "@the-cascade-protocol/sandbox/node";
import { answerSignIn } from "@the-cascade-protocol/sandbox/testing";
import {
  type Connection,
  connect,
  ConnectionFailure,
  connectFiles,
  DEMO_PLAN,
  type FailureKind,
  loopbackSignIn,
  type Pull,
  pull,
  pullFiles,
  type SavedConnect,
  serverReport,
  type SignIn,
} from "cascade-runtime";
import {
  type Alter,
  type Answer,
  answering,
  direct,
  FAST,
  type Fetch,
  isSearch,
  type Loaded,
  pulled as pulledAt,
  REGISTRATION,
  rowOf,
  type Seen,
  type Setup,
  signedIn as signedInAt,
} from "./hospitals.js";

const A_NORTH = "pt-1001";
const B_NORTH = "pt-1002";

let north: Loaded;

before(async () => {
  north = await loadHospital("cascade-north");
});

function signedIn(setup: Setup = {}): ReturnType<typeof signedInAt> {
  return signedInAt(north, A_NORTH, setup);
}

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

/** The `type/id` of every record of the pull that is of the type. */
function keptOf(result: Pull, type: string): string[] {
  return keysOf(result).filter((key) => key.startsWith(`${type}/`));
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

/** Changes the JSON body of each response to a request `which` picks. */
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

/** A clock stopped at the time, whose milliseconds end in zeros, as a stored `xsd:dateTime` drops them. */
function stopped(time: string): { now: () => Date } {
  return { now: () => new Date(time) };
}

/** Names `organization` as the performer of every laboratory and vital-signs Observation the hospital sends. */
function observationsBy(organization: string): Alter {
  return rewritten(
    (request) => isSearch(request, "Observation"),
    (body) => {
      for (const { resource } of (
        body as { entry?: { resource: Record<string, unknown> }[] }
      ).entry ?? [])
        resource.performer = [{ reference: organization }];
    },
  );
}

const STRUCTURED = {
  system: "http://terminology.hl7.org/CodeSystem/v3-HL7DocumentFormatCodes",
  code: "urn:hl7-org:sdwg:ccda-structuredBody:2.1",
};

const CCD_XML =
  '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"/>';

/** A DocumentReference of patient A whose C-CDA content has the attachment, after a PDF of the same note if asked. */
function reference(
  id: string,
  attachment: Record<string, unknown>,
  { format = STRUCTURED, pdf = false }: { format?: object; pdf?: boolean } = {},
) {
  return {
    resourceType: "DocumentReference",
    id,
    status: "current",
    subject: { reference: `Patient/${A_NORTH}` },
    content: [
      ...(pdf
        ? [
            {
              attachment: {
                contentType: "application/pdf",
                url: `Binary/${id}-pdf`,
              },
            },
          ]
        : []),
      {
        attachment: { contentType: "application/xml", ...attachment },
        format,
      },
    ],
  };
}

const isBinaryRequest = (request: Request) =>
  new URL(request.url).pathname.includes("/Binary/");

const isBinary = (request: Request, id: string) =>
  new URL(request.url).pathname.endsWith(`/Binary/${id}`);

/** A pull whose one search finds the DocumentReferences, each holding a CCD at the url, its Binaries responded to as given. */
function ccdPulled(
  urls: readonly string[],
  binary: (request: Request) => Response | Promise<Response> | undefined,
  setup: Setup = {},
): ReturnType<typeof pulled> {
  return pulled({
    plan: { searches: [{ type: "DocumentReference" }], backfill: [] },
    ...setup,
    alter: async (request, hospital) => {
      if (isSearch(request, "DocumentReference"))
        return Response.json({
          resourceType: "Bundle",
          type: "searchset",
          entry: urls.map((url, at) => ({
            resource: reference(`ccd-${at}`, { url }),
          })),
        });
      return (await binary(request)) ?? hospital(request);
    },
  });
}

/** The one of a pull's `documents` that is for the DocumentReference with the id. */
function documentOf(result: Pull, id: string) {
  const found = result.documents?.find(
    ({ documentReference }) => documentReference === `DocumentReference/${id}`,
  );
  assert.ok(found, `${id} has a row in documents`);
  return found;
}

const decoded = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

/**
 * `connect` signs a person in to the hospital a directory row names, by SMART on FHIR: the app's `signIn` function
 * takes the person to the hospital's own sign-in page, and `connect` returns a connection that a pull then reads
 * through. The token the hospital issues stays inside the package, where the app's code cannot read it or leak it.
 */
describe("Signing a person in to a hospital · connect(), loopbackSignIn()", () => {
  describe("connect(row, registration, { signIn, fetch })", () => {
    let signed: Awaited<ReturnType<typeof signedIn>>;

    before(async () => {
      signed = await signedIn();
    });

    it("returns a connection for the patient the person signed in as, at the row's FHIR base", () => {
      assert.equal(signed.connection.patient, A_NORTH);
      assert.equal(signed.connection.fhirBase, north.hospital.fhirBase);
    });

    it("sends no token before the hospital issues one", () => {
      const { requests } = signed.seen;
      assert.ok(requests.some(isToken), "the token exchange was sent");
      for (const request of requests)
        assert.equal(request.headers.has("Authorization"), false, request.url);
    });

    it("keeps the token out of the connection it returns", () => {
      const { connection, seen } = signed;
      assert.ok(seen.secrets.size > 0, "the hospital issued a token");
      const text = JSON.stringify(connection);
      for (const secret of seen.secrets)
        assert.ok(!text.includes(secret), "the connection carries a secret");
      for (const [name, value] of Object.entries(connection))
        assert.ok(!seen.secrets.has(String(value)), `its ${name} is a secret`);
    });
  });

  describe("loopbackSignIn({ open })", () => {
    const strays: number[] = [];
    let redirectUri: string;
    let connection: Connection;

    before(async () => {
      const { port, server } = await freePort();
      await new Promise((resolve) => server.close(resolve));
      redirectUri = `http://127.0.0.1:${port}/callback`;
      ({ connection } = await signedIn({
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
      }));
    });

    it("returns the hospital's redirect that carries the `state` value `connect` sent", () => {
      assert.equal(connection.patient, A_NORTH);
    });

    it("responds 400 to a redirect that carries another `state`, and waits on", () => {
      assert.deepEqual(strays, [400]);
      assert.equal(connection.patient, A_NORTH, "the sign-in still finished");
    });

    it("stops listening once the sign-in is back", async () => {
      await assert.rejects(globalThis.fetch(redirectUri));
    });
  });
});

/**
 * `serverReport` asks a connected hospital's server for its CapabilityStatement, the server's own account of what it
 * is, and returns it with the SMART configuration the sign-in read. `connectFiles` saves that report as the files
 * `pod.connect()` stores, from which a pod can tell one hospital's server from another's.
 * @rule runtime/arrivals.feature A16
 */
describe("Reading what a hospital's server says of itself · serverReport(), connectFiles()", () => {
  let report: SavedConnect;
  let seen: Seen;

  before(async () => {
    const signed = await signedIn();
    seen = signed.seen;
    report = await serverReport(signed.connection, { limits: FAST });
  });

  describe("serverReport(connection)", () => {
    it("returns the server's CapabilityStatement as `GET <fhirBase>/metadata` gives it", () => {
      const capability = report.capability as {
        resourceType?: unknown;
        implementation?: { url?: unknown };
      };
      assert.equal(capability.resourceType, "CapabilityStatement");
      assert.equal(capability.implementation?.url, north.hospital.fhirBase);
      const asked = seen.requests.at(-1)!;
      assert.equal(asked.method, "GET");
      assert.equal(asked.url, `${north.hospital.fhirBase}/metadata`);
    });

    it("sends no token with that request", () => {
      assert.equal(seen.requests.at(-1)!.headers.has("Authorization"), false);
    });

    it("returns the FHIR base and the client id the app signed in with", () => {
      assert.equal(report.fhirBase, north.hospital.fhirBase);
      assert.equal(report.clientId, REGISTRATION.clientId);
    });

    it("returns the SMART configuration the sign-in read, without asking the hospital for it again", () => {
      const discovery = seen.requests.filter(({ url }) =>
        url.endsWith("/.well-known/smart-configuration"),
      );
      assert.equal(discovery.length, 1);
      assert.equal(
        (report.smartConfiguration as { authorization_endpoint?: unknown })
          .authorization_endpoint,
        `${north.hospital.fhirBase}/authorize`,
      );
    });
  });

  describe("connectFiles(report, name)", () => {
    it("returns the report as three files under the folder `name`: `connect.json`, `capability.json` and `smart-configuration.json`", () => {
      assert.deepEqual(
        [...connectFiles(report, "north").keys()],
        [
          "north/connect.json",
          "north/capability.json",
          "north/smart-configuration.json",
        ],
      );
    });
  });
});

/**
 * `pull` fetches the signed-in patient's records from the hospital as FHIR resources, following a plan: the Patient,
 * then each of the plan's searches a page at a time, then any record those name that no search returned. It returns a
 * pull: the records, with which hospital they came from and when.
 */
describe("Pulling a patient's records from a hospital · pull(), DEMO_PLAN", () => {
  let happy: { pull: Pull; seen: Seen };

  before(async () => {
    happy = await pulled();
  });

  describe("pull(connection, plan)", () => {
    it("returns every record the hospital holds for the patient, each once, with `<fhirBase>/<type>/<id>` as its `fullUrl`", () => {
      const expected = keyed(north.patients[A_NORTH]!);
      assert.deepEqual(keysOf(happy.pull).sort(), [...expected.keys()].sort());
      for (const { fullUrl } of happy.pull.bundle.entry)
        assert.ok(fullUrl.startsWith(`${north.hospital.fhirBase}/`), fullUrl);
    });

    it("returns each resource exactly as the hospital sent it", () => {
      const expected = keyed(north.patients[A_NORTH]!);
      for (const { fullUrl, resource } of happy.pull.bundle.entry)
        assert.deepEqual(
          resource,
          expected.get(fullUrl.slice(`${happy.pull.fhirBase}/`.length)),
          fullUrl,
        );
    });

    it("returns the patient's id in `patient` and the FHIR base in `fhirBase`", () => {
      assert.equal(happy.pull.patient, A_NORTH);
      assert.equal(happy.pull.fhirBase, north.hospital.fhirBase);
    });

    it("makes each of the plan's searches once, with its `category` where it has one", () => {
      const urls = happy.seen.requests.map((request) => new URL(request.url));
      const firstPages = urls.filter(
        (url) =>
          url.searchParams.has("patient") && !url.searchParams.has("_page"),
      );
      const named = (type: string, category: string | null | undefined) =>
        category ? `${type}?category=${category}` : type;
      assert.deepEqual(
        firstPages.map((url) =>
          named(
            url.pathname.split("/").at(-1)!,
            url.searchParams.get("category"),
          ),
        ),
        DEMO_PLAN.searches.map(({ type, category }) => named(type, category)),
      );
      const searches = urls
        .filter((url) => url.searchParams.has("patient"))
        .map((url) => url.href);
      assert.equal(new Set(searches).size, searches.length, "no search twice");
    });

    it("follows each `next` link to a search's later pages", () => {
      assert.ok(
        happy.seen.requests.some((request) =>
          new URL(request.url).searchParams.has("_page"),
        ),
      );
    });

    it("sends every request to the hospital's own origin", () => {
      const origin = new URL(north.hospital.fhirBase).origin;
      assert.ok(happy.seen.requests.length > 0);
      for (const request of happy.seen.requests)
        assert.equal(new URL(request.url).origin, origin, request.url);
    });

    it("sends the token with every request for a record", () => {
      const { requests } = happy.seen;
      const exchange = requests.findIndex(isToken);
      assert.ok(exchange >= 0 && exchange < requests.length - 1);
      for (const request of requests.slice(exchange + 1))
        assert.equal(request.headers.has("Authorization"), true, request.url);
    });

    it("returns the plan's searches in `searches`, and nothing in `denied` or `missing`, when the hospital serves them all", () => {
      assert.deepEqual(happy.pull.searches, DEMO_PLAN.searches);
      assert.deepEqual(happy.pull.denied, []);
      assert.deepEqual(happy.pull.missing, []);
    });

    it("returns in `retrievedAt` the time of the hospital's last response, in UTC and without trailing zeros", async () => {
      const clocks = [
        ["2026-10-07T08:04:46.170Z", "2026-10-07T08:04:46.17Z"],
        ["2026-10-07T08:05:00.000Z", "2026-10-07T08:05:00Z"],
      ] as const;
      for (const [time, expected] of clocks) {
        const { pull: result } = await pulled({
          plan: { searches: [], backfill: [] },
          ...stopped(time),
        });
        assert.equal(result.retrievedAt, expected, time);
      }
    });
  });

  describe("DEMO_PLAN", () => {
    it("searches for a patient's notes, as DocumentReferences, so that a pull returns each note the hospital holds", async () => {
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
        keptOf(result, "DocumentReference").sort(),
        notesOf(bundle).sort(),
      );
    });
  });

  describe("given a record that names another which no search returned", () => {
    it("reads the other by id when the plan lists its type in `backfill`", () => {
      const [hidden] = north.hospital.hiddenFromSearch;
      assert.ok(hidden);
      assert.ok(
        happy.seen.requests.some((request) =>
          new URL(request.url).pathname.endsWith(`/${hidden}`),
        ),
        `${hidden} was read by id`,
      );
      assert.ok(keysOf(happy.pull).includes(hidden), `${hidden} is kept`);
    });

    it("reads once an Organization that several records name", async () => {
      const lab = {
        resourceType: "Organization",
        id: "org-lab-1",
        name: "North Laboratory",
      };
      const isLab = (request: Request) =>
        new URL(request.url).pathname.endsWith("/Organization/org-lab-1");
      const { pull: result, seen } = await pulled({
        alter: async (request, hospital) =>
          isLab(request)
            ? Response.json(lab)
            : observationsBy("Organization/org-lab-1")(request, hospital),
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

    it("returns in `missing` a reference the hospital will not serve, and carries on", async () => {
      const isUnserved = (request: Request) =>
        new URL(request.url).pathname.endsWith("/Organization/org-x");
      const { pull: result, seen } = await pulled({
        alter: async (request, hospital) =>
          isUnserved(request)
            ? new Response(null, { status: 404 })
            : observationsBy("Organization/org-x")(request, hospital),
      });
      assert.deepEqual(result.missing, ["Organization/org-x"]);
      assert.equal(seen.requests.filter(isUnserved).length, 1);
      assert.ok(keptOf(result, "Observation").length > 0);
      assert.deepEqual(keptOf(result, "Organization"), []);
    });
  });

  describe("given a search the hospital turns down", () => {
    const search = (type: string) => ({ type }) as const;
    const laterTurnedDown = new Map([
      ["Condition", 403],
      ["Observation", 404],
      ["MedicationRequest", 410],
    ]);
    const plan = [
      search("CarePlan"),
      ...[...laterTurnedDown.keys()].map(search),
      search("Immunization"),
      search("Procedure"),
      search("Encounter"),
      search("AllergyIntolerance"),
    ];
    let result: Pull;

    before(async () => {
      assert.ok(!north.hospital.types.includes("CarePlan"));
      const typeOf = (request: Request) =>
        new URL(request.url).pathname.split("/").at(-1)!;
      ({ pull: result } = await pulled({
        plan: { searches: plan, backfill: [] },
        alter: async (request, hospital) => {
          const type = typeOf(request);
          const later = laterTurnedDown.get(type);
          if (
            later !== undefined &&
            new URL(request.url).searchParams.has("page")
          )
            return new Response(null, { status: later });
          if (isSearch(request, "Immunization"))
            return new Response(null, { status: 400 });
          if (isSearch(request, "Procedure"))
            return new Response(null, { status: 403 });
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
      }));
    });

    it("lists in `denied` a search whose first page comes back 400, 403 or 404", () => {
      const firstPages = [
        ["CarePlan", 404],
        ["Immunization", 400],
        ["Procedure", 403],
      ] as const;
      for (const [type, status] of firstPages)
        assert.ok(
          result.denied.some((denied) => denied.type === type),
          `${type}, whose first page comes back ${status}`,
        );
    });

    it("keeps the pages before one that comes back 403, 404 or 410, and lists the search in `denied`", () => {
      for (const [type, status] of laterTurnedDown) {
        assert.ok(
          keptOf(result, type).length > 0,
          `the pages of ${type} before the page that comes back ${status}`,
        );
        assert.ok(
          result.denied.some((denied) => denied.type === type),
          `${type}, whose second page comes back ${status}`,
        );
      }
    });

    it("keeps nothing of a page that holds a record of another patient, or of no patient, and lists the search in `denied`", async () => {
      assert.deepEqual(keptOf(result, "Encounter"), [], "another patient's");
      assert.ok(result.denied.some(({ type }) => type === "Encounter"));

      const { pull: ofNoPatient } = await pulled({
        plan: { searches: [search("MedicationRequest")], backfill: [] },
        alter: rewritten(
          (request) => isSearch(request, "MedicationRequest"),
          (body) => {
            (body.entry as unknown[]).push({
              resource: { resourceType: "Medication", id: "med-1" },
              search: { mode: "include" },
            });
          },
        ),
      });
      assert.deepEqual(ofNoPatient.denied, [search("MedicationRequest")]);
      assert.deepEqual(
        keptOf(ofNoPatient, "MedicationRequest"),
        [],
        "no patient's",
      );
    });

    it("returns the records of the last search, which comes after the searches turned down", () => {
      assert.ok(keptOf(result, "AllergyIntolerance").length > 0);
    });

    it("lists every search of the plan in `searches`, denied or not", () => {
      assert.deepEqual(result.searches, plan);
    });

    it("ignores an OperationOutcome among a page's resources: its search is not denied, and it is not kept as a record", () => {
      assert.deepEqual(result.denied, plan.slice(0, -1));
      assert.deepEqual(keptOf(result, "OperationOutcome"), []);
    });
  });

  describe("given a hospital that fails once and then responds", () => {
    /** Turns one response to a search for the type into `failure`, and no later one. */
    const failingOnce = (
      type: string,
      failure: () => Promise<Response>,
      failed: Set<string>,
    ): Alter => {
      return async (request, hospital) => {
        if (isSearch(request, type) && !failed.has(type)) {
          failed.add(type);
          return failure();
        }
        return hospital(request);
      };
    };

    it("retries a search that comes back 503 or 429, or gets no response, and returns the same records", async () => {
      const failed = new Set<string>();
      const alters = [
        failingOnce(
          "Condition",
          async () => new Response(null, { status: 503 }),
          failed,
        ),
        failingOnce(
          "AllergyIntolerance",
          async () =>
            new Response(null, {
              status: 429,
              headers: { "Retry-After": "0" },
            }),
          failed,
        ),
        failingOnce(
          "Immunization",
          () => Promise.reject(new TypeError("reset")),
          failed,
        ),
      ];
      const { pull: result } = await pulled({
        alter: (request, hospital) =>
          alters.reduce<Answer>(
            (next, alter) => (r) => alter(r, next),
            hospital,
          )(request),
      });
      assert.equal(failed.size, 3, "each search failed once");
      assert.deepEqual(keysOf(result).sort(), keysOf(happy.pull).sort());
    });

    it("uses the default number of tries when `limits.retries` is passed as `undefined`", async () => {
      const failed = new Set<string>();
      const { pull: result } = await pulled({
        plan: { searches: [{ type: "Condition" }], backfill: [] },
        limits: { retries: undefined },
        alter: failingOnce(
          "Condition",
          async () => new Response(null, { status: 503 }),
          failed,
        ),
      });
      assert.equal(failed.size, 1);
      assert.ok(keptOf(result, "Condition").length > 0);
    });
  });

  describe("given a FHIR base written with a trailing slash", () => {
    it("returns `fhirBase` without it, and every `fullUrl` under that", async () => {
      const { pull: result } = await pulled({
        row: { ...rowOf(north), fhirBase: `${north.hospital.fhirBase}/` },
      });
      assert.equal(result.fhirBase, north.hospital.fhirBase);
      assert.deepEqual(
        result.bundle.entry.map(({ fullUrl }) => fullUrl).sort(),
        happy.pull.bundle.entry.map(({ fullUrl }) => fullUrl).sort(),
      );
    });
  });

  describe("given a demo hospital served over HTTP on this machine", () => {
    let listener: Awaited<ReturnType<typeof serveDemo>>;

    before(async () => {
      listener = await serveDemo([{ ...north, autoApprove: A_NORTH }]);
    });

    after(async () => {
      await listener.close();
    });

    it("returns the same records, with the same `fullUrl`s, as from the hospital called in process", async () => {
      const fetch = demoRemapFetch(listener.origin);
      const connection = await connect(rowOf(north), REGISTRATION, {
        signIn: direct(fetch),
        fetch,
      });
      const through = await pull(connection, DEMO_PLAN);
      const names = (from: Pull) =>
        from.bundle.entry.map(({ fullUrl }) => fullUrl);
      assert.ok(names(through).length > 0);
      assert.deepEqual(names(through), names(happy.pull));
      assert.equal(through.fhirBase, happy.pull.fhirBase);
    });
  });
});

/**
 * Beside its FHIR resources, a hospital can hold a patient's summary as a C-CDA document, which a DocumentReference
 * points to by URL or carries inline. `pull` reads each one from the FHIR base's origin and nowhere else, and where it
 * cannot read one it says why and carries on. Each document read comes with `retrievedFrom`, the URL it was read from.
 */
describe("Pulling the C-CDA documents a hospital holds · pull()", () => {
  const written = () => new URL(north.hospital.fhirBase);
  let base: string;
  /** K: eight DocumentReferences, seven of them with a document to read, a PDF beside each. */
  let K: Awaited<ReturnType<typeof pulled>>;
  /** M: five `url`s, of which two name one document, one is redirected and one has a user name. */
  let M: Awaited<ReturnType<typeof pulled>>;
  /** U: three DocumentReferences, under a FHIR base written in upper case with `:443`. */
  let U: Awaited<ReturnType<typeof pulled>>;

  before(async () => {
    base = north.hospital.fhirBase;

    const references = [
      reference("raw", { url: "Binary/raw" }, { pdf: true }),
      reference("binary", { url: `${base}/Binary/binary` }, { pdf: true }),
      reference("inline", { data: btoa(CCD_XML) }, { pdf: true }),
      reference("gone", { url: "Binary/gone" }, { pdf: true }),
      reference(
        "elsewhere",
        { url: "https://elsewhere.example/Binary/x" },
        { pdf: true },
      ),
      reference("large", { url: "Binary/large" }, { pdf: true }),
      reference("not-a-ccd", { url: "Binary/not-a-ccd" }, { pdf: true }),
      reference(
        "unstructured",
        { url: "Binary/unstructured" },
        {
          pdf: true,
          format: {
            ...STRUCTURED,
            code: "urn:hl7-org:sdwg:ccda-nonXMLBody:2.1",
          },
        },
      ),
    ];
    K = await pulled({
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
          return new Response(CCD_XML, {
            headers: { "Content-Type": "application/xml" },
          });
        if (isBinary(request, "binary"))
          return Response.json(
            {
              resourceType: "Binary",
              contentType: "application/xml",
              data: btoa(CCD_XML),
            },
            { headers: { "Content-Type": "application/fhir+json" } },
          );
        if (isBinary(request, "gone"))
          return new Response(null, { status: 404 });
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

    M = await ccdPulled(
      [
        "Binary/moved",
        `https://user:pw@${written().host}${written().pathname}/Binary/u`,
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

    const broken =
      '<ClinicalDocument xmlns="urn:hl7-org:v3"><component><structuredBody/></component><oops></ClinicalDocument>';
    const upperCase = `https://${written().host.toUpperCase()}:443${written().pathname}`;
    U = await pulled({
      row: { ...rowOf(north), fhirBase: upperCase },
      plan: { searches: [{ type: "DocumentReference" }], backfill: [] },
      alter: async (request, hospital) => {
        if (isSearch(request, "DocumentReference"))
          return Response.json({
            resourceType: "Bundle",
            type: "searchset",
            entry: [
              reference("broken", { url: "Binary/broken" }),
              reference("broken-inline", { data: btoa(broken) }),
              reference("inline", { data: btoa(CCD_XML) }),
            ].map((resource) => ({ resource })),
          });
        const url = new URL(request.url);
        if (url.searchParams.get("aud") === upperCase) {
          url.searchParams.set("aud", north.hospital.fhirBase);
          return hospital(new Request(url, request));
        }
        if (isBinaryRequest(request))
          return new Response(broken, {
            headers: { "Content-Type": "application/xml" },
          });
        return hospital(request);
      },
    });
  });

  describe("given DocumentReferences that hold a structured C-CDA document", () => {
    it("returns one of `documents` for each: the DocumentReference, the position of the content that holds it, and its `url` as written", () => {
      assert.deepEqual(
        K.pull.documents?.map(({ documentReference, content, url }) => [
          documentReference,
          content,
          url,
        ]),
        [
          ["DocumentReference/raw", 1, "Binary/raw"],
          ["DocumentReference/binary", 1, `${base}/Binary/binary`],
          ["DocumentReference/inline", 1, undefined],
          ["DocumentReference/gone", 1, "Binary/gone"],
          [
            "DocumentReference/elsewhere",
            1,
            "https://elsewhere.example/Binary/x",
          ],
          ["DocumentReference/large", 1, "Binary/large"],
          ["DocumentReference/not-a-ccd", 1, "Binary/not-a-ccd"],
        ],
      );
    });

    it("reads a document at a relative `url`, served as XML", () => {
      const raw = documentOf(K.pull, "raw");
      assert.equal(raw.retrievedFrom, `${base}/Binary/raw`);
      assert.equal(decoded(raw.bytes), CCD_XML);
      assert.equal(raw.notRead, undefined);
    });

    it("reads a document the hospital serves wrapped in a Binary resource", () => {
      const binary = documentOf(K.pull, "binary");
      assert.equal(binary.retrievedFrom, `${base}/Binary/binary`);
      assert.equal(decoded(binary.bytes), CCD_XML);
      assert.equal(binary.notRead, undefined);
    });

    it("reads a document carried inline as base64 `data`, with the DocumentReference's own URL as `retrievedFrom`", () => {
      const inline = documentOf(K.pull, "inline");
      assert.equal(decoded(inline.bytes), CCD_XML);
      assert.equal(inline.retrievedFrom, `${base}/DocumentReference/inline`);
      assert.equal(inline.url, undefined);
    });

    it("sends the token with each request for a document", () => {
      const binaries = K.seen.requests.filter(isBinaryRequest);
      assert.ok(binaries.length > 0);
      for (const request of binaries)
        assert.ok(
          request.headers.get("Authorization")?.startsWith("Bearer "),
          request.url,
        );
    });

    it("skips content that is no structured C-CDA document: a PDF, and a C-CDA with no structured body", () => {
      const { requests } = K.seen;
      assert.ok(
        !requests.some((request) => /-pdf$/.test(request.url)),
        "a PDF",
      );
      assert.ok(
        !requests.some((request) => request.url.includes("unstructured")),
        "a C-CDA with no structured body",
      );
      assert.equal(
        K.pull.documents?.some(
          ({ documentReference }) =>
            documentReference === "DocumentReference/unstructured",
        ),
        false,
      );
    });

    it("keeps every DocumentReference as a record, whether or not its document was read", () => {
      assert.equal(keptOf(K.pull, "DocumentReference").length, 8);
    });

    it("reads once a `url` that two DocumentReferences name", () => {
      const reads = M.seen.requests.filter((request) =>
        isBinary(request, "one"),
      );
      assert.equal(reads.length, 1);
      assert.equal(
        documentOf(M.pull, "ccd-2").bytes,
        documentOf(M.pull, "ccd-3").bytes,
      );
      assert.ok(documentOf(M.pull, "ccd-2").bytes);
    });

    it("returns `retrievedFrom` with a character a URL may not hold, such as `|`, written as its percent escape, `%7C`", () => {
      assert.equal(
        documentOf(M.pull, "ccd-4").retrievedFrom,
        `${base}/Binary/a%7Cb`,
      );
    });

    it("returns `retrievedFrom` with the host in lower case and without `:443`, for a FHIR base written in upper case with `:443`", () => {
      assert.equal(
        documentOf(U.pull, "inline").retrievedFrom,
        `https://${written().host}${written().pathname}/DocumentReference/inline`,
      );
    });

    it("returns a pull that `pullFiles` saves, with one `document-<n>.xml` for each distinct document read", () => {
      assert.deepEqual(
        [...pullFiles(M.pull, "north").keys()].filter((path) =>
          path.includes("document-"),
        ),
        ["north/document-1.xml"],
        "three DocumentReferences, one document",
      );
      assert.ok(
        pullFiles(U.pull, "north").has("north/document-1.xml"),
        "two of three documents not read",
      );
    });
  });

  describe("given a document it cannot read", () => {
    it("returns `notRead` with the reason, and no `bytes`, for a response that is a 404, over `limits.responseBytes`, no C-CDA document, or not well-formed XML", () => {
      const cannot: [Pull, string, string][] = [
        [K.pull, "gone", "the hospital answered 404"],
        [
          K.pull,
          "large",
          `${new URL(base).origin}'s answer for a C-CDA document passed the limit on bytes`,
        ],
        [
          K.pull,
          "not-a-ccd",
          "the hospital's answer is no well-formed C-CDA document",
        ],
        [
          U.pull,
          "broken",
          "the hospital's answer is no well-formed C-CDA document",
        ],
      ];
      for (const [from, id, reason] of cannot) {
        const one = documentOf(from, id);
        assert.equal(one.notRead, reason, id);
        assert.equal(one.bytes, undefined, id);
        assert.equal(one.retrievedFrom, undefined, id);
      }
    });

    it("returns `notRead` for inline `data` that is not well-formed XML", () => {
      assert.equal(
        documentOf(U.pull, "broken-inline").notRead,
        "its inline data is no well-formed C-CDA document",
      );
    });

    it("sends no request for a `url` on another origin, where the token must not go", () => {
      assert.equal(
        documentOf(K.pull, "elsewhere").notRead,
        "it is at https://elsewhere.example, not the FHIR base's origin, where the token is not sent",
      );
      assert.ok(
        !K.seen.requests.some((request) =>
          request.url.includes("elsewhere.example"),
        ),
      );
    });

    it("sends no request for a `url` that carries a user name or a password", () => {
      assert.equal(
        documentOf(M.pull, "ccd-1").notRead,
        "its url carries a user name or password",
      );
      assert.ok(!M.seen.requests.some((request) => isBinary(request, "u")));
    });

    it("follows no redirect to another origin, and asks for that `url` once", () => {
      assert.equal(
        documentOf(M.pull, "ccd-0").notRead,
        `${new URL(base).origin} redirected a C-CDA document to https://evil.example, which is not the FHIR base's origin`,
      );
      assert.equal(
        M.seen.requests.filter((request) => isBinary(request, "moved")).length,
        1,
      );
      assert.ok(
        !M.seen.requests.some(
          (request) => new URL(request.url).host === "evil.example",
        ),
      );
    });

    it("reads the documents that come after it", () => {
      assert.ok(documentOf(M.pull, "ccd-0").notRead);
      assert.ok(documentOf(M.pull, "ccd-1").notRead);
      assert.ok(documentOf(M.pull, "ccd-2").retrievedFrom, "after two in M");
      assert.ok(documentOf(U.pull, "broken").notRead);
      assert.ok(documentOf(U.pull, "broken-inline").notRead);
      assert.ok(documentOf(U.pull, "inline").retrievedFrom, "after two in U");
    });
  });

  describe("when reading a document must end the pull", () => {
    it("throws `unauthorized` for a 401 in response to a document", async () => {
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

    it("throws `cancelled` once the app aborts its `signal`", async () => {
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
    });
  });
});

/**
 * When signing in or pulling cannot finish, `connect` and `pull` throw a `ConnectionFailure`, whose `kind` is one of
 * eight words an app can turn into a message for the person. It carries no token and no authorization code, so an app
 * can log it or show it.
 */
describe("Telling why a connection failed · ConnectionFailure", () => {
  let occupied: Awaited<ReturnType<typeof freePort>>;
  let spare: Awaited<ReturnType<typeof freePort>>;
  let kept: { label: string; failure: unknown }[];

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
  const answeringCondition =
    (response: () => Response): Setup["alter"] =>
    async (request, hospital) =>
      isSearch(request, "Condition") ? response() : hospital(request);

  /** Every failure made, once: a label, how to set it up, and what its message says where the leaf checks it. */
  const rows: [string, () => Setup, RegExp?][] = [
    [
      "the switch token_invalid_token",
      () => switched("token_invalid_token"),
      /refused the token exchange with 401: invalid_client/,
    ],
    [
      "the switch token_invalid_scope",
      () => switched("token_invalid_scope"),
      /refused the token exchange with 401: invalid_scope/,
    ],
    [
      "the switch request_invalid_token",
      () => switched("request_invalid_token"),
      /refused Patient with 401: the hospital did not accept the access token \(it may have expired or been revoked\), so connect again/,
    ],
    [
      "the switch request_expired_token",
      () => switched("request_expired_token"),
      /refused Patient with 401: the access token expired, so connect again/,
    ],
    [
      "a switch the demo hospital does not know, which it responds to with invalid_request",
      () => ({
        signIn: (fetch) => async (authorize) => {
          authorize.searchParams.set("simulate_error", "no_such_switch");
          return direct(fetch)(authorize);
        },
      }),
      /the hospital refused the sign-in: invalid_request/,
    ],
    [
      "the sign-in page's Cancel",
      () => ({
        autoApprove: undefined,
        signIn: answering(A_NORTH, "cancel"),
      }),
    ],
    [
      "the caller's signal aborted",
      () => ({ connectOptions: { signal: AbortSignal.abort() } }),
    ],
    ["the sign-in returns another state", () => ({ signIn: swapState })],
    [
      "the sign-in returns access_denied with another state",
      () => ({
        signIn: () => async () =>
          new URL(`${REGISTRATION.redirectUri}?error=access_denied&state=x`),
      }),
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
    ],
    [
      "a next link to another host",
      () => ({
        alter: nextRewritten((u) => {
          u.hostname = "elsewhere.demo.invalid";
          return u;
        }),
      }),
    ],
    [
      "a next link over http:",
      () => ({
        alter: nextRewritten(
          (u) => new URL(u.href.replace(/^https:/, "http:")),
        ),
      }),
    ],
    [
      "a redirect from a search to another host",
      () => ({
        alter: answeringCondition(
          () =>
            new Response(null, {
              status: 302,
              headers: {
                Location: "https://elsewhere.demo.invalid/fhir/Condition",
              },
            }),
        ),
      }),
    ],
    [
      "a FHIR base over http:",
      () => ({
        row: {
          ...rowOf(north),
          fhirBase: north.hospital.fhirBase.replace(/^https:/, "http:"),
        },
      }),
    ],
    [
      "responseBytes below one page",
      () => ({ limits: { responseBytes: 200 } }),
    ],
    ["requests below the plan's count", () => ({ limits: { requests: 3 } })],
    [
      "the token's hour past before the pull",
      () => {
        let clock = new Date();
        return {
          now: () => clock,
          between: () => {
            clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
          },
        };
      },
      /the access token expired, so connect again/,
    ],
    [
      "a search always answered 503",
      () => ({
        limits: { retries: 1 },
        alter: answeringCondition(() => new Response(null, { status: 503 })),
      }),
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
    ],
    [
      "a FHIR base that is no URL",
      () => ({ row: { ...rowOf(north), fhirBase: "not a URL" } }),
    ],
    [
      "a FHIR base with a query",
      () => ({
        row: {
          ...rowOf(north),
          fhirBase: `${north.hospital.fhirBase}?tenant=a`,
        },
      }),
    ],
    [
      "a redirect URI that is no URL",
      () => ({
        registration: { ...REGISTRATION, redirectUri: "not a URL" },
      }),
    ],
    [
      "the token endpoint responds 502 with a page",
      () => ({
        alter: async (request, hospital) =>
          isToken(request)
            ? new Response("<html>Bad gateway</html>", {
                status: 502,
                headers: { "Content-Type": "text/html" },
              })
            : hospital(request),
      }),
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
    ],
    [
      "the token's patient is not a FHIR id",
      () => ({
        alter: rewritten(isToken, (body) => {
          body.patient = "pt 1001!";
        }),
      }),
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
      /next link/,
    ],
    [
      "a redirect a browser hides the URL of",
      () => ({ alter: answeringCondition(() => Response.error()) }),
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
    ],
    [
      "a search's first page answered 410",
      () => ({
        alter: answeringCondition(() => new Response(null, { status: 410 })),
      }),
      /answered 410 to Condition/,
    ],
    [
      "a search answered 405",
      () => ({
        alter: answeringCondition(() => new Response(null, { status: 405 })),
      }),
      /answered 405 to Condition/,
    ],
  ];

  before(async () => {
    occupied = await freePort();
    spare = await freePort();
    await new Promise((resolve) => spare.server.close(resolve));
    kept = [];
    for (const [label, setup] of rows)
      kept.push({
        label,
        failure: await pulled(setup()).then(
          () => undefined,
          (error: unknown) => error,
        ),
      });
  });

  after(() => {
    occupied.server.close();
  });

  /** The failures made for the labels, each asserted to have been thrown, with what the test's `fetch` saw. */
  function failuresOf(...labels: string[]) {
    return labels.map((label) => {
      const one = kept.find((each) => each.label === label);
      assert.ok(one, `${label} is one of the failures made`);
      assert.notEqual(one.failure, undefined, `${label}: no failure`);
      const { seen, ...shown } = one.failure as ConnectionFailure & {
        seen: Seen;
      };
      const failure = one.failure as ConnectionFailure;
      const message = rows.find(([each]) => each === label)![2];
      return { label, failure, seen, shown, message };
    });
  }

  /** That each failure has the kind, and a message matching what its row says it should, where it says. */
  function assertKind(kind: FailureKind, ...labels: string[]): void {
    for (const { label, failure, message } of failuresOf(...labels)) {
      assert.equal(failure.kind, kind, label);
      if (message) assert.match(failure.message, message, label);
    }
  }

  describe("given any failure of `connect` or `pull`", () => {
    const everyLabel = () => kept.map(({ label }) => label);

    it("throws a `ConnectionFailure`, which is no `Refusal`", () => {
      for (const { label, failure } of failuresOf(...everyLabel())) {
        assert.ok(failure instanceof ConnectionFailure, label);
        assert.ok(!(failure instanceof Refusal), label);
      }
    });

    it("keeps the token and the authorization code out of its message and its properties", () => {
      for (const { label, failure, seen, shown } of failuresOf(
        ...everyLabel(),
      )) {
        const text = `${failure.message} ${JSON.stringify(shown)}`;
        for (const secret of seen.secrets)
          assert.ok(!text.includes(secret), `${label}: carries a secret`);
      }
    });

    it("has no `cause`", () => {
      for (const { label, failure } of failuresOf(...everyLabel()))
        assert.equal(failure.cause, undefined, label);
    });

    it("names the hospital's origin in `origin`, its HTTP status in `status`, and what was asked of it in `askedFor`", () => {
      const origin = new URL(north.hospital.fhirBase).origin;
      const named: [string, number, string][] = [
        ["a search always answered 503", 503, "Condition"],
        ["the switch token_invalid_token", 401, "token"],
        ["a search's first page answered 410", 410, "Condition"],
      ];
      for (const [label, status, askedFor] of named) {
        const { failure } = failuresOf(label)[0]!;
        assert.deepEqual(
          [failure.origin, failure.status, failure.askedFor],
          [origin, status, askedFor],
          label,
        );
      }
    });
  });

  describe("when the person or the app stops the sign-in", () => {
    it("throws `cancelled` for Cancel on the hospital's sign-in page, and for a `signal` the app has aborted", () => {
      assertKind(
        "cancelled",
        "the sign-in page's Cancel",
        "the caller's signal aborted",
      );
    });
  });

  describe("when the sign-in comes back wrong", () => {
    it("throws `state-mismatch` for a redirect that carries another `state`, with a code or with an error, and for one to a URL that is not the redirect URI", () => {
      assertKind(
        "state-mismatch",
        "the sign-in returns another state",
        "the sign-in returns access_denied with another state",
        "the sign-in returns a URL off the redirect URI",
      );
    });
  });

  describe("when a request would leave the hospital's `https:` origin", () => {
    it("throws `host-not-allowed` for a `next` link to another origin or over `http:`, and for a search redirected to another origin", () => {
      assertKind(
        "host-not-allowed",
        "a next link to another host",
        "a next link over http:",
        "a redirect from a search to another host",
      );
    });

    it("throws `host-not-allowed`, before any request is sent, for a FHIR base over `http:`", () => {
      assertKind("host-not-allowed", "a FHIR base over http:");
      const { seen } = failuresOf("a FHIR base over http:")[0]!;
      assert.deepEqual(seen.requests, []);
    });
  });

  describe("when a pull goes over one of its `limits`", () => {
    it("throws `cap-exceeded` for a response larger than `responseBytes`, and for more requests than `requests`", () => {
      assertKind(
        "cap-exceeded",
        "responseBytes below one page",
        "requests below the plan's count",
      );
    });
  });

  describe("when the hospital will not take the token", () => {
    it("throws `unauthorized`, telling the app to connect again, for a token the hospital does not accept", () => {
      assertKind("unauthorized", "the switch request_invalid_token");
    });

    it("throws `unauthorized`, saying the token expired, when the hospital says so and when the token's time has run out", () => {
      assertKind(
        "unauthorized",
        "the switch request_expired_token",
        "the token's hour past before the pull",
      );
    });
  });

  describe("when the hospital keeps failing", () => {
    it("throws `retries-exhausted` for a search that comes back 503 on every try, and for a token exchange that gets no response", () => {
      assertKind(
        "retries-exhausted",
        "a search always answered 503",
        "the token endpoint cannot be reached",
      );
    });
  });

  describe("when the sign-in cannot start", () => {
    it("throws `sign-in-unavailable` for a redirect URI that is no URL, for a loopback port already in use, and for a sign-in page that `open` cannot open", () => {
      assertKind(
        "sign-in-unavailable",
        "a redirect URI that is no URL",
        "the loopback's port already in use",
        "the loopback cannot open the sign-in page",
      );
    });
  });

  describe("when the hospital sends what the package cannot use", () => {
    it("throws `hospital-error`, with the status and the hospital's own error code where it gives one, for a token exchange the hospital turns down", () => {
      assertKind(
        "hospital-error",
        "the switch token_invalid_token",
        "the switch token_invalid_scope",
        "the token endpoint responds 502 with a page",
      );
    });

    it("throws `hospital-error`, with the hospital's own error code, for a sign-in the hospital turns down", () => {
      assertKind(
        "hospital-error",
        "a switch the demo hospital does not know, which it responds to with invalid_request",
      );
    });

    it("throws `hospital-error` for a SMART configuration that does not offer PKCE with S256", () => {
      assertKind("hospital-error", "discovery without S256");
    });

    it("throws `hospital-error` for a token response whose patient is no FHIR id", () => {
      assertKind("hospital-error", "the token's patient is not a FHIR id");
    });

    it("throws `hospital-error` for a resource whose type or id is not one FHIR allows", () => {
      assertKind(
        "hospital-error",
        "a searched resource whose id is not a FHIR id",
        "a searched resource whose type is not a FHIR type",
      );
    });

    it("throws `hospital-error` for a `next` link back to a page already read", () => {
      assertKind("hospital-error", "a next link back to the page it is on");
    });

    it("throws `hospital-error` for a search whose first page comes back 410, and for one that comes back 405", () => {
      assertKind(
        "hospital-error",
        "a search's first page answered 410",
        "a search answered 405",
      );
    });

    it("throws `hospital-error` for a redirect whose target a browser hides", () => {
      assertKind("hospital-error", "a redirect a browser hides the URL of");
    });

    it("throws `hospital-error` for a directory row whose FHIR base is no URL, or carries a query", () => {
      assertKind(
        "hospital-error",
        "a FHIR base that is no URL",
        "a FHIR base with a query",
      );
    });
  });
});
