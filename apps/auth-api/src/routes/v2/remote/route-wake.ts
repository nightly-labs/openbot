import { TELEGRAM_BOT_ID_PATTERN, TELEGRAM_CHAT_ID_PATTERN } from "@openbot/contracts/signal-protocol/telegram-route";
import { WEBHOOK_ROUTE_ID_PATTERN } from "@openbot/contracts/signal-protocol/webhook-route";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { z } from "zod";
import { runApiResponse } from "../../../server/effect-runtime";
import { JSON_BODY_LIMIT, readRequestBytes } from "../../../server/json-body";
import {
  apiError,
  hostedServerErrorResponse,
  json,
  requestHostedServerService,
  requestRemoteControlPlane,
  schedule,
  verifyRemoteServiceRequest,
} from "../../../server/request-auth";

const slackId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

const routeWakeSchema = z.object({
  route: z.discriminatedUnion("platform", [
    z.object({ platform: z.literal("slack"), appId: slackId, teamId: slackId }),
    z.object({ platform: z.literal("discord"), guildId: z.string().regex(/^[0-9]{1,24}$/u) }),
    z.object({
      platform: z.literal("telegram"),
      botId: z.string().regex(TELEGRAM_BOT_ID_PATTERN),
      chatId: z.string().regex(TELEGRAM_CHAT_ID_PATTERN),
    }),
    z.object({ platform: z.literal("webhook"), routeId: z.string().regex(WEBHOOK_ROUTE_ID_PATTERN) }),
  ]),
  wake: z.boolean(),
});

export const Route = createFileRoute("/v2/remote/route-wake")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof routeWakeSchema.safeParse>;
            try {
              parsed = routeWakeSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_route", "The route is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_route", "The route is invalid.");
            const hostId = yield* requestRemoteControlPlane().routeHost(parsed.data.route);
            if (!hostId) return json({ hostId: null, state: "not_hosted" });
            const hosting = requestHostedServerService();
            const state = yield* hosting.routeState(hostId);
            if (!parsed.data.wake || (state !== "sleeping" && state !== "starting")) return json({ hostId, state });
            schedule(hosting.startForRoute(hostId));
            return json({ hostId, state: "starting" });
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
