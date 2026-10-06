import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../server/effect-runtime";
import { apiError, json, requestAuthService } from "../../server/request-auth";
import { requireWorkerBindings } from "../../server/types";

export const Route = createFileRoute("/health/ready")({
  server: {
    handlers: {
      GET: () =>
        runApiResponse(
          Effect.gen(function* () {
            const bindings = requireWorkerBindings(env);
            yield* Effect.promise(() => bindings.DB.prepare("SELECT 1 AS ready").first());
            if (!requestAuthService().configured) {
              return apiError(503, "email_delivery_not_configured", "Email sign-in delivery is not configured.");
            }
            return json({ service: "openbot-auth-api", status: "ready" });
          }),
          () => apiError(503, "service_not_ready", "The account service is not ready."),
        ),
    },
  },
});
