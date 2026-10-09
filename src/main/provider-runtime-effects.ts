import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class ProviderRuntimeFailure extends Schema.TaggedError<ProviderRuntimeFailure>()("ProviderRuntimeFailure", {
  cause: Schema.Defect(),
}) {}

export const {
  io: runtimeIO,
  sync: runtimeSync,
  rewrap: toProviderRuntimeFailure,
} = causeHelpers(ProviderRuntimeFailure);
