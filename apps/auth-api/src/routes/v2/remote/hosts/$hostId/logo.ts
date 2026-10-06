import { isUuidV4 } from "@openbot/contracts/validation";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { AvatarUploadError, readAvatarUpload } from "../../../../../server/avatar-storage";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { hostLogoObjectKey, readHostLogo } from "../../../../../server/host-logo";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestAvatarBucket,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/logo")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const { logoKey } = yield* requestRemoteControlPlane().hostAsset(user.id, params.hostId);
            if (!logoKey || new URL(request.url).searchParams.get("v") !== logoKey) {
              return new Response("Not found", { status: 404 });
            }
            return (
              (yield* readHostLogo(requestAvatarBucket(), params.hostId, logoKey)) ??
              new Response("Not found", { status: 404 })
            );
          }),
          remoteControlPlaneErrorResponse,
        ),
      PUT: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* requestRemoteControlPlane().assertHostOwner(user.id, params.hostId);
            const upload = yield* readAvatarUpload(request);
            const requestedVersion = request.headers.get("OpenBot-Logo-Version");
            const version = requestedVersion && isUuidV4(requestedVersion) ? requestedVersion : crypto.randomUUID();
            const currentVersion = (yield* requestRemoteControlPlane().hostAsset(user.id, params.hostId)).logoKey;
            const bucket = requestAvatarBucket();
            const key = hostLogoObjectKey(params.hostId, version);
            yield* Effect.promise(() =>
              bucket.put(key, upload.bytes, {
                httpMetadata: { contentType: upload.mimeType, cacheControl: "private, max-age=31536000, immutable" },
              }),
            );
            yield* Effect.gen(function* () {
              const previous = yield* requestRemoteControlPlane().setHostLogo(user.id, params.hostId, version);
              if (previous && previous !== version) {
                const previousKey = hostLogoObjectKey(params.hostId, previous);
                yield* Effect.tryPromise(() => bucket.delete(previousKey)).pipe(Effect.ignore);
              }
            }).pipe(
              Effect.onError(() =>
                currentVersion !== version
                  ? Effect.tryPromise(() => bucket.delete(key)).pipe(Effect.ignore)
                  : Effect.void,
              ),
            );
            return Response.json({ logoKey: version }, { headers: { "Cache-Control": "no-store" } });
          }),
          (error) => {
            if (error instanceof AvatarUploadError) return apiError(error.status, error.code, error.message);
            return remoteControlPlaneErrorResponse(error);
          },
        ),
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const previous = yield* requestRemoteControlPlane().setHostLogo(user.id, params.hostId, null);
            if (previous) {
              const bucket = requestAvatarBucket();
              const previousKey = hostLogoObjectKey(params.hostId, previous);
              yield* Effect.tryPromise(() => bucket.delete(previousKey)).pipe(Effect.ignore);
            }
            return new Response(null, { status: 204 });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
