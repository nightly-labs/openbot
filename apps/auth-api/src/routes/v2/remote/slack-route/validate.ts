import { SLACK_ROUTE_TEAMS_LIMIT } from "@openbot/contracts/signal-protocol/slack-route";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { z } from "zod";
import { runApiResponse } from "../../../../server/effect-runtime";
import { JSON_BODY_LIMIT, readRequestBytes } from "../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  verifyRemoteServiceRequest,
} from "../../../../server/request-auth";

const slackRouteSchema = z.object({
  hostId: z.string().min(1).max(256),
  teams: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        appId: z.string().min(1).max(128),
        linkedAt: z.number().int().nonnegative(),
      }),
    )
    .max(SLACK_ROUTE_TEAMS_LIMIT),
});

// Signal asks this while it starts: it lost the revocations it had in memory, so it accepts from a
// route ticket only the workspaces that D1 still links to that host with the same link.
export const Route = createFileRoute("/v2/remote/slack-route/validate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof slackRouteSchema.safeParse>;
            try {
              parsed = slackRouteSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_slack_route", "The Slack route is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_slack_route", "The Slack route is invalid.");
            return json({ teams: yield* requestRemoteControlPlane().validateSlackRoute(parsed.data) });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
