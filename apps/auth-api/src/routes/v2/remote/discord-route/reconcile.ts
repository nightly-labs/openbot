import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { z } from "zod";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readRequestBytes } from "../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  verifyRemoteServiceRequest,
} from "../../../../server/request-auth";

// The guild IDs of a large bot, each at most 24 digits.
const RECONCILE_BODY_LIMIT = 1024 * 1024;
const RECONCILE_GUILDS_LIMIT = 40_000;

const reconcileSchema = z.object({
  guilds: z.array(z.string().regex(/^[0-9]{1,24}$/u)).max(RECONCILE_GUILDS_LIMIT),
  before: z.number().int().nonnegative(),
});

// Signal sends the guilds that the bot is in, from the Gateway. Each link of another guild that is
// older than `before` goes: the bot left that guild while its unlink did not arrive.
export const Route = createFileRoute("/v2/remote/discord-route/reconcile")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, RECONCILE_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof reconcileSchema.safeParse>;
            try {
              parsed = reconcileSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_discord_route", "The Discord route is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_discord_route", "The Discord route is invalid.");
            return json({ removed: yield* requestRemoteControlPlane().reconcileDiscordGuilds(parsed.data) });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
