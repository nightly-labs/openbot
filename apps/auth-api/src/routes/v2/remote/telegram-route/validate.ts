import {
  TELEGRAM_BOT_ID_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  TELEGRAM_ROUTE_CHATS_LIMIT,
} from "@openbot/contracts/signal-protocol/telegram-route";
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

const telegramRouteSchema = z.object({
  hostId: z.string().min(1).max(256),
  chats: z
    .array(
      z.object({
        id: z.string().regex(TELEGRAM_CHAT_ID_PATTERN),
        botId: z.string().regex(TELEGRAM_BOT_ID_PATTERN),
        linkedAt: z.number().int().nonnegative(),
      }),
    )
    .max(TELEGRAM_ROUTE_CHATS_LIMIT),
});

export const Route = createFileRoute("/v2/remote/telegram-route/validate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof telegramRouteSchema.safeParse>;
            try {
              parsed = telegramRouteSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_telegram_route", "The Telegram route is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_telegram_route", "The Telegram route is invalid.");
            return json({ chats: yield* requestRemoteControlPlane().validateTelegramRoute(parsed.data) });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
