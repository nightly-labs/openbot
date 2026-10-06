import { Context, Effect, Layer, Schema } from "effect";
import { HostedSiteInputError } from "./hosted-site-contract";

class HostedSiteStorageError extends Schema.TaggedError<HostedSiteStorageError>()("HostedSiteStorageError", {
  message: Schema.String,
}) {}
export type HostedSiteFailure = HostedSiteInputError | HostedSiteStorageError;
export const siteFailure = (error: unknown): HostedSiteFailure =>
  error instanceof HostedSiteInputError || error instanceof HostedSiteStorageError
    ? error
    : new HostedSiteStorageError({
        message: error instanceof Error ? error.message : "Site storage operation failed.",
      });
export const siteCall = <A>(operation: () => Promise<A>) => Effect.tryPromise({ try: operation, catch: siteFailure });
export const siteDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: siteFailure });

/** Each site operation receives the current Worker's bindings. */
export class HostedSiteStorage extends Context.Service<HostedSiteStorage, { database: D1Database; bucket: R2Bucket }>()(
  "@openbot/auth-api/HostedSiteStorage",
) {
  static layer(database: D1Database, bucket: R2Bucket) {
    return Layer.succeed(HostedSiteStorage, HostedSiteStorage.of({ database, bucket }));
  }
}
