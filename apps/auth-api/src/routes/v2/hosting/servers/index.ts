import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  hostedServerErrorResponse,
  json,
  requestHostedServerService,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v2/hosting/servers/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* requestHostedServerService(request).list(user));
          }),
          hostedServerErrorResponse,
        ),
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            return json(
              yield* requestHostedServerService(request).create(
                user,
                { name: body.name, plan: body.plan, interval: body.interval, currency: body.currency },
                request.headers.get("Idempotency-Key"),
                // Stripe sends the desktop user to the return page, which tells them to go back to the app.
                { target: "desktop", origin: new URL(request.url).origin },
              ),
              201,
            );
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
