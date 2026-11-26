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
  schedule,
  verifyRemoteServiceRequest,
} from "../../../server/request-auth";

const hostWakeSchema = z.object({
  hostId: z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/u),
  wake: z.boolean(),
});

export const Route = createFileRoute("/v2/remote/host-wake")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof hostWakeSchema.safeParse>;
            try {
              parsed = hostWakeSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_host", "The host is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_host", "The host is invalid.");
            const { hostId, wake } = parsed.data;
            const hosting = requestHostedServerService();
            const state = yield* hosting.routeState(hostId);
            if (!wake || (state !== "sleeping" && state !== "starting")) return json({ hostId, state });
            schedule(hosting.startForRoute(hostId));
            return json({ hostId, state: "starting" });
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
