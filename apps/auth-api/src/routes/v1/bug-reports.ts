import {
  BUG_REPORT_REPOSITORY,
  bugReportIssueBody,
  bugReportIssueTitle,
  parseBugReport,
} from "@openbot/contracts/bug-report";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../server/effect-runtime";
import { readJsonObject } from "../../server/json-body";
import {
  apiError,
  enforceBugReportRateLimit,
  githubInstallationTokensErrorResponse,
  json,
  requestGitHubInstallationTokens,
  requestUser,
} from "../../server/request-auth";

/**
 * Opens a bug report from the app as an issue by `openbotgit[bot]`, so that a user with no GitHub
 * account can report a problem. Only a signed-in account can send, a few times a minute. The issue
 * names no account, and the Worker does not store or log the text: GitHub keeps it, in public.
 */
export const Route = createFileRoute("/v1/bug-reports")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const report = parseBugReport(yield* readJsonObject(request));
            if (!report) return apiError(400, "invalid_bug_report", "The bug report is invalid.");
            yield* enforceBugReportRateLimit(user.id);
            const issue = yield* requestGitHubInstallationTokens().openIssue(BUG_REPORT_REPOSITORY, {
              title: bugReportIssueTitle(report),
              body: bugReportIssueBody(report),
              labels: ["bug", "needs-triage"],
            });
            return json({ url: issue.url, number: issue.number });
          }),
          githubInstallationTokensErrorResponse,
        ),
    },
  },
});
