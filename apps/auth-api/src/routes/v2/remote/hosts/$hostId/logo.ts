import { isUuidV4 } from "@openbot/contracts/validation";
import { createFileRoute } from "@tanstack/solid-router";
import { AvatarUploadError, readAvatarUpload } from "../../../../../server/avatar-storage";
import { runApiEffect } from "../../../../../server/effect-runtime";
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
      GET: async ({ request, params }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const { logoKey } = await runApiEffect(requestRemoteControlPlane().hostAsset(user.id, params.hostId));
          if (!logoKey || new URL(request.url).searchParams.get("v") !== logoKey) {
            return new Response("Not found", { status: 404 });
          }
          return (
            (await runApiEffect(readHostLogo(requestAvatarBucket(), params.hostId, logoKey))) ??
            new Response("Not found", { status: 404 })
          );
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
      PUT: async ({ request, params }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          await runApiEffect(requestRemoteControlPlane().assertHostOwner(user.id, params.hostId));
          const upload = await runApiEffect(readAvatarUpload(request));
          const requestedVersion = request.headers.get("OpenBot-Logo-Version");
          const version = requestedVersion && isUuidV4(requestedVersion) ? requestedVersion : crypto.randomUUID();
          const currentVersion = (await runApiEffect(requestRemoteControlPlane().hostAsset(user.id, params.hostId)))
            .logoKey;
          const bucket = requestAvatarBucket();
          const key = hostLogoObjectKey(params.hostId, version);
          await bucket.put(key, upload.bytes, {
            httpMetadata: { contentType: upload.mimeType, cacheControl: "private, max-age=31536000, immutable" },
          });
          try {
            const previous = await runApiEffect(
              requestRemoteControlPlane().setHostLogo(user.id, params.hostId, version),
            );
            if (previous && previous !== version)
              await bucket.delete(hostLogoObjectKey(params.hostId, previous)).catch(() => undefined);
          } catch (error) {
            if (currentVersion !== version) await bucket.delete(key).catch(() => undefined);
            throw error;
          }
          return Response.json({ logoKey: version }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          if (error instanceof AvatarUploadError) return apiError(error.status, error.code, error.message);
          return remoteControlPlaneErrorResponse(error);
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const previous = await runApiEffect(requestRemoteControlPlane().setHostLogo(user.id, params.hostId, null));
          if (previous)
            await requestAvatarBucket()
              .delete(hostLogoObjectKey(params.hostId, previous))
              .catch(() => undefined);
          return new Response(null, { status: 204 });
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
