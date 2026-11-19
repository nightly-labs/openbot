import {
  FEEDBACK_REPOSITORY,
  feedbackComment,
  feedbackIssue,
  feedbackLacksPhone,
  parseFeedback,
} from "@openbot/contracts/feedback";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../server/effect-runtime";
import { readJsonObject } from "../../server/json-body";
import {
  apiError,
  enforceFeedbackRateLimit,
  githubInstallationTokensErrorResponse,
  json,
  requestFeedbackOwner,
  requestGitHubInstallationTokens,
  requestUser,
  uncountFeedback,
} from "../../server/request-auth";

const FEEDBACK_BODY_LIMIT = 64 * 1024;

export const Route = createFileRoute("/v1/feedback")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const feedback = parseFeedback(yield* readJsonObject(request, FEEDBACK_BODY_LIMIT));
            if (!feedback) return apiError(400, "invalid_feedback", "The feedback is invalid.");
            if (feedbackLacksPhone(feedback))
              return apiError(
                400,
                "feedback_needs_phone",
                "A report about the phone app needs the phone's version, system and support log.",
              );
            const github = requestGitHubInstallationTokens();
            const owner = yield* requestFeedbackOwner(user.id);
            const report = feedbackIssue(feedback);
            const day = yield* enforceFeedbackRateLimit(user.id);
            const open = owner
              .mark(report.body)
              .pipe(Effect.flatMap((body) => github.openIssue(FEEDBACK_REPOSITORY, { ...report, body })));
            const sameAs = feedback.sameAs;
            const sent = yield* (
              sameAs === null
                ? open.pipe(Effect.map((issue) => ({ issue, comment: false })))
                : owner.mark(feedbackComment(feedback)).pipe(
                    Effect.flatMap((comment) => github.commentIssue(FEEDBACK_REPOSITORY, sameAs, comment)),
                    Effect.map((issue) => ({ issue, comment: true })),
                    Effect.catchIf(
                      (error) => error.code === "issue_not_open",
                      () => open.pipe(Effect.map((issue) => ({ issue, comment: false }))),
                    ),
                  )
            ).pipe(Effect.tapError(() => uncountFeedback(user.id, day)));
            return json({ url: sent.issue.url, number: sent.issue.number, comment: sent.comment });
          }),
          githubInstallationTokensErrorResponse,
        ),
    },
  },
});
