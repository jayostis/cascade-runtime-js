const NI = "ni:///sha-256;";
const UUID = "urn:uuid:";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A document's name from its bytes (runtime/rules.md, N5). */
export async function documentName(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return NI + base64url(new Uint8Array(digest));
}

/** The name a file holding the named thing takes, before its folder and suffix (runtime/rules.md, N9). */
export function fileStem(name: string): string {
  if (name.startsWith(UUID)) return name.slice(UUID.length);
  if (name.startsWith(NI)) {
    const encoded = name.slice(NI.length).replace(/-/g, "+").replace(/_/g, "/");
    return [...atob(encoded)]
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }
  throw new Error(`${name} names no file`);
}
