import { Effect, Schema } from "effect";

class HostLogoError extends Schema.TaggedError<HostLogoError>()("HostLogoError", {}) {}

import { isUuidV4 } from "@openbot/contracts/validation";

export function hostLogoObjectKey(hostId: string, version: string): string {
  if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(hostId) || !isUuidV4(version)) throw new Error("Invalid host logo key.");
  return `remote-hosts/${hostId}/logos/${version}`;
}

/**
 * The stored logo of one host version. The caller checks that the reader is a member and that
 * `version` is the current logo key. Null when the object is missing.
 */
export const readHostLogo = Effect.fn("HostLogo.read")(function* (bucket: R2Bucket, hostId: string, version: string) {
  const object = yield* Effect.tryPromise({
    try: () => bucket.get(hostLogoObjectKey(hostId, version)),
    catch: () => new HostLogoError({}),
  });
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: object.httpEtag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
