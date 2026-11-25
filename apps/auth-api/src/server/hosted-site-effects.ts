import { Context, Effect, Layer, Schema } from "effect";
import { HostedSiteInputError } from "./hosted-site-contract";

export class HostedSiteStorageError extends Schema.TaggedError<HostedSiteStorageError>()("HostedSiteStorageError", {
  message: Schema.String,
}) {}
class HostedSiteInternalError extends Schema.TaggedError<HostedSiteInternalError>()("HostedSiteInternalError", {
  message: Schema.String,
}) {}
export type HostedSiteFailure = HostedSiteInputError | HostedSiteStorageError | HostedSiteInternalError;
const isHostedSiteFailure = (error: unknown): error is HostedSiteFailure =>
  error instanceof HostedSiteInputError ||
  error instanceof HostedSiteStorageError ||
  error instanceof HostedSiteInternalError;
export const siteFailure = (error: unknown): HostedSiteFailure =>
  isHostedSiteFailure(error)
    ? error
    : new HostedSiteInternalError({
        message: error instanceof Error ? error.message : "Site operation failed.",
      });
const storageFailure = (error: unknown): HostedSiteFailure =>
  isHostedSiteFailure(error)
    ? error
    : new HostedSiteStorageError({
        message: error instanceof Error ? error.message : "Site storage operation failed.",
      });
export const siteCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: storageFailure });
export const siteDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: siteFailure });

export class HostedSiteStorage extends Context.Service<HostedSiteStorage, { database: D1Database; bucket: R2Bucket }>()(
  "@openbot/auth-api/HostedSiteStorage",
) {
  static layer(database: D1Database, bucket: R2Bucket) {
    return Layer.succeed(HostedSiteStorage, HostedSiteStorage.of({ database, bucket }));
  }
}
