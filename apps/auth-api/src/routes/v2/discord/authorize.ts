import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, discordAppErrorResponse, json, requestDiscordApp, requestUser } from "../../../server/request-auth";

// Starts the OpenBot Discord app's install for one connect of one host. The host sends a one-use
// public key, and the guild link comes back sealed to it.
export const Route = createFileRoute("/v2/discord/authorize")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (!isString(body.hostId) || !isString(body.hostNonce) || !isString(body.hostPublicKey))
              return apiError(400, "invalid_discord_request", "The Discord sign-in request is invalid.");
            const discord = requestDiscordApp();
            const authorizeUrl = yield* discord.authorizeUrl(user, {
              hostId: body.hostId,
              hostNonce: body.hostNonce,
              hostPublicKey: body.hostPublicKey,
              redirectUri: discord.redirectUri(request.url),
            });
            return json({ authorizeUrl });
          }),
          discordAppErrorResponse,
        ),
    },
  },
});
