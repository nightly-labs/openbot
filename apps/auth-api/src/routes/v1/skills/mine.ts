import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { apiError, json, requestSkillMarketplace, requestUser, skillErrorResponse } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/mine")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            return user
              ? json(yield* requestSkillMarketplace().mine(user.id))
              : apiError(401, "unauthorized", "Sign in is required.");
          }),
          skillErrorResponse,
        ),
    },
  },
});
