import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** Keep driver diagnostics inside the main-process boundary. */
export class CuaDriverFailure extends Schema.TaggedError<CuaDriverFailure>()("CuaDriverFailure", {
  cause: Schema.Defect(),
}) {}

export const { io: cuaIO, sync: cuaSync, rewrap: toCuaDriverFailure } = causeHelpers(CuaDriverFailure);
