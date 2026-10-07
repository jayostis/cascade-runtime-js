export type FailureKind =
  | "cancelled"
  | "state-mismatch"
  | "host-not-allowed"
  | "cap-exceeded"
  | "unauthorized"
  | "retries-exhausted"
  | "sign-in-unavailable"
  | "hospital-error";

export interface FailureDetails {
  readonly origin?: string;
  readonly status?: number;
  readonly resourceType?: string;
}

/**
 * Why connecting to a hospital or pulling from it ended early. It is neither a step's `Refusal`, since no step has
 * run, nor a plain `Error`, which says the runtime is broken. It never carries a token, a code, a verifier, a URL's
 * query or a patient's data, and has no `cause`, which could.
 */
export class ConnectionFailure extends Error {
  override readonly name = "ConnectionFailure";
  readonly kind: FailureKind;
  readonly origin: string | undefined;
  readonly status: number | undefined;
  readonly resourceType: string | undefined;

  constructor(
    kind: FailureKind,
    message: string,
    details: FailureDetails = {},
  ) {
    super(message);
    this.kind = kind;
    this.origin = details.origin;
    this.status = details.status;
    this.resourceType = details.resourceType;
  }
}
