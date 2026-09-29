import { createFileRoute } from "@tanstack/solid-router";
import { readRequestBytes } from "../../../../server/json-body";
import { hostedServerErrorResponse, requestHostedServerService } from "../../../../server/request-auth";

const WEBHOOK_BODY_LIMIT = 16 * 1024;

/** Signed sandbox lifecycle events from boat. The signature covers the raw body. */
export const Route = createFileRoute("/v2/hosting/boat/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = new TextDecoder().decode(await readRequestBytes(request, WEBHOOK_BODY_LIMIT));
          await requestHostedServerService().handleWebhook({
            deliveryId: request.headers.get("X-Ascii-Delivery") ?? "",
            timestamp: request.headers.get("X-Ascii-Timestamp") ?? "",
            signature: request.headers.get("X-Ascii-Signature") ?? "",
            body,
          });
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
