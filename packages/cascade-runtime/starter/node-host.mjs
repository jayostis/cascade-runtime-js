// The host `podApi` reads on Node: the pods are folders in `folder`, the reference tables are kept beside them.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";
import { brandsBundle, demoRemapFetch } from "@the-cascade-protocol/sandbox";
import {
  directoryOf,
  openPod,
  tablesBeside,
  TEST_DIRECTORY,
} from "cascade-runtime";
import { signIns, worldOf } from "./hospitals.mjs";
import { deletePod, podNames, podTitle, restoreKits } from "./pods.mjs";

/**
 * The pods in `folder` and their tables, for `podApi`. With `opensEncrypted` false, an encrypted pod is refused rather
 * than asked for its words; `unsaid(kind, error)` is told when the tables cannot say what a page would name.
 */
export function nodeHost({ folder, opensEncrypted = true, unsaid = () => {} }) {
  return {
    pods: {
      names: () => podNames(folder),
      title: (name) => podTitle(name, folder),
      open: (name, options) => openPod(join(folder, name), options),
      /** Removes the pods and their answers, with `all` every answer kept; never the reference tables. */
      async remove(names, { all = false } = {}) {
        for (const name of names) await deletePod(name, folder);
        if (all)
          await rm(join(folder, ".answers"), { recursive: true, force: true });
      },
    },
    samples: [],
    restore: () => restoreKits(folder),
    tables: () => tablesBeside(folder),
    checkTables: async () =>
      (await tablesBeside(folder)).check({ cache: "no-cache" }),
    opensEncrypted,
    unsaid,
  };
}

/** A hospital's short name: a demo hospital's host, as `cascade-north`, or else its vendor. */
function idOf(row) {
  return row.vendor === "demo"
    ? new URL(row.fhirBase).hostname.split(".")[0]
    : row.vendor;
}

/**
 * The hospitals and the world's date of the app at `origin`, for its host, and `back(url)` for its `/callback`. `demo`
 * is the demo hospitals as `loadHospitals` gives them, `listener` the running `serveDemo` listener that answers them,
 * as of `asOf` to start with. Each request goes to the listener through `demoRemapFetch`.
 */
export function nodeHospitals(origin, demo, { asOf, listener }) {
  /** The hospitals `demo` holds, the app's own among them, then the test directory's rows. */
  const directory = [
    ...directoryOf(
      brandsBundle(
        demo.map(({ hospital }) => hospital),
        new Date().toISOString(),
      ),
      "demo",
    ),
    ...TEST_DIRECTORY,
  ];
  const { signIn, back } = signIns();
  return {
    hospitals: {
      directory: async () => directory,
      registration: {
        clientId: "cascade-app",
        redirectUri: `${origin}/callback`,
      },
      fetch: demoRemapFetch(listener.origin),
      ready: async () => undefined,
      signIn,
      pullName: idOf,
    },
    world: worldOf(listener, asOf),
    back,
  };
}
