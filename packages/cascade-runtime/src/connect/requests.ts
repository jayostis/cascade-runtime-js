import { ConnectionFailure } from "./outcome.js";
import type { Limits } from "./plan.js";

export type Fetch = typeof fetch;

const MAX_HOPS = 5;

export interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

export interface Sending {
  /** Names what is asked for in a failure's message: a FHIR type, or a part of the protocol. */
  readonly what: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** Whether a 429, a 5xx, a transport error or a timeout is tried again. */
  readonly retry: boolean;
  /**
   * The one origin a redirect may be followed to; with none, a redirect is the hospital's error. A browser's `fetch`
   * hides where a redirect goes, so in a browser none is followed.
   */
  readonly follow?: string;
}

/** One call's requests: each counted, timed out, retried and capped as its limits say. */
export class Requests {
  readonly #fetch: Fetch;
  readonly #limits: Limits;
  readonly #signal: AbortSignal | undefined;
  #sent = 0;
  #read = 0;

  constructor(fetch: Fetch, limits: Limits, signal?: AbortSignal) {
    this.#fetch = fetch;
    this.#limits = limits;
    this.#signal = signal;
  }

  cancelled(): ConnectionFailure | undefined {
    return this.#signal?.aborted
      ? new ConnectionFailure("cancelled", "the connection was cancelled")
      : undefined;
  }

  async send(start: URL, sending: Sending): Promise<Answer> {
    let url = start;
    let hops = 0;
    let tries = 0;
    for (;;) {
      const at = { origin: url.origin, resourceType: sending.what };
      this.#count(at);
      const outcome = await this.#once(url, sending);
      if (outcome instanceof ConnectionFailure) throw outcome;
      if (outcome === "transport") {
        if (sending.retry && tries < this.#limits.retries) {
          await this.#wait(this.#backoff(tries++));
          continue;
        }
        throw new ConnectionFailure(
          sending.retry ? "retries-exhausted" : "hospital-error",
          `${url.origin} could not be reached for ${sending.what}`,
          at,
        );
      }
      const { status, headers } = outcome;
      if (status === 429 || status >= 500) {
        if (!sending.retry) return outcome;
        if (tries < this.#limits.retries) {
          await this.#wait(this.#retryAfter(headers) ?? this.#backoff(tries));
          tries++;
          continue;
        }
        throw new ConnectionFailure(
          "retries-exhausted",
          `${url.origin} answered ${status} to every try for ${sending.what}`,
          { ...at, status },
        );
      }
      if (status === 0 || (status >= 300 && status < 400)) {
        url = this.#redirected(url, headers, status, sending, ++hops);
        continue;
      }
      return outcome;
    }
  }

  #count(at: { origin: string; resourceType: string }): void {
    const cancelled = this.cancelled();
    if (cancelled) throw cancelled;
    if (++this.#sent > this.#limits.requests)
      throw new ConnectionFailure(
        "cap-exceeded",
        `more than ${this.#limits.requests} requests`,
        at,
      );
  }

  #redirected(
    from: URL,
    headers: Headers,
    status: number,
    sending: Sending,
    hops: number,
  ): URL {
    const at = { origin: from.origin, status, resourceType: sending.what };
    const location = headers.get("Location");
    if (sending.follow !== undefined && status === 0)
      throw new ConnectionFailure(
        "hospital-error",
        `${from.origin} redirected ${sending.what}, and a browser does not say where to`,
        at,
      );
    if (sending.follow === undefined || location === null)
      throw new ConnectionFailure(
        "hospital-error",
        `${from.origin} redirected ${sending.what}, which is not followed`,
        at,
      );
    if (hops > MAX_HOPS)
      throw new ConnectionFailure(
        "hospital-error",
        `${from.origin} redirected ${sending.what} more than ${MAX_HOPS} times`,
        at,
      );
    let to: URL;
    try {
      to = new URL(location, from);
    } catch {
      throw new ConnectionFailure(
        "hospital-error",
        `${from.origin} redirected ${sending.what} to no address`,
        at,
      );
    }
    if (to.origin !== sending.follow)
      throw new ConnectionFailure(
        "host-not-allowed",
        `${from.origin} redirected ${sending.what} to ${to.origin}, which is not the FHIR base's origin`,
        at,
      );
    return to;
  }

  async #once(
    url: URL,
    sending: Sending,
  ): Promise<Answer | "transport" | ConnectionFailure> {
    const signals = [AbortSignal.timeout(this.#limits.requestTimeoutMs)];
    if (this.#signal) signals.push(this.#signal);
    const signal = AbortSignal.any(signals);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: sending.method ?? "GET",
        headers: sending.headers ?? {},
        body: sending.body ?? null,
        credentials: "omit",
        cache: "no-store",
        redirect: "manual",
        signal,
      });
    } catch {
      return this.cancelled() ?? "transport";
    }
    try {
      const body = await this.#body(response, url, sending.what);
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      if (error instanceof ConnectionFailure) return error;
      return this.cancelled() ?? "transport";
    }
  }

  async #body(response: Response, url: URL, what: string): Promise<Uint8Array> {
    const cap = Math.min(
      this.#limits.responseBytes,
      this.#limits.pullBytes - this.#read,
    );
    const exceeded = () =>
      new ConnectionFailure(
        "cap-exceeded",
        `${url.origin}'s answer for ${what} passed the limit on bytes`,
        { origin: url.origin, status: response.status, resourceType: what },
      );
    const length = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(length) && length > cap) {
      await response.body?.cancel();
      throw exceeded();
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body !== null) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        this.#read += value.byteLength;
        if (size > cap) {
          await reader.cancel();
          throw exceeded();
        }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  }

  #backoff(tries: number): number {
    return Math.min(
      this.#limits.retryDelayMs * 2 ** tries,
      this.#limits.maxRetryDelayMs,
    );
  }

  #retryAfter(headers: Headers): number | undefined {
    const value = headers.get("Retry-After")?.trim();
    if (!value) return undefined;
    const ms = /^\d+$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now();
    if (Number.isNaN(ms)) return undefined;
    return Math.min(Math.max(ms, 0), this.#limits.maxRetryDelayMs);
  }

  #wait(ms: number): Promise<void> {
    const signal = this.#signal;
    return new Promise((resolve, reject) => {
      const cancelled = () => {
        clearTimeout(timer);
        reject(this.cancelled());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", cancelled);
        resolve();
      }, ms);
      if (signal?.aborted) cancelled();
      else signal?.addEventListener("abort", cancelled, { once: true });
    });
  }
}

/** The JSON object a body holds, or the hospital's error for one that holds none. */
export function parsed(
  answer: Answer,
  url: URL,
  what: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(answer.body));
  } catch {
    value = undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ConnectionFailure(
      "hospital-error",
      `${url.origin}'s answer for ${what} is not a JSON object`,
      { origin: url.origin, status: answer.status, resourceType: what },
    );
  return value as Record<string, unknown>;
}
