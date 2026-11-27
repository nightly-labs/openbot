import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { readChatColor } from "../../../server/auth-service";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/me/chat-color")({
  server: {
    handlers: {
      PUT: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const chatColor = readChatColor(yield* readJsonObject(request));
            if (chatColor === undefined) return apiError(400, "invalid_chat_color", "The chat color is not valid.");
            return json(yield* requestAuthService().updateChatColor(token, chatColor));
          }),
          authErrorResponse,
        ),
    },
  },
});
