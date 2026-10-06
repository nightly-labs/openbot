import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { apiError, requestSkillMarketplace, requestUser, skillErrorResponse } from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/$skillId/content")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requestUser(request))) return apiError(401, "unauthorized", "Sign in is required.");
            const object = yield* requestSkillMarketplace().content(params.skillId);
            return new Response(object.body, {
              headers: { "Content-Type": "application/zip", "Cache-Control": "private, max-age=300" },
            });
          }),
          skillErrorResponse,
        ),
    },
  },
});
