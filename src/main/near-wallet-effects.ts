import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** Adapter failure of the NEAR Intents wallet. It keeps the original error for the native boundary. */
export class NearOperationError extends Schema.TaggedError<NearOperationError>()("NearOperationError", {
  cause: Schema.Defect(),
}) {}

export const { io: nearCall, sync: nearDecode, rewrap: toNearOperationError } = causeHelpers(NearOperationError);

/** A failure with a sentence that the owner or the agent can read, made with `sourceText`. */
export function nearFailure(message: string): NearOperationError {
  return new NearOperationError({ cause: new Error(message) });
}

/** The sentence of a failure. A value that is not an `Error` has no sentence of its own. */
export function nearMessage(error: NearOperationError): string {
  const cause = error.cause;
  return cause instanceof Error ? cause.message : String(cause);
}
