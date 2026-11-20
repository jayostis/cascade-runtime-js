import type { Layout } from "../layout.js";

export async function catFile(
  _pod: string,
  _layout: Layout,
  _path: string,
): Promise<Uint8Array> {
  throw new Error("not yet");
}

export async function unpack(
  _from: string,
  _to: string,
  _layout: Layout,
): Promise<number> {
  throw new Error("not yet");
}
