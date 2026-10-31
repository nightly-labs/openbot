import { isBoolean, isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/ticket")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            // Only the host peer gateway asks for its home Signal. A released host sends neither field.
            if (
              (body.signalHome !== undefined && !isBoolean(body.signalHome)) ||
              (body.failedSignalUrl !== undefined && !isString(body.failedSignalUrl))
            )
              return apiError(400, "invalid_remote_request", "The Signal home request is invalid.");
            const signalHome = body.signalHome === true;
            return json(
              yield* requestRemoteControlPlane().issueHostTicket(params.hostId, body.machineToken, {
                signalHome,
                failedSignalUrl: signalHome && isString(body.failedSignalUrl) ? body.failedSignalUrl : null,
              }),
            );
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
