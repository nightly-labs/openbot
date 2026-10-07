import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { z } from "zod";
import { runApiResponse } from "../../../../server/effect-runtime";
import { JSON_BODY_LIMIT, readRequestBytes } from "../../../../server/json-body";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  verifyRemoteServiceRequest,
} from "../../../../server/request-auth";

const removedSchema = z.object({ guildId: z.string().regex(/^[0-9]{1,24}$/u) });

// Signal reports a guild that removed the OpenBot bot. The link goes at once, so another account can
// connect the guild, and a host that is offline does not keep it.
export const Route = createFileRoute("/v2/remote/discord-route/removed")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof removedSchema.safeParse>;
            try {
              parsed = removedSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_discord_route", "The Discord route is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_discord_route", "The Discord route is invalid.");
            yield* requestRemoteControlPlane().removeDiscordGuild(parsed.data.guildId);
            return new Response(null, { status: 204 });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
