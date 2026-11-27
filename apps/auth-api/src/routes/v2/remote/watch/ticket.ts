import { decodeWatchTicketRequest } from "@openbot/contracts/signal-protocol/watch-relay";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  bearerToken,
  json,
  remoteControlPlaneErrorResponse,
  requestWatchSessions,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/watch/ticket")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "watch_session_ended", "The watch session has ended.");
            const ticketRequest = decodeWatchTicketRequest(yield* readJsonObject(request));
            if (!ticketRequest) return apiError(400, "invalid_remote_request", "The watch ticket request is invalid.");
            return json(yield* requestWatchSessions().issueTicket(token, ticketRequest));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
