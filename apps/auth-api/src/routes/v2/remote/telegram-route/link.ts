import {
  TELEGRAM_BOT_ID_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  TELEGRAM_LINK_CODE_PATTERN,
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

const telegramLinkSchema = z.object({
  botId: z.string().regex(TELEGRAM_BOT_ID_PATTERN),
  chatId: z.string().regex(TELEGRAM_CHAT_ID_PATTERN),
  code: z.string().regex(TELEGRAM_LINK_CODE_PATTERN),
});

export const Route = createFileRoute("/v2/remote/telegram-route/link")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof telegramLinkSchema.safeParse>;
            try {
              parsed = telegramLinkSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_telegram_link", "The Telegram link is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_telegram_link", "The Telegram link is invalid.");
            return json(yield* requestRemoteControlPlane().linkTelegramChat(parsed.data));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
