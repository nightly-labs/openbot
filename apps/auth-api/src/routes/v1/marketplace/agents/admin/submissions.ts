import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  apiError,
  json,
  marketplaceErrorResponse,
  requestAgentMarketplace,
  requireSkillsAdmin,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/marketplace/agents/admin/submissions")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!requireSkillsAdmin(request)) return apiError(401, "unauthorized", "Admin access is required.");
            return json(yield* requestAgentMarketplace().listPending());
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
