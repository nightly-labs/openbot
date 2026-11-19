import { Effect, Option, Schema } from "effect";

/** The EU Commission's VAT ID check (VIES). A test passes the test service, which answers set numbers. */
const VIES_CHECK_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const VIES_TIMEOUT_MS = 10_000;

export type ViesFetch = (input: string, init: RequestInit) => Promise<Response>;

/** VIES or the tax office of the member state did not answer. The ID is neither valid nor invalid. */
export class ViesUnavailableError extends Schema.TaggedError<ViesUnavailableError>()("ViesUnavailableError", {}) {}

/** The answer for one VAT ID. `requestIdentifier` is the consultation number, the proof of the check. */
export interface ViesResult {
  valid: boolean;
  requestIdentifier: string | null;
  requestDate: string | null;
}

const checkSchema = Schema.Struct({
  valid: Schema.Boolean,
  requestIdentifier: Schema.optional(Schema.NullOr(Schema.String)),
  requestDate: Schema.optional(Schema.NullOr(Schema.String)),
});
const failureSchema = Schema.Struct({
  errorWrappers: Schema.Array(Schema.Struct({ error: Schema.optional(Schema.String) })),
});

export class ViesClient {
  /**
   * @param requester The seller's own VAT ID, such as `PL1234567890`. With it, VIES gives a consultation
   * number for each check. Without it, the check still works.
   */
  constructor(
    private readonly fetcher: ViesFetch,
    private readonly requester: string | null,
    private readonly url: string = VIES_CHECK_URL,
  ) {}

  /** Checks a stored VAT ID (`normalizeVatId`): its first two letters are the VIES country code. */
  readonly check = Effect.fn("ViesClient.check")(function* (
    this: ViesClient,
    vatId: string,
  ): Effect.fn.Return<ViesResult, ViesUnavailableError> {
    const body: Record<string, string> = { countryCode: vatId.slice(0, 2), vatNumber: vatId.slice(2) };
    if (this.requester) {
      body.requesterMemberStateCode = this.requester.slice(0, 2);
      body.requesterNumber = this.requester.slice(2);
    }
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.fetcher(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(VIES_TIMEOUT_MS)]),
        }),
      catch: () => new ViesUnavailableError({}),
    });
    const value = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new ViesUnavailableError({}),
    });
    const checked = Schema.decodeUnknownOption(checkSchema)(value);
    if (response.ok && Option.isSome(checked)) {
      return {
        valid: checked.value.valid,
        requestIdentifier: checked.value.requestIdentifier || null,
        requestDate: checked.value.requestDate || null,
      };
    }
    // VIES answers a number in a form that no member state uses with `INVALID_INPUT`. Every other error,
    // such as `MS_UNAVAILABLE` or `SERVICE_UNAVAILABLE`, says nothing about the number.
    const failure = Schema.decodeUnknownOption(failureSchema)(value);
    if (Option.isSome(failure) && failure.value.errorWrappers.some((wrapper) => wrapper.error === "INVALID_INPUT")) {
      return { valid: false, requestIdentifier: null, requestDate: null };
    }
    return yield* new ViesUnavailableError({});
  }).bind(this);
}
