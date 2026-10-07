import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class AnalyticsOperationFailure extends Schema.TaggedError<AnalyticsOperationFailure>()(
  "AnalyticsOperationFailure",
  {
    cause: Schema.Defect(),
  },
) {}

export const {
  io: analyticsIO,
  sync: analyticsSync,
  rewrap: toAnalyticsOperationFailure,
} = causeHelpers(AnalyticsOperationFailure);
