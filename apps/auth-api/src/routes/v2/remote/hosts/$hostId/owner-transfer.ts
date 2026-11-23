import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import { startOwnerTransfer } from "../../../../../server/owner-transfer";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestAuthService,
  requestOwnerTransferEmailDelivery,
  requestRemoteControlPlane,
  requestUser,
  schedule,
} from "../../../../../server/request-auth";
import { requestSourceIp } from "../../../../../server/source-ip";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/owner-transfer")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json({ transfer: yield* requestRemoteControlPlane().pendingOwnerTransfer(user, params.hostId) });
          }),
          remoteControlPlaneErrorResponse,
        ),
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const transfer = yield* startOwnerTransfer(
              {
                auth: requestAuthService(),
                remote: requestRemoteControlPlane(),
                delivery: requestOwnerTransferEmailDelivery,
                schedule,
              },
              user,
              {
                hostId: params.hostId,
                body: yield* readJsonObject(request),
                sourceIp: requestSourceIp(request),
                appUrl: new URL("/app", request.url).toString(),
              },
            );
            return json(transfer, 201);
          }),
          remoteControlPlaneErrorResponse,
        ),
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* requestRemoteControlPlane().cancelOwnerTransfer(user, params.hostId);
            return new Response(null, { status: 204 });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
