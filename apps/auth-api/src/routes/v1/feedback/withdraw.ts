import { FEEDBACK_REPOSITORY } from "@openbot/contracts/feedback";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import {
  apiError,
  enforceFeedbackWithdrawRateLimit,
  githubInstallationTokensErrorResponse,
  json,
  requestFeedbackOwner,
  requestFeedbackWithdrawnRepository,
  requestGitHubInstallationTokens,
  requestUser,
} from "../../../server/request-auth";

/**
 * Takes a report that this account sent off the public repository: the issue moves to a private
 * repository, or the comment is deleted. Only the account whose mark ends the text can do it. An
 * issue that is not there anymore answers `gone`, so the app can show the report as removed.
 */
export const Route = createFileRoute("/v1/feedback/withdraw")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const { number } = yield* readJsonObject(request);
            if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1)
              return apiError(400, "invalid_feedback", "The issue number is invalid.");
            yield* enforceFeedbackWithdrawRateLimit(user.id);
            const owner = yield* requestFeedbackOwner(user.id);
            const removed = yield* requestGitHubInstallationTokens().withdrawFeedback(
              FEEDBACK_REPOSITORY,
              number,
              owner.sentBy,
              requestFeedbackWithdrawnRepository(),
            );
            return json({ removed });
          }),
          githubInstallationTokensErrorResponse,
        ),
    },
  },
});
