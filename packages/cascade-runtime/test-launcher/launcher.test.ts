// connect and pull against the SMART Health IT launcher, a server this project did not write, over the network:
// `npm run test:launcher`. Its data is shared and edited by anyone, so this asserts the protocol and the shape of what
// came back, never which records.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connect,
  ConnectionFailure,
  DEMO_PLAN,
  type DirectoryRow,
  pull,
  type Registration,
  type SignIn,
} from "cascade-runtime";

const LAUNCHER = "https://launch.smarthealthit.org";
/** A Synthea patient of r4.smarthealthit.org with records of every type `DEMO_PLAN` searches, its vital signs paged. */
const PATIENT = "523ce6ff-60bd-4d69-a8b4-9770f0e8e9f7";
const REGISTRATION: Registration = {
  clientId: "cascade-runtime-check",
  redirectUri: "http://127.0.0.1:47213/callback",
  scopes: ["launch/patient", "patient/*.read", "patient/*.rs"],
};

/**
 * The launcher's R4 base whose settings, as its `src/isomorphic/codec.ts` encodes them, launch the patient standalone
 * and approve at once, as a public client that must use PKCE.
 */
function launcherRow(): DirectoryRow {
  const settings = [
    3,
    PATIENT,
    "",
    "AUTO",
    1,
    1,
    0,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    0,
    2,
    "",
  ];
  const sim = Buffer.from(JSON.stringify(settings), "utf8").toString(
    "base64url",
  );
  return {
    name: "SMART Health IT Sandbox",
    vendor: "smart-launcher",
    fhirBase: `${LAUNCHER}/v/r4/sim/${sim}/fhir`,
  };
}

interface Seen {
  readonly sent: { readonly url: URL; readonly authorized: boolean }[];
  readonly tokens: string[];
}

/**
 * The real `fetch`, noting each request's address and whether it carried a token, and each access token given;
 * `change` may alter a request before it is sent.
 */
function recorded(
  seen: Seen,
  change: (request: Request) => Request = (request) => request,
): typeof fetch {
  return async (input, init) => {
    const request = change(new Request(input, init));
    const url = new URL(request.url);
    seen.sent.push({ url, authorized: request.headers.has("Authorization") });
    const response = await fetch(request);
    if (url.pathname.endsWith("/auth/token")) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { access_token?: string };
      if (body.access_token) seen.tokens.push(body.access_token);
    }
    return response;
  };
}

/** A sign-in with no browser: the launcher approves at once, so its answer to the authorize URL is the redirect. */
function direct(fetcher: typeof fetch): SignIn {
  return async (authorize) => {
    const response = await fetcher(authorize, { redirect: "manual" });
    const location = response.headers.get("Location");
    assert.ok(
      location,
      `the launcher answered the authorize URL ${response.status}, not a redirect`,
    );
    return new URL(location);
  };
}

function referencedPatients(resource: Record<string, unknown>): string[] {
  return [resource.subject, resource.patient]
    .map((field) => (field as { reference?: string } | undefined)?.reference)
    .filter((reference): reference is string => reference !== undefined);
}

test("connect and pull sign in to the launcher's patient and pull every searched type, following its next links", async () => {
  const started = Date.now();
  const seen: Seen = { sent: [], tokens: [] };
  const fetcher = recorded(seen);
  const row = launcherRow();
  const connection = await connect(row, REGISTRATION, {
    signIn: direct(fetcher),
    fetch: fetcher,
  });
  assert.equal(connection.patient, PATIENT);
  const result = await pull(connection, DEMO_PLAN);
  assert.equal(result.fhirBase, row.fhirBase);
  assert.equal(result.patient, PATIENT);

  const resources = result.bundle.entry.map(
    ({ resource }) => resource as Record<string, unknown>,
  );
  assert.deepEqual(
    resources
      .filter(({ resourceType }) => resourceType === "Patient")
      .map(({ id }) => id),
    [PATIENT],
  );
  for (const { type, category } of DEMO_PLAN.searches)
    assert.ok(
      resources.some(
        (resource) =>
          resource.resourceType === type &&
          (category === undefined ||
            JSON.stringify(resource.category).includes(`"${category}"`)),
      ),
      `no ${type}${category === undefined ? "" : ` of category ${category}`}`,
    );
  for (const resource of resources)
    for (const reference of referencedPatients(resource))
      assert.equal(
        reference,
        `Patient/${PATIENT}`,
        `${resource.resourceType}/${resource.id}`,
      );
  const fullUrls = result.bundle.entry.map(({ fullUrl }) => fullUrl);
  assert.equal(new Set(fullUrls).size, fullUrls.length);
  for (const { fullUrl, resource } of result.bundle.entry) {
    const { resourceType, id } = resource as {
      resourceType: string;
      id: string;
    };
    assert.equal(fullUrl, `${row.fhirBase}/${resourceType}/${id}`);
  }

  const { sent } = seen;
  assert.ok(
    sent.some(({ url }) => url.searchParams.has("_getpages")),
    "no search took more than one page",
  );
  assert.ok(sent.every(({ url }) => url.origin === LAUNCHER));
  const token = sent.findIndex(({ url }) =>
    url.pathname.endsWith("/auth/token"),
  );
  assert.ok(token > 0);
  sent.forEach(({ url, authorized }, at) =>
    assert.equal(authorized, at > token, url.href),
  );
  console.log(
    `# ${sent.length} requests in ${Date.now() - started} ms, ${resources.length} resources`,
  );
});

test("a token the launcher did not sign ends the pull as unauthorized, carrying no token", async () => {
  const seen: Seen = { sent: [], tokens: [] };
  const fetcher = recorded(seen, (request) => {
    if (!request.headers.has("Authorization")) return request;
    const headers = new Headers(request.headers);
    headers.set("Authorization", "Bearer a-token-the-launcher-did-not-sign");
    return new Request(request, { headers });
  });
  const connection = await connect(launcherRow(), REGISTRATION, {
    signIn: direct(fetcher),
    fetch: fetcher,
  });
  const failure = await pull(connection, DEMO_PLAN).then(
    () => assert.fail("the pull succeeded"),
    (error: unknown) => error,
  );
  assert.ok(failure instanceof ConnectionFailure);
  assert.equal(failure.kind, "unauthorized");
  assert.equal(seen.tokens.length, 1);
  const said = `${failure.message} ${JSON.stringify(failure)}`;
  assert.ok(!said.includes(seen.tokens[0]!), "the failure carries the token");
});
