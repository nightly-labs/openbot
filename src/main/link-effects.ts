import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** Adapter failure of the Link account. It keeps the original error for the native boundary. */
export class LinkOperationError extends Schema.TaggedError<LinkOperationError>()("LinkOperationError", {
  cause: Schema.Defect(),
}) {}

export const { io: linkCall, sync: linkDecode, rewrap: toLinkOperationError } = causeHelpers(LinkOperationError);
