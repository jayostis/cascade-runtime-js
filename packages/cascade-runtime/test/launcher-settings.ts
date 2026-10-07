const FIELDS = [
  "launchType",
  "patient",
  "provider",
  "encounter",
  "skipLogin",
  "skipAuth",
  "simEhr",
  "scope",
  "redirectUris",
  "clientId",
  "clientSecret",
  "authError",
  "jwksUrl",
  "jwks",
  "clientType",
  "pkce",
  "fhirServer",
] as const;

/** The SMART launcher's settings, by name, in the order of its `src/isomorphic/codec.ts`. */
export type LauncherSettings = Record<(typeof FIELDS)[number], string | number>;

const SIM = /\/sim\/([^/]+)\/fhir$/;

/** The settings a launcher FHIR base carries in its `/sim/<settings>/fhir` segment. */
export function launcherSettings(fhirBase: string): LauncherSettings {
  const sim = SIM.exec(new URL(fhirBase).pathname)?.[1];
  if (sim === undefined) throw new Error(`no launcher settings in ${fhirBase}`);
  const values = JSON.parse(Buffer.from(sim, "base64url").toString("utf8")) as (
    string | number
  )[];
  return Object.fromEntries(
    FIELDS.map((field, at) => [field, values[at]!]),
  ) as LauncherSettings;
}

/** `fhirBase` with its settings replaced by `settings`. */
export function withLauncherSettings(
  fhirBase: string,
  settings: LauncherSettings,
): string {
  const sim = Buffer.from(
    JSON.stringify(FIELDS.map((field) => settings[field])),
    "utf8",
  ).toString("base64url");
  const url = new URL(fhirBase);
  url.pathname = url.pathname.replace(SIM, `/sim/${sim}/fhir`);
  return url.href;
}
