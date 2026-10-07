import { ConnectionFailure } from "./outcome.js";
import {
  type DirectoryRow,
  LIMITS,
  type Limits,
  type Registration,
} from "./plan.js";
import { type Fetch, parsed, Requests } from "./requests.js";

/** Takes the person to the hospital's authorize URL, and gives back the URL the hospital redirected them to. */
export type SignIn = (authorize: URL, signal?: AbortSignal) => Promise<URL>;

export interface ConnectOptions {
  readonly signIn: SignIn;
  readonly fetch?: Fetch;
  readonly now?: () => Date;
  readonly limits?: Partial<Limits>;
  readonly signal?: AbortSignal;
}

/** One person signed in to one hospital, held in memory only. */
export interface Connection {
  readonly row: DirectoryRow;
  /** The patient the token is for, by the hospital's id. */
  readonly patient: string;
  readonly scope: string;
  readonly expiresAt: Date | undefined;
}

export interface Held {
  readonly token: string;
  readonly fetch: Fetch;
}

const HELD = new WeakMap<Connection, Held>();

/** The token and the `fetch` a connection was made with, which nothing outside the package sees. */
export function held(connection: Connection): Held {
  const found = HELD.get(connection);
  if (found === undefined)
    throw new TypeError("a connection is made only by connect()");
  return found;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function random(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

function address(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** The FHIR base without one trailing slash, which every address under it is built from. */
export function trimmed(fhirBase: string): string {
  return fhirBase.replace(/\/$/, "");
}

function endpoint(
  value: unknown,
  name: string,
  origin: string,
  loopbackHttp: boolean,
): URL {
  const failure = (why: string) =>
    new ConnectionFailure("hospital-error", `${origin}'s discovery ${why}`, {
      origin,
      resourceType: "discovery",
    });
  if (typeof value !== "string") throw failure(`names no ${name}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw failure(`names no address for ${name}`);
  }
  const allowed =
    url.protocol === "https:" ||
    (loopbackHttp && url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!allowed) throw failure(`names ${name} over ${url.protocol}`);
  return url;
}

/**
 * Signs a person in to a hospital as a SMART standalone patient launch: a public client with PKCE (S256), `state`
 * and `aud`. Contacts only the FHIR base's origin and the authorize and token endpoints its discovery names.
 */
export async function connect(
  row: DirectoryRow,
  registration: Registration,
  options: ConnectOptions,
): Promise<Connection> {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());
  const requests = new Requests(
    fetch,
    { ...LIMITS, ...options.limits },
    options.signal,
  );
  const base = address(trimmed(row.fhirBase));
  if (base === undefined)
    throw new ConnectionFailure(
      "host-not-allowed",
      `${row.name}'s FHIR base is no address`,
    );
  const redirectUri = address(registration.redirectUri);
  if (redirectUri === undefined)
    throw new ConnectionFailure(
      "sign-in-unavailable",
      "the registration's redirect URI is no address",
    );
  if (base.protocol !== "https:")
    throw new ConnectionFailure(
      "host-not-allowed",
      `${row.name}'s FHIR base is over ${base.protocol}, not https:`,
      { origin: base.origin },
    );
  const origin = base.origin;

  const discoveryUrl = new URL(
    `${trimmed(base.href)}/.well-known/smart-configuration`,
  );
  const discovered = await requests.send(discoveryUrl, {
    what: "discovery",
    headers: { Accept: "application/json" },
    retry: true,
  });
  if (discovered.status !== 200)
    throw new ConnectionFailure(
      "hospital-error",
      `${origin} answered ${discovered.status} to discovery`,
      { origin, status: discovered.status, resourceType: "discovery" },
    );
  const configuration = parsed(discovered, discoveryUrl, "discovery");
  const authorizeEndpoint = endpoint(
    configuration.authorization_endpoint,
    "authorization_endpoint",
    origin,
    true,
  );
  const tokenEndpoint = endpoint(
    configuration.token_endpoint,
    "token_endpoint",
    origin,
    false,
  );
  const methods = configuration.code_challenge_methods_supported;
  if (!Array.isArray(methods) || !methods.includes("S256"))
    throw new ConnectionFailure(
      "hospital-error",
      `${origin}'s discovery does not offer S256 for PKCE`,
      { origin, resourceType: "discovery" },
    );

  const verifier = random(32);
  const state = random(16);
  const authorize = new URL(authorizeEndpoint);
  const parameters: Record<string, string> = {
    response_type: "code",
    client_id: registration.clientId,
    redirect_uri: registration.redirectUri,
    scope: registration.scopes.join(" "),
    state,
    aud: row.fhirBase,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  };
  for (const [name, value] of Object.entries(parameters))
    authorize.searchParams.set(name, value);

  const back = await options.signIn(authorize, options.signal);
  const cancelled = requests.cancelled();
  if (cancelled) throw cancelled;
  const code = redirected(back, redirectUri, state, authorizeEndpoint.origin);

  const exchanged = await requests.send(tokenEndpoint, {
    what: "token",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: registration.redirectUri,
      client_id: registration.clientId,
      code_verifier: verifier,
    }).toString(),
    retry: false,
  });
  const tokenOrigin = tokenEndpoint.origin;
  if (exchanged.status !== 200) {
    let error = "";
    try {
      const refused = parsed(exchanged, tokenEndpoint, "token").error;
      if (typeof refused === "string" && /^[a-z_]+$/.test(refused))
        error = `: ${refused}`;
    } catch {
      // A refusal with no JSON body still says its status.
    }
    throw new ConnectionFailure(
      "hospital-error",
      `${tokenOrigin} refused the token exchange with ${exchanged.status}${error}`,
      { origin: tokenOrigin, status: exchanged.status, resourceType: "token" },
    );
  }
  const answer = parsed(exchanged, tokenEndpoint, "token");
  const { access_token: token, token_type: type, patient } = answer;
  const missing = (field: string) =>
    new ConnectionFailure(
      "hospital-error",
      `${tokenOrigin}'s token response has no ${field}`,
      { origin: tokenOrigin, status: exchanged.status, resourceType: "token" },
    );
  if (typeof token !== "string" || token === "") throw missing("access_token");
  if (typeof type !== "string" || type.toLowerCase() !== "bearer")
    throw missing("Bearer token_type");
  if (typeof patient !== "string" || patient === "") throw missing("patient");
  if (!FHIR_ID.test(patient))
    throw new ConnectionFailure(
      "hospital-error",
      `${tokenOrigin}'s token response names a patient by no FHIR id`,
      { origin: tokenOrigin, status: exchanged.status, resourceType: "token" },
    );
  const expiresIn = answer.expires_in;
  const connection: Connection = Object.freeze({
    row,
    patient,
    scope:
      typeof answer.scope === "string" && answer.scope !== ""
        ? answer.scope
        : parameters.scope!,
    expiresAt:
      typeof expiresIn === "number" && Number.isFinite(expiresIn)
        ? new Date(now().getTime() + expiresIn * 1000)
        : undefined,
  });
  HELD.set(connection, { token, fetch });
  return connection;
}

/** The code the redirect carries, once its address and `state` are the ones sent. */
function redirected(
  back: URL,
  expected: URL,
  state: string,
  origin: string,
): string {
  if (back.origin !== expected.origin || back.pathname !== expected.pathname)
    throw new ConnectionFailure(
      "state-mismatch",
      "the sign-in came back somewhere other than the registered redirect URI",
      { origin },
    );
  if (back.searchParams.get("state") !== state)
    throw new ConnectionFailure(
      "state-mismatch",
      "the sign-in came back with another state",
      { origin },
    );
  const error = back.searchParams.get("error");
  if (error === "access_denied")
    throw new ConnectionFailure(
      "cancelled",
      "the person cancelled the sign-in",
      {
        origin,
      },
    );
  if (error !== null)
    throw new ConnectionFailure(
      "hospital-error",
      /^[a-z_]+$/.test(error)
        ? `the hospital refused the sign-in: ${error}`
        : "the hospital refused the sign-in",
      { origin },
    );
  const code = back.searchParams.get("code");
  if (code === null || code === "")
    throw new ConnectionFailure(
      "hospital-error",
      "the sign-in came back with no code",
      { origin },
    );
  return code;
}
