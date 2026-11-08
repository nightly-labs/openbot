import { bugReportPlatform, type FeedbackFacts } from "@openbot/contracts/feedback";
import type { CentralAuthState } from "@openbot/contracts/ipc";
import { decodeRecord, requiredNumber, requiredString } from "@openbot/contracts/ipc-decoding";
import { Effect } from "effect";
import { app } from "electron";
import { version as developmentVersion } from "../../package.json";
import type { AgentFeedback, FeedbackSendResult } from "../backend/agent/openbot-tool-router";
import { type ToolOperationFailed, toToolOperationFailed } from "../backend/agent/tool-operation";
import type { CentralAuthOperationError } from "./central-auth-effects";

/** This build's version and system, for feedback, so the user does not look them up. */
export function feedbackFacts(): FeedbackFacts {
  const platform = bugReportPlatform(process.platform);
  return {
    platform,
    // electron-vite starts a script, so Electron reports its own version in development.
    version: app.isPackaged ? app.getVersion() : developmentVersion,
    os: `${platform} ${process.getSystemVersion()} (${process.arch})`,
    builtFromSource: !app.isPackaged,
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

/**
 * Sends approved feedback with the account session. The account service opens the issue as
 * `openbotgit[bot]`, so the user needs no GitHub account, and the issue does not name the account.
 */
export function feedbackSender(auth: FeedbackAuth): AgentFeedback {
  return {
    signedIn: () => auth.getState().status === "signed_in",
    send: (feedback) =>
      Effect.suspend((): Effect.Effect<FeedbackSendResult, ToolOperationFailed> => {
        if (auth.getState().status !== "signed_in") return Effect.succeed({ status: "signedOut" } as const);
        return auth
          .requestAuthorized(
            "/v1/feedback",
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(feedback) },
            (value) => {
              const issue = decodeRecord(value, "Feedback");
              return {
                status: "sent",
                url: requiredString(issue, "url"),
                number: requiredNumber(issue, "number"),
              } as const;
            },
          )
          .pipe(toToolOperationFailed);
      }),
  };
}
