import { Effect, Option, Schema } from "effect";

const VIES_CHECK_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const VIES_DEADLINE_MS = 20_000;
const VIES_ATTEMPT_TIMEOUT_MS = 9_000;
const VIES_MIN_ATTEMPT_MS = 2_000;
const VIES_RETRY_DELAY_MS = 1_000;
const VIES_MAX_ATTEMPTS = 3;
const VIES_REQUESTER_ERRORS = new Set(["INVALID_REQUESTER_INFO", "VOW-ERR-2700"]);

export type ViesFetch = (input: string, init: RequestInit) => Promise<Response>;

export class ViesUnavailableError extends Schema.TaggedError<ViesUnavailableError>()("ViesUnavailableError", {}) {}

export interface ViesResult {
  valid: boolean;
  requestIdentifier: string | null;
  requestDate: string | null;
}

export interface ViesTiming {
  deadlineMs: number;
  attemptTimeoutMs: number;
  minAttemptMs: number;
  retryDelayMs: number;
}

type ViesAttempt = { kind: "answered"; result: ViesResult } | { kind: "requesterRefused" } | { kind: "unavailable" };

const checkSchema = Schema.Struct({
  valid: Schema.Boolean,
  requestIdentifier: Schema.optional(Schema.NullOr(Schema.String)),
  requestDate: Schema.optional(Schema.NullOr(Schema.String)),
});
const failureSchema = Schema.Struct({
  errorWrappers: Schema.Array(Schema.Struct({ error: Schema.optional(Schema.String) })),
});

const VIES_UNAVAILABLE: ViesAttempt = { kind: "unavailable" };

const DEFAULT_TIMING: ViesTiming = {
  deadlineMs: VIES_DEADLINE_MS,
  attemptTimeoutMs: VIES_ATTEMPT_TIMEOUT_MS,
  minAttemptMs: VIES_MIN_ATTEMPT_MS,
  retryDelayMs: VIES_RETRY_DELAY_MS,
};

function readAttempt(ok: boolean, value: unknown): ViesAttempt {
  const checked = Schema.decodeUnknownOption(checkSchema)(value);
  if (ok && Option.isSome(checked)) {
    return {
      kind: "answered",
      result: {
        valid: checked.value.valid,
        requestIdentifier: checked.value.requestIdentifier || null,
        requestDate: checked.value.requestDate || null,
      },
    };
  }
  const failure = Schema.decodeUnknownOption(failureSchema)(value);
  const errors = Option.isSome(failure) ? failure.value.errorWrappers.map((wrapper) => wrapper.error ?? "") : [];
  if (errors.includes("INVALID_INPUT"))
    return { kind: "answered", result: { valid: false, requestIdentifier: null, requestDate: null } };
  if (errors.some((error) => VIES_REQUESTER_ERRORS.has(error))) return { kind: "requesterRefused" };
  return { kind: "unavailable" };
}

export class ViesClient {
  constructor(
    private readonly fetcher: ViesFetch,
    private readonly requester: string | null,
    private readonly url: string = VIES_CHECK_URL,
    private readonly timing: ViesTiming = DEFAULT_TIMING,
  ) {}

  private readonly attempt = Effect.fn("ViesClient.attempt")(function* (
    this: ViesClient,
    vatId: string,
    requester: string | null,
    timeoutMs: number,
  ): Effect.fn.Return<ViesAttempt> {
    const body: Record<string, string> = { countryCode: vatId.slice(0, 2), vatNumber: vatId.slice(2) };
    if (requester) {
      body.requesterMemberStateCode = requester.slice(0, 2);
      body.requesterNumber = requester.slice(2);
    }
    return yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await this.fetcher(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
        return readAttempt(response.ok, await response.json());
      },
      catch: () => new ViesUnavailableError({}),
    }).pipe(Effect.orElseSucceed(() => VIES_UNAVAILABLE));
  }).bind(this);

  readonly check = Effect.fn("ViesClient.check")(function* (
    this: ViesClient,
    vatId: string,
  ): Effect.fn.Return<ViesResult, ViesUnavailableError> {
    const deadline = Date.now() + this.timing.deadlineMs;
    let requester = this.requester;
    for (let attempts = 0; attempts < VIES_MAX_ATTEMPTS; attempts++) {
      const remaining = deadline - Date.now();
      if (remaining < this.timing.minAttemptMs) break;
      const attempt = yield* this.attempt(vatId, requester, Math.min(this.timing.attemptTimeoutMs, remaining));
      if (attempt.kind === "answered") return attempt.result;
      if (attempt.kind === "requesterRefused" && requester) {
        console.error("billing: VIES refused VIES_REQUESTER_VAT_ID; checking the VAT ID without a requester");
        requester = null;
      } else if (deadline - Date.now() > this.timing.retryDelayMs + this.timing.minAttemptMs) {
        yield* Effect.sleep(this.timing.retryDelayMs);
      }
    }
    return yield* new ViesUnavailableError({});
  }).bind(this);
}
