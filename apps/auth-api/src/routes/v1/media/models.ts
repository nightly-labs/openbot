import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { creditMediaErrorResponse, requestCreditMedia } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/media/models")({
  server: {
    handlers: {
      GET: () =>
        runApiResponse(
          Effect.gen(function* () {
            const catalog = yield* requestCreditMedia().catalog();
            return Response.json(catalog, {
              headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
            });
          }),
          creditMediaErrorResponse,
        ),
    },
  },
});
