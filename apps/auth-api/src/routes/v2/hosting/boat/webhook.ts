import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readRequestBytes } from "../../../../server/json-body";
import { hostedServerErrorResponse, requestHostedServerService } from "../../../../server/request-auth";

const WEBHOOK_BODY_LIMIT = 16 * 1024;

/** Signed sandbox lifecycle events from boat. The signature covers the raw body. */
export const Route = createFileRoute("/v2/hosting/boat/webhook")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, WEBHOOK_BODY_LIMIT));
            yield* requestHostedServerService().handleWebhook({
              deliveryId: request.headers.get("X-Ascii-Delivery") ?? "",
              timestamp: request.headers.get("X-Ascii-Timestamp") ?? "",
              signature: request.headers.get("X-Ascii-Signature") ?? "",
              body,
            });
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
