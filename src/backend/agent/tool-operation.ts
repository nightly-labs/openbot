import { Schema } from "effect";
import { causeHelpers } from "../effect-boundary";

/** Expected failures from tool validation and injected storage or provider adapters. */
export class ToolOperationFailed extends Schema.TaggedError<ToolOperationFailed>()("ToolOperationFailed", {
  cause: Schema.Defect(),
}) {}

export const { sync: toolStep, rewrap: toToolOperationFailed } = causeHelpers(ToolOperationFailed);
