import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class LinkOperationError extends Schema.TaggedError<LinkOperationError>()("LinkOperationError", {
  cause: Schema.Defect(),
}) {}

export const { io: linkCall, sync: linkDecode, rewrap: toLinkOperationError } = causeHelpers(LinkOperationError);
