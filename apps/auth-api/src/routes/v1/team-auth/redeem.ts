import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, authErrorResponse, json, requestAuthService } from "../../../server/request-auth";
import { requestSourceIp } from "../../../server/source-ip";

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
            if (!user) return apiError(401, "invalid_team_ticket", "The team ticket is invalid or expired.");
            return json({
              id: user.id,
              email: user.email,
              name: user.name,
              avatarUrl: user.avatarUrl,
              chatColor: user.chatColor,
            });
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
