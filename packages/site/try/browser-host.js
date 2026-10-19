// What PodApi needs of this browser to read its pods and its reference tables: the pods kept in IndexedDB, and the
// tables the browser entry holds. The writes and the hospitals join it later.
import { appTables, openPod, podTitle } from "cascade-runtime";

const DATABASE = "cascade-pod:";

/** The names of the databases here whose name starts with `prefix`, without it. */
export async function databases(prefix) {
  return (await indexedDB.databases())
    .map(({ name }) => name ?? "")
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();
}

/** The host `podApi` reads this browser's pods and tables through. */
export function browserHost() {
  return {
    pods: {
      names: () => databases(DATABASE),
      title: (name) => podTitle(name),
      open: (name, options) => openPod(name, options),
    },
    tables: (pod) => appTables(pod),
    opensEncrypted: true,
    unsaid() {},
  };
}
