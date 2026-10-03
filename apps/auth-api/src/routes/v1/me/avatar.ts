import { createFileRoute } from "@tanstack/solid-router";
import {
  AvatarUploadError,
  readAvatarUpload,
  removeAccountAvatar,
  storeAccountAvatar,
} from "../../../server/avatar-storage";
import { runApiEffect } from "../../../server/effect-runtime";
import {
  apiError,
  authErrorResponse,
  bearerToken,
  json,
  requestAuthService,
  requestAvatarBucket,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/me/avatar")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          const service = requestAuthService();
          const user = await runApiEffect(service.authenticate(token));
          if (!user) return apiError(401, "unauthorized", "The session is invalid.");
          const upload = await runApiEffect(readAvatarUpload(request));
          return json(await runApiEffect(storeAccountAvatar(service, requestAvatarBucket(), token, user, upload)));
        } catch (error) {
          if (error instanceof AvatarUploadError) {
            return apiError(error.status, error.code, error.message);
          }
          return authErrorResponse(error);
        }
      },
      DELETE: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          const service = requestAuthService();
          const user = await runApiEffect(service.authenticate(token));
          if (!user) return apiError(401, "unauthorized", "The session is invalid.");
          return json(await runApiEffect(removeAccountAvatar(service, requestAvatarBucket(), token, user)));
        } catch (error) {
          return authErrorResponse(error);
        }
      },
    },
  },
});
