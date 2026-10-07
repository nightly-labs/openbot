import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import {
  apiError,
  json,
  requestSkillMarketplace,
  requireSkillsAdmin,
  skillErrorResponse,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/admin/submissions")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            return (yield* requireSkillsAdmin(request))
              ? json(yield* requestSkillMarketplace().pending())
              : apiError(401, "unauthorized", "An admin token is required.");
          }),
          skillErrorResponse,
        ),
    },
  },
});
