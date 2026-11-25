import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  billingErrorResponse,
  json,
  requestCustomServerOffers,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/checkout")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            const checkout = yield* requestCustomServerOffers().checkout(
              user,
              params.hostId,
              { target: "desktop", origin: new URL(request.url).origin },
              { earlyStart: body.earlyStart },
            );
            return json(checkout);
          }),
          billingErrorResponse,
        ),
    },
  },
});
