import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class NearOperationError extends Schema.TaggedError<NearOperationError>()("NearOperationError", {
  cause: Schema.Defect(),
}) {}

export const { io: nearCall, sync: nearDecode, rewrap: toNearOperationError } = causeHelpers(NearOperationError);

export function nearFailure(message: string): NearOperationError {
  return new NearOperationError({ cause: new Error(message) });
}

export function nearMessage(error: NearOperationError): string {
  const cause = error.cause;
  return cause instanceof Error ? cause.message : String(cause);
}
