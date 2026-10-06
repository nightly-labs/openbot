import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { publicMarketplaceJson, requestSkillMarketplace, skillErrorResponse } from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/$skillId/versions/$versionId")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            return publicMarketplaceJson(yield* requestSkillMarketplace().getVersion(params.skillId, params.versionId));
          }),
          skillErrorResponse,
        ),
    },
  },
});
