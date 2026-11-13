import { FEEDBACK_REPOSITORY, feedbackComment, feedbackIssue, parseFeedback } from "@openbot/contracts/feedback";
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

/** A report with each text field full of non-Latin text, in UTF-8. */
const FEEDBACK_BODY_LIMIT = 32 * 1024;

/**
 * Opens a bug report or a feature idea from the app as an issue by `openbotgit[bot]`, so that a user
 * with no GitHub account can send feedback. Only a signed-in account can send, a few times a day.
 * With `sameAs`, the report is a comment on that open issue instead. The issue names no account, and the Worker does not store
 * or log the text: GitHub keeps it, in public. An owner mark at the end lets only this account withdraw it.
 *
 * `/v1/feedback/similar` finds the open issues with similar titles, so that the agent can add to one of them.
 */
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
            const github = requestGitHubInstallationTokens();
            // The mark lets this account take the report back later. See `/v1/feedback/withdraw`.
            const owner = yield* requestFeedbackOwner(user.id);
            const report = feedbackIssue(feedback);
            const markedIssue = { ...report, body: yield* owner.mark(report.body) };
            const markedComment = yield* owner.mark(feedbackComment(feedback));
            const day = yield* enforceFeedbackRateLimit(user.id);
            const open = github.openIssue(FEEDBACK_REPOSITORY, markedIssue);
            // An issue that closed after the search gets a new issue: the user approved the report.
            const sent = yield* (
              feedback.sameAs === null
                ? open.pipe(Effect.map((issue) => ({ issue, comment: false })))
                : github.commentIssue(FEEDBACK_REPOSITORY, feedback.sameAs, markedComment).pipe(
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
