import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, authErrorResponse, json, requestAuthService, requestSourceIp } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/team-auth/redeem")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.ticket) || !isString(body.serverId)) {
              return apiError(400, "invalid_team_ticket", "The team ticket is invalid.");
            }
            const user = yield* requestAuthService().redeemTeamAuthTicket(
              body.ticket,
              body.serverId,
              requestSourceIp(request),
            );
            return user ? json(user) : apiError(401, "invalid_team_ticket", "The team ticket is invalid or expired.");
          }),
          (error) => {
            if (error instanceof SyntaxError) {
              return apiError(400, "invalid_json", "The request body is invalid.");
            }
            return authErrorResponse(error);
          },
        ),
    },
  },
});
