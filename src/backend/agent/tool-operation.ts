import { Schema } from "effect";
import { causeHelpers } from "../effect-boundary";

export class ToolOperationFailed extends Schema.TaggedError<ToolOperationFailed>()("ToolOperationFailed", {
  cause: Schema.Defect(),
}) {}

export const { sync: toolStep, rewrap: toToolOperationFailed } = causeHelpers(ToolOperationFailed);
