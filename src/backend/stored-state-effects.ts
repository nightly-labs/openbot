import { Schema } from "effect";
import { causeHelpers } from "./effect-boundary";

/** Expected storage failures retain their cause for mapping at application boundaries. */
export class StoredStateFailure extends Schema.TaggedError<StoredStateFailure>()("StoredStateFailure", {
  cause: Schema.Defect(),
}) {}

export const { io: storedIO, sync: storedSync, rewrap: toStoredStateFailure } = causeHelpers(StoredStateFailure);
