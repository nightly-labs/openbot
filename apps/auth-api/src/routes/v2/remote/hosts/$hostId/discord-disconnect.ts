import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

// Unlinks a Discord guild from the host that proves its machine token.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/discord-disconnect")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken) || !isString(body.guildId))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            yield* requestRemoteControlPlane().disconnectDiscordGuild(params.hostId, body.machineToken, body.guildId);
            return new Response(null, { status: 204 });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
