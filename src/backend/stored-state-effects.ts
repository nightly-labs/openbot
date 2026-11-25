import { Schema } from "effect";
import { causeHelpers } from "./effect-boundary";

export class StoredStateFailure extends Schema.TaggedError<StoredStateFailure>()("StoredStateFailure", {
  cause: Schema.Defect(),
}) {}

export const { io: storedIO, sync: storedSync, rewrap: toStoredStateFailure } = causeHelpers(StoredStateFailure);
