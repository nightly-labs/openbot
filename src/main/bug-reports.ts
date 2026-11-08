import { type BugReportFacts, bugReportPlatform } from "@openbot/contracts/bug-report";
import type { CentralAuthState } from "@openbot/contracts/ipc";
import { decodeRecord, requiredNumber, requiredString } from "@openbot/contracts/ipc-decoding";
import { Effect } from "effect";
import { app } from "electron";
import { version as developmentVersion } from "../../package.json";
import type { AgentBugReports, BugReportSendResult } from "../backend/agent/openbot-tool-router";
import { type ToolOperationFailed, toToolOperationFailed } from "../backend/agent/tool-operation";
import type { CentralAuthOperationError } from "./central-auth-effects";

/** This build's version and system, for the bug report form, so the reporter does not look them up. */
export function bugReportFacts(): BugReportFacts {
  const platform = bugReportPlatform(process.platform);
  return {
    platform,
    // electron-vite starts a script, so Electron reports its own version in development.
    version: app.isPackaged ? app.getVersion() : developmentVersion,
    os: `${platform} ${process.getSystemVersion()} (${process.arch})`,
    builtFromSource: !app.isPackaged,
  };
}

interface BugReportAuth {
  getState(): CentralAuthState;
  requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
  ): Effect.Effect<T, CentralAuthOperationError>;
}

/**
 * Sends an approved report with the account session. The account service opens the issue as
 * `openbotgit[bot]`, so the user needs no GitHub account, and the issue does not name the account.
 */
export function bugReportSender(auth: BugReportAuth): AgentBugReports {
  return {
    send: (report) =>
      Effect.suspend((): Effect.Effect<BugReportSendResult, ToolOperationFailed> => {
        if (auth.getState().status !== "signed_in") return Effect.succeed({ status: "signedOut" } as const);
        return auth
          .requestAuthorized(
            "/v1/bug-reports",
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) },
            (value) => {
              const issue = decodeRecord(value, "Bug report");
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
