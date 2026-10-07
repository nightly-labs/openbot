import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** A failure of the 1Password connection. The original error stays as the cause for the native boundary. */
export class OnePasswordOperationError extends Schema.TaggedError<OnePasswordOperationError>()(
  "OnePasswordOperationError",
  { cause: Schema.Defect() },
) {}

export const {
  io: onePasswordCall,
  sync: onePasswordDecode,
  rewrap: toOnePasswordOperationError,
} = causeHelpers(OnePasswordOperationError);
