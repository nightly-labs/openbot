import { isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/invites")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json({ invites: yield* requestRemoteControlPlane().listInvites(user.id, params.hostId) });
          }),
          remoteControlPlaneErrorResponse,
        ),
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (
              (body.role !== "admin" && body.role !== "member") ||
              !(body.email === undefined || body.email === null || isString(body.email)) ||
              !(body.expiresInSeconds === undefined || isNumber(body.expiresInSeconds)) ||
              !(body.permanent === undefined || isBoolean(body.permanent))
            ) {
              return apiError(400, "invalid_remote_request", "The invitation is invalid.");
            }
            return json(
              yield* requestRemoteControlPlane().createInvite(user, {
                hostId: params.hostId,
                role: body.role,
                email: body.email,
                expiresInSeconds: body.expiresInSeconds,
                permanent: body.permanent,
              }),
              201,
            );
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
