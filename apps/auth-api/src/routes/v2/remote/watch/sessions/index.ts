import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  bearerToken,
  json,
  remoteControlPlaneErrorResponse,
  requestUser,
  requestWatchSessions,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/watch/sessions/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            return json(
              yield* requestWatchSessions().create({
                userId: user.id,
                authSessionToken: token,
                publicKey: body.publicKey,
              }),
              201,
            );
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
