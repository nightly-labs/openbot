import { FEEDBACK_REPOSITORY, feedbackIssue, parseFeedback } from "@openbot/contracts/feedback";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../server/effect-runtime";
import { readJsonObject } from "../../server/json-body";
import {
  apiError,
  enforceFeedbackRateLimit,
  githubInstallationTokensErrorResponse,
  json,
  requestGitHubInstallationTokens,
  requestUser,
  uncountFeedback,
} from "../../server/request-auth";

/**
 * Opens a bug report or a feature idea from the app as an issue by `openbotgit[bot]`, so that a user
 * with no GitHub account can send feedback. Only a signed-in account can send, a few times a minute.
 * The issue names no account, and the Worker does not store or log the text: GitHub keeps it, in public.
 */
export const Route = createFileRoute("/v1/feedback")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const feedback = parseFeedback(yield* readJsonObject(request));
            if (!feedback) return apiError(400, "invalid_feedback", "The feedback is invalid.");
            const github = requestGitHubInstallationTokens();
            const day = yield* enforceFeedbackRateLimit(user.id);
            const issue = yield* github
              .openIssue(FEEDBACK_REPOSITORY, feedbackIssue(feedback))
              .pipe(Effect.tapError(() => uncountFeedback(user.id, day)));
            return json({ url: issue.url, number: issue.number });
          }),
          githubInstallationTokensErrorResponse,
        ),
    },
  },
});
