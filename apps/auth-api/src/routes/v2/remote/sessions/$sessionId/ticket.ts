import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { sha256 } from "../../../../../server/crypto";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  bearerToken,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/sessions/$sessionId/ticket")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const remote = requestRemoteControlPlane();
            const signedIn = yield* remote.findSignedInSession({
              authSessionHash: yield* sha256(token),
              sessionId: params.sessionId,
              boundToAuthSession: false,
            });
            if (!signedIn) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (!isString(body.clientPublicKey)) {
              return apiError(400, "invalid_remote_request", "The client public key is required.");
            }
            return json(yield* remote.issueSignedInSessionTicket(signedIn, body.clientPublicKey));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
