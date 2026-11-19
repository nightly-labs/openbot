import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { BoatClient } from "../../server/boat-client";
import { runApiResponse } from "../../server/effect-runtime";
import { apiError } from "../../server/request-auth";
import { requireWorkerBindings } from "../../server/types";

const PROBE_SANDBOX_ID = "openbot-status-probe";

const CACHE_SECONDS = 60;

const hostingResponse = (healthy: boolean) =>
  Response.json(
    healthy
      ? { service: "openbot-hosted-servers", status: "ok" }
      : { error: { code: "hosting_not_ready", message: "Hosted servers are not available." } },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}`, "X-Content-Type-Options": "nosniff" },
    },
  );

export const Route = createFileRoute("/health/hosting")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const cacheKey = new Request(new URL("/health/hosting", request.url));
            const cache = yield* Effect.tryPromise(() => caches.open("health-hosting")).pipe(
              Effect.orElseSucceed(() => null),
            );
            const cached = cache
              ? yield* Effect.tryPromise(() => cache.match(cacheKey)).pipe(Effect.orElseSucceed(() => undefined))
              : undefined;
            if (cached) return cached;

            const apiKey = requireWorkerBindings(env).BOAT_API_KEY?.trim();
            const healthy = apiKey
              ? yield* new BoatClient({ apiKey }).getSandbox(PROBE_SANDBOX_ID).pipe(
                  Effect.as(true),
                  Effect.catchTag("BoatApiError", (error) => Effect.succeed(error.status === 404)),
                )
              : false;
            const response = hostingResponse(healthy);
            if (cache) yield* Effect.tryPromise(() => cache.put(cacheKey, response.clone())).pipe(Effect.ignore);
            return response;
          }),
          () => apiError(503, "hosting_not_ready", "Hosted servers are not available."),
        ),
    },
  },
});
