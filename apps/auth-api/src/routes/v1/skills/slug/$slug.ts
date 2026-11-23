import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { publicMarketplaceJson, requestSkillMarketplace, skillErrorResponse } from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/slug/$slug")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            return publicMarketplaceJson(yield* requestSkillMarketplace().getBySlug(params.slug));
          }),
          skillErrorResponse,
        ),
    },
  },
});
