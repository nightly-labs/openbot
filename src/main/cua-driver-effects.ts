import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class CuaDriverFailure extends Schema.TaggedError<CuaDriverFailure>()("CuaDriverFailure", {
  cause: Schema.Defect(),
}) {}

export const { io: cuaIO, sync: cuaSync, rewrap: toCuaDriverFailure } = causeHelpers(CuaDriverFailure);
