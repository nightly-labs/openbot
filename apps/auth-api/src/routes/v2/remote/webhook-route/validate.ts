import { WEBHOOK_ROUTES_LIMIT } from "@openbot/contracts/signal-protocol/webhook-route";
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

const webhookRouteSchema = z.object({
  hostId: z.string().min(1).max(256),
  routes: z
    .array(z.object({ id: z.string().min(1).max(128), linkedAt: z.number().int().nonnegative() }))
    .max(WEBHOOK_ROUTES_LIMIT),
});

// Signal asks this while it starts. D1 confirms every route ID and link timestamp in the ticket.
export const Route = createFileRoute("/v2/remote/webhook-route/validate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof webhookRouteSchema.safeParse>;
            try {
              parsed = webhookRouteSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_webhook_route", "The webhook route is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_webhook_route", "The webhook route is invalid.");
            return json({ routes: yield* requestRemoteControlPlane().validateWebhookRoute(parsed.data) });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
