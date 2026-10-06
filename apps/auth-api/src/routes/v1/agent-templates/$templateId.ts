import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  marketplaceErrorResponse,
  requestAgentTemplates,
  requestUser,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/agent-templates/$templateId")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            // Not cached: after an unpublish no copy may still show the instructions.
            return json(yield* requestAgentTemplates().get(params.templateId));
          }),
          marketplaceErrorResponse,
        ),
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* enforceMarketplaceMutationRateLimit("mutation", user.id);
            yield* requestAgentTemplates().unpublish(user.id, params.templateId);
            return json({ deleted: true });
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
