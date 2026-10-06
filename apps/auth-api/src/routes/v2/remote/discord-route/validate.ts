import { DISCORD_ROUTE_GUILDS_LIMIT } from "@openbot/contracts/signal-protocol/discord-route";
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

const discordRouteSchema = z.object({
  hostId: z.string().min(1).max(256),
  guilds: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        linkedAt: z.number().int().nonnegative(),
      }),
    )
    .max(DISCORD_ROUTE_GUILDS_LIMIT),
});

// Signal asks this while it starts: it lost the revocations it had in memory, so it accepts from a
// route ticket only the guilds that D1 still links to that host with the same link.
export const Route = createFileRoute("/v2/remote/discord-route/validate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof discordRouteSchema.safeParse>;
            try {
              parsed = discordRouteSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_discord_route", "The Discord route is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_discord_route", "The Discord route is invalid.");
            return json({ guilds: yield* requestRemoteControlPlane().validateDiscordRoute(parsed.data) });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
