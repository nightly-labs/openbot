import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import {
  AvatarUploadError,
  readAvatarUpload,
  removeAccountAvatar,
  storeAccountAvatar,
} from "../../../server/avatar-storage";
import { runApiResponse } from "../../../server/effect-runtime";
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
      PUT: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const service = requestAuthService();
            const user = yield* service.authenticate(token);
            if (!user) return apiError(401, "unauthorized", "The session is invalid.");
            const upload = yield* readAvatarUpload(request);
            return json(yield* storeAccountAvatar(service, requestAvatarBucket(), token, user, upload));
          }),
          (error) => {
            if (error instanceof AvatarUploadError) {
              return apiError(error.status, error.code, error.message);
            }
            return authErrorResponse(error);
          },
        ),
      DELETE: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const service = requestAuthService();
            const user = yield* service.authenticate(token);
            if (!user) return apiError(401, "unauthorized", "The session is invalid.");
            return json(yield* removeAccountAvatar(service, requestAvatarBucket(), token, user));
          }),
          authErrorResponse,
        ),
    },
  },
});
