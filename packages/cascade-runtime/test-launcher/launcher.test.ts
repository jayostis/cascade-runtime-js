// connect and pull against the SMART Health IT launcher, a server this project did not write, over the network:
// `npm run test:launcher`. Its data is shared and edited by anyone, so this asserts the protocol and the shape of what
// came back, never which records: a type is expected only if the launcher itself counts records of it for PATIENT.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  type Connection,
  connect,
  ConnectionFailure,
  DEMO_PLAN,
  type DirectoryRow,
  pull,
  type Pull,
  type Registration,
  type Search,
  type SignIn,
  TEST_DIRECTORY,
} from "cascade-runtime";
import {
  launcherSettings,
  withLauncherSettings,
} from "../test/launcher-settings.js";
import { failureToReport, launcherAnswers } from "../test/launcher-sandbox.js";

const LAUNCHER = "https://launch.smarthealthit.org";
/** A Synthea patient of r4.smarthealthit.org with a good many records, its vital signs paged. */
const PATIENT = "523ce6ff-60bd-4d69-a8b4-9770f0e8e9f7";
const REGISTRATION: Registration = {
  clientId: "cascade-runtime-check",
  redirectUri: "http://127.0.0.1:47213/callback",
  scopes: ["launch/patient", "patient/*.read", "patient/*.rs"],
};

/** The test directory's launcher row, its settings naming PATIENT and approving at once. */
function launcherRow(): DirectoryRow {
  const row = TEST_DIRECTORY.find(({ vendor }) => vendor === "smart-launcher");
  assert.ok(row);
  const settings = launcherSettings(row.fhirBase);
  return {
    ...row,
    fhirBase: withLauncherSettings(row.fhirBase, {
      ...settings,
      patient: PATIENT,
      skipLogin: 1,
      skipAuth: 1,
    }),
  };
}

interface Seen {
  readonly sent: { readonly url: URL; readonly authorized: boolean }[];
  readonly tokens: string[];
  readonly nexts: string[];
}

/**
 * The real `fetch`, noting each request's address and whether it carried a token, each access token given and each
 * `next` link; `change` may alter a request before it is sent.
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
    const body = (await response
      .clone()
      .json()
      .catch(() => ({}))) as {
      access_token?: string;
      link?: { relation?: string; url?: string }[];
    };
    if (url.pathname.endsWith("/auth/token") && body.access_token)
      seen.tokens.push(body.access_token);
    for (const { relation, url: next } of body.link ?? [])
      if (relation === "next" && next) seen.nexts.push(new URL(next, url).href);
    return response;
  };
}

/** A sign-in with no browser: the launcher approves at once, so its response to the authorize URL is the redirect. */
function direct(fetcher: typeof fetch): SignIn {
  return async (authorize) => {
    const response = await fetcher(authorize, { redirect: "manual" });
    const location = response.headers.get("Location");
    assert.ok(
      location,
      `the launcher responded to the authorize URL ${response.status}, not with a redirect`,
    );
    return new URL(location, authorize);
  };
}

/** How many records the launcher itself holds for PATIENT that `search` finds, asked with a count and no records. */
async function held(
  base: string,
  token: string,
  { type, category }: Search,
): Promise<number> {
  const url = new URL(`${base}/${type}`);
  url.searchParams.set("patient", PATIENT);
  if (category !== undefined) url.searchParams.set("category", category);
  url.searchParams.set("_summary", "count");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200, url.href);
  const { total } = (await response.json()) as { total?: number };
  assert.equal(typeof total, "number", `no total from ${url.href}`);
  return total!;
}

function referencedPatients(resource: Record<string, unknown>): string[] {
  return [resource.subject, resource.patient]
    .map((field) => (field as { reference?: string } | undefined)?.reference)
    .filter((reference): reference is string => reference !== undefined);
}

/**
 * What the network work of a `describe` came to, kept as a value. A `before` that throws is reported by node as "failed
 * running before hook" with each leaf cancelled and the real error in a `cause` that the annotations do not print, so
 * a night the launcher is down would never name it. Every leaf instead gives the failure itself, which is
 * `LauncherUnavailable` when the launcher is down.
 */
type Attempt<Done> = { readonly done: Done } | { readonly failed: unknown };

async function attempted<Done>(
  row: DirectoryRow,
  work: () => Promise<Done>,
): Promise<Attempt<Done>> {
  try {
    return { done: await work() };
  } catch (error) {
    return {
      failed: await failureToReport(error, () => launcherAnswers(row.fhirBase)),
    };
  }
}

function resultOf<Done>(attempt: Attempt<Done>): Done {
  if ("failed" in attempt) throw attempt.failed;
  return attempt.done;
}

interface Pulled {
  readonly row: DirectoryRow;
  readonly connection: Connection;
  readonly result: Pull;
  readonly seen: Seen;
  /** What the launcher itself counts for each of the plan's searches. */
  readonly held: readonly { readonly search: Search; readonly total: number }[];
}

/**
 * The launcher is a public test hospital whose records anyone may change, so these checks hold `connect` and `pull` to
 * the protocol and to the shape of what comes back, never to particular records. They need the network, run nightly as
 * `npm run test:launcher`, and are not on the tests page.
 */
describe("Pulling from a hospital this project did not write · connect(), pull()", () => {
  describe("given a patient of the launcher, signed in with no sign-in page", () => {
    let attempt: Attempt<Pulled>;

    before(async () => {
      const started = Date.now();
      const seen: Seen = { sent: [], tokens: [], nexts: [] };
      const fetcher = recorded(seen);
      const row = launcherRow();
      attempt = await attempted(row, async () => {
        const connection = await connect(row, REGISTRATION, {
          signIn: direct(fetcher),
          fetch: fetcher,
        });
        const result = await pull(connection, DEMO_PLAN);
        const [bearer] = seen.tokens;
        assert.ok(bearer);
        const counts = [];
        for (const search of DEMO_PLAN.searches)
          counts.push({
            search,
            total: await held(row.fhirBase, bearer, search),
          });
        console.log(
          `# ${seen.sent.length} requests in ${Date.now() - started} ms, ${result.bundle.entry.length} resources`,
        );
        return { row, connection, result, seen, held: counts };
      });
    });

    const resourcesOf = (result: Pull) =>
      result.bundle.entry.map(
        ({ resource }) => resource as Record<string, unknown>,
      );

    it("returns a connection for the patient the row's settings name", () => {
      const { connection } = resultOf(attempt);
      assert.equal(connection.patient, PATIENT);
    });

    it("returns the launcher's FHIR base and that patient in the pull", () => {
      const { row, result } = resultOf(attempt);
      assert.equal(result.fhirBase, row.fhirBase);
      assert.equal(result.patient, PATIENT);
    });

    it("returns one Patient, the one signed in", () => {
      const { result } = resultOf(attempt);
      assert.deepEqual(
        resourcesOf(result)
          .filter(({ resourceType }) => resourceType === "Patient")
          .map(({ id }) => id),
        [PATIENT],
      );
    });

    it("returns a record of every kind the plan searches for and the launcher itself counts for the patient", () => {
      const { result, held: counts } = resultOf(attempt);
      const resources = resourcesOf(result);
      let expected = 0;
      for (const { search, total } of counts) {
        if (total === 0) continue;
        expected += 1;
        const { type, category } = search;
        assert.ok(
          resources.some(
            (resource) =>
              resource.resourceType === type &&
              (category === undefined ||
                JSON.stringify(resource.category).includes(`"${category}"`)),
          ),
          `no ${type}${category === undefined ? "" : ` of category ${category}`}`,
        );
      }
      assert.ok(
        expected > 0,
        "the launcher holds nothing of any searched type",
      );
    });

    it("returns no record that names another patient", () => {
      const { result } = resultOf(attempt);
      for (const resource of resourcesOf(result))
        for (const reference of referencedPatients(resource))
          assert.equal(
            reference,
            `Patient/${PATIENT}`,
            `${resource.resourceType}/${resource.id}`,
          );
    });

    it("returns each record once, with `<fhirBase>/<type>/<id>` as its `fullUrl`", () => {
      const { row, result } = resultOf(attempt);
      const fullUrls = result.bundle.entry.map(({ fullUrl }) => fullUrl);
      assert.equal(new Set(fullUrls).size, fullUrls.length);
      for (const { fullUrl, resource } of result.bundle.entry) {
        const { resourceType, id } = resource as {
          resourceType: string;
          id: string;
        };
        assert.equal(fullUrl, `${row.fhirBase}/${resourceType}/${id}`);
      }
    });

    it("follows a `next` link the launcher gave", () => {
      const { sent, nexts } = resultOf(attempt).seen;
      assert.ok(
        sent.some(({ url }) => nexts.includes(url.href)),
        "no search took more than one page",
      );
    });

    it("sends every request to the launcher's origin", () => {
      const { sent } = resultOf(attempt).seen;
      assert.ok(sent.every(({ url }) => url.origin === LAUNCHER));
    });

    it("sends the token with every request after the token exchange, and with none before", () => {
      const { sent } = resultOf(attempt).seen;
      const token = sent.findIndex(({ url }) =>
        url.pathname.endsWith("/auth/token"),
      );
      assert.ok(token > 0);
      sent.forEach(({ url, authorized }, at) =>
        assert.equal(authorized, at > token, url.href),
      );
    });
  });

  describe("given a token the launcher did not sign", () => {
    let attempt: Attempt<{ failure: unknown; seen: Seen }>;

    before(async () => {
      const seen: Seen = { sent: [], tokens: [], nexts: [] };
      const fetcher = recorded(seen, (request) => {
        if (!request.headers.has("Authorization")) return request;
        const headers = new Headers(request.headers);
        headers.set(
          "Authorization",
          "Bearer a-token-the-launcher-did-not-sign",
        );
        return new Request(request, { headers });
      });
      const row = launcherRow();
      attempt = await attempted(row, async () => {
        const connection = await connect(row, REGISTRATION, {
          signIn: direct(fetcher),
          fetch: fetcher,
        });
        const failure = await pull(connection, DEMO_PLAN).then(
          () => assert.fail("the pull succeeded"),
          (error: unknown) => error,
        );
        if (
          failure instanceof ConnectionFailure &&
          failure.kind !== "unauthorized"
        )
          throw failure;
        return { failure, seen };
      });
    });

    it("throws `unauthorized`", () => {
      const { failure } = resultOf(attempt);
      assert.ok(failure instanceof ConnectionFailure);
      assert.equal(failure.kind, "unauthorized");
    });

    it("keeps the token out of the failure's message and properties", () => {
      const { failure, seen } = resultOf(attempt);
      assert.ok(failure instanceof ConnectionFailure);
      assert.equal(seen.tokens.length, 1);
      const said = `${failure.message} ${JSON.stringify(failure)}`;
      assert.ok(
        !said.includes(seen.tokens[0]!),
        "the failure carries the token",
      );
    });
  });
});
