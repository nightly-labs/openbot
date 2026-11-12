import {
  bugReportPlatform,
  type FeedbackFacts,
  type FeedbackHost,
  type SimilarFeedbackIssue,
} from "@openbot/contracts/feedback";
import type { CentralAuthState } from "@openbot/contracts/ipc";
import { decodeRecord, requiredNumber, requiredString } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { app } from "electron";
import { version as developmentVersion } from "../../package.json";
import type { AgentFeedback, FeedbackSendResult } from "../backend/agent/openbot-tool-router";
import { type ToolOperationFailed, toToolOperationFailed } from "../backend/agent/tool-operation";
import type { CentralAuthOperationError } from "./central-auth-effects";
import { authApiRateLimit } from "./central-auth-manager";

const logger = createOpenBotLogger("feedback");

/** This build's version and system, for feedback, so the user does not look them up. */
export function feedbackFacts(host?: FeedbackHost): FeedbackFacts {
  const platform = bugReportPlatform(process.platform);
  return {
    platform,
    // electron-vite starts a script, so Electron reports its own version in development.
    version: app.isPackaged ? app.getVersion() : developmentVersion,
    os: `${platform} ${process.getSystemVersion()} (${process.arch})`,
    builtFromSource: !app.isPackaged,
    ...(host ? { host } : {}),
  };
}

interface FeedbackAuth {
  getState(): CentralAuthState;
  requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
  ): Effect.Effect<T, CentralAuthOperationError>;
}

function similarIssues(value: unknown): SimilarFeedbackIssue[] {
  const answer = decodeRecord(value, "Similar issues");
  if (!Array.isArray(answer.issues)) return [];
  return answer.issues.flatMap((entry) => {
    if (!isDynamicRecord(entry)) return [];
    return [
      {
        number: requiredNumber(entry, "number"),
        title: requiredString(entry, "title"),
        url: requiredString(entry, "url"),
        summary: isString(entry.summary) ? entry.summary : "",
      },
    ];
  });
}

/**
 * Sends approved feedback with the account session. The account service opens the issue as
 * `openbotgit[bot]`, so the user needs no GitHub account, and the issue does not name the account.
 */
export function feedbackSender(auth: FeedbackAuth): AgentFeedback {
  return {
    signedIn: () => auth.getState().status === "signed_in",
    // A search that fails, or an account service without it, must not stop the report.
    similar: (title) =>
      auth.getState().status !== "signed_in"
        ? Effect.succeed([])
        : auth
            .requestAuthorized(
              "/v1/feedback/similar",
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) },
              similarIssues,
            )
            .pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  logger.warn("Similar issues could not be found.", { error: toLogValue(error) });
                  return [];
                }),
              ),
            ),
    send: (feedback) =>
      Effect.suspend((): Effect.Effect<FeedbackSendResult, ToolOperationFailed> => {
        if (auth.getState().status !== "signed_in") return Effect.succeed({ status: "signedOut" } as const);
        return auth
          .requestAuthorized(
            "/v1/feedback",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(feedback),
            },
            (value) => {
              const issue = decodeRecord(value, "Feedback");
              return {
                status: "sent",
                url: requiredString(issue, "url"),
                number: requiredNumber(issue, "number"),
                comment: issue.comment === true,
              } as const;
            },
          )
          .pipe(
            // The account takes a few reports a minute and more a day. The agent says when it can send again.
            Effect.catch((error) => {
              const limit = authApiRateLimit(error.cause);
              if (!limit) return Effect.fail(error);
              return Effect.succeed({
                status: "limited",
                daily: limit.code === "feedback_daily_limit",
                retryAfterSeconds: limit.retryAfterSeconds,
              } as const);
            }),
            toToolOperationFailed,
          );
      }),
  };
}
