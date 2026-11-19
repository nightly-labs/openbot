import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class OnePasswordOperationError extends Schema.TaggedError<OnePasswordOperationError>()(
  "OnePasswordOperationError",
  { cause: Schema.Defect() },
) {}

export const {
  io: onePasswordCall,
  sync: onePasswordDecode,
  rewrap: toOnePasswordOperationError,
} = causeHelpers(OnePasswordOperationError);
