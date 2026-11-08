import { type BugReportFacts, bugReportPlatform } from "@openbot/contracts/bug-report";
import { app } from "electron";
import { version as developmentVersion } from "../../package.json";

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
