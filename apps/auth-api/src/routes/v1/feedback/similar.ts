import { FEEDBACK_LIMITS, FEEDBACK_REPOSITORY, feedbackSearchTerms } from "@openbot/contracts/feedback";
import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import {
  apiError,
  enforceFeedbackSearchRateLimit,
  githubInstallationTokensErrorResponse,
  json,
  requestGitHubInstallationTokens,
  requestUser,
} from "../../../server/request-auth";

/**
 * Finds the open app issues with a title similar to a report's title, so that the agent can add the
 * report to one of them. The title comes in the body, not in the URL, because request logs such as
 * `wrangler tail` show the URL and the user has not approved the report yet.
 */
export const Route = createFileRoute("/v1/feedback/similar")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const { title } = yield* readJsonObject(request);
            if (!isString(title) || !title.trim() || title.length > FEEDBACK_LIMITS.title)
              return apiError(400, "invalid_feedback", "The title is invalid.");
            yield* enforceFeedbackSearchRateLimit(user.id);
            const issues = yield* requestGitHubInstallationTokens().searchIssues(
              FEEDBACK_REPOSITORY,
              feedbackSearchTerms(title),
            );
            return json({ issues });
          }),
          githubInstallationTokensErrorResponse,
        ),
    },
  },
});
