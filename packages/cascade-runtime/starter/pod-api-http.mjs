// PodApi over HTTP: `apiRoute` answers `POST /api/<operation>` with JSON, and `podApiOver(origin)` is the same
// operations called through `fetch`, throwing what the in-process ones throw.
import { Refusal, Unopened } from "cascade-runtime";
import { OPERATIONS } from "./pod-api.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
const FAILED = "the server failed; its log says why";

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function jsonOf(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw new Refusal(`the body must be at most ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(new globalThis.TextDecoder().decode(concat(chunks)));
  } catch {
    throw new Refusal("the body must be JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new Refusal("the body must be a JSON object");
  return body;
}

function concat(chunks) {
  const whole = new Uint8Array(chunks.reduce((n, { length }) => n + length, 0));
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.length;
  }
  return whole;
}

/**
 * Answers `POST /api/<operation>` on `api`: 200 with the output; 423 `{ unopened, refused }` for an `Unopened`
 * (checked first, as it is a `Refusal`); 400 `{ refused }` for a `Refusal` or a body over 1 MiB; 404 for an
 * operation not listed; 415 unless the body is JSON; 403 for an `origin` not in `origins`; and for anything else
 * 500 with a fixed sentence, the error going to the log.
 */
export async function apiRoute(api, request, response, { origins }) {
  const operation = /^\/api\/([^/]+)$/.exec(
    new globalThis.URL(request.url, "http://api.invalid").pathname,
  )?.[1];
  if (
    request.method !== "POST" ||
    operation === undefined ||
    !OPERATIONS.includes(operation)
  )
    return send(response, 404, { refused: "no such operation" });
  if (!origins.has(request.headers.origin))
    return send(response, 403, { refused: "a request from another site" });
  if (
    !/^application\/json\s*(;|$)/i.test(request.headers["content-type"] ?? "")
  )
    return send(response, 415, { refused: "send application/json" });
  try {
    send(response, 200, await api[operation](await jsonOf(request)));
  } catch (error) {
    if (error instanceof Unopened)
      return send(response, 423, {
        unopened: error.outcome,
        refused: error.message,
      });
    if (error instanceof Refusal)
      return send(response, 400, { refused: error.message });
    globalThis.console.error(`/api/${operation} failed:`, error);
    send(response, 500, { error: FAILED });
  }
}

/** The operations of `apiRoute`, called at the server whose address is `origin`, which they also send as theirs. */
export function podApiOver(origin) {
  const over = { close: async () => undefined };
  for (const operation of OPERATIONS)
    over[operation] = async (input = {}) => {
      const response = await globalThis.fetch(`${origin}/api/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(input),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return body;
      if (typeof body.refused === "string") {
        if (response.status === 423)
          throw new Unopened(body.unopened, body.refused);
        if (response.status === 400) throw new Refusal(body.refused);
      }
      throw new Error(`${operation}: the server answered ${response.status}`);
    };
  return over;
}
