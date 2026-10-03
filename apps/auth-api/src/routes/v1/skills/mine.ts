import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import { apiError, json, requestSkillMarketplace, requestUser, skillErrorResponse } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/mine")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          return user
            ? json(await runApiEffect(requestSkillMarketplace().mine(user.id)))
            : apiError(401, "unauthorized", "Sign in is required.");
        } catch (error) {
          return skillErrorResponse(error);
        }
      },
    },
  },
});
