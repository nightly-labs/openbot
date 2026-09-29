import { createFileRoute } from "@tanstack/solid-router";
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
      GET: async ({ request }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          return json(await requestHostedServerService(request).list(user));
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const body = await readJsonObject(request);
          return json(
            await requestHostedServerService(request).create(
              user,
              { name: body.name, plan: body.plan, interval: body.interval, currency: body.currency },
              request.headers.get("Idempotency-Key"),
              // Stripe sends the desktop user to the return page, which tells them to go back to the app.
              { target: "desktop", origin: new URL(request.url).origin },
            ),
            201,
          );
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
