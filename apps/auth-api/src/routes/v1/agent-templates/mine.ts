import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import {
  apiError,
  json,
  marketplaceErrorResponse,
  requestAgentTemplates,
  requestUser,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/agent-templates/mine")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* requestAgentTemplates().listMine(user.id));
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
