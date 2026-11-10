import { redactText } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import { causeHelpers } from "./effect-boundary";
import { getString } from "./protocol";

/** Preserves provider SDK failures at the existing Promise interfaces. */
export class ProviderClientOperationError extends Schema.TaggedError<ProviderClientOperationError>()(
  "ProviderClientOperationError",
  {
    cause: Schema.Defect(),
  },
) {}

export const { rewrap: toProviderClientOperationError } = causeHelpers(ProviderClientOperationError);

/** A sign-in failure with a safe message for the user. The provider status shows it as it is. */
export class ProviderSignInError extends Schema.TaggedError<ProviderSignInError>()("ProviderSignInError", {
  message: Schema.String,
}) {}

/** The most characters of a provider's own reason that a failed sign-in shows. */
const SIGN_IN_REASON_LIMIT = 200;

/** A provider's reason for a failed sign-in, redacted and short, or `null` when it gave none. */
export function signInReason(text: string | null | undefined): string | null {
  const reason = redactText((text ?? "").trim().replace(/\s+/gu, " "));
  if (!reason) return null;
  const characters = Array.from(reason);
  return characters.length > SIGN_IN_REASON_LIMIT
    ? `${characters.slice(0, SIGN_IN_REASON_LIMIT - 1).join("")}…`
    : reason;
}

export function providerFailure(cause: unknown): ProviderClientOperationError {
  return cause instanceof ProviderClientOperationError ? cause : new ProviderClientOperationError({ cause });
}
export function providerCall<A>(operation: () => A | Promise<A>): Effect.Effect<A, ProviderClientOperationError> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: providerFailure });
}
export const providerSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: providerFailure });

/** Lets a native catch keep loop control and inspect the original operational error. */
export function providerResult<A>(result: Result.Result<A, ProviderClientOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}

export function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}
