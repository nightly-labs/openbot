import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { isNewerRelease } from "@openbot/contracts/release-version";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import type { App } from "electron";
import { causeHelpers } from "../backend/effect-boundary";

const logger = createOpenBotLogger("mac-installed-copy");

const TOOL_TIMEOUT_MS = 60_000;
const QUARANTINE_ATTRIBUTE = "com.apple.quarantine";
const runTool = promisify(execFile);

class InstalledCopyCheckFailed extends Schema.TaggedError<InstalledCopyCheckFailed>()("InstalledCopyCheckFailed", {
  cause: Schema.Defect(),
}) {}

const { io } = causeHelpers(InstalledCopyCheckFailed);

function runMacTool(path: string, args: readonly string[]) {
  return io((signal) => runTool(path, [...args], { signal, timeout: TOOL_TIMEOUT_MS, encoding: "utf8" }));
}

function designatedRequirement(bundlePath: string) {
  return runMacTool("/usr/bin/codesign", ["-d", "-r-", bundlePath]).pipe(
    Effect.map(({ stdout, stderr }) => /^#?\s*designated => (.+)$/mu.exec(`${stdout}\n${stderr}`)?.[1]?.trim() ?? null),
  );
}

function isSameAppAtLeastAsNew(copyPath: string, requirement: string, currentVersion: string) {
  return Effect.gen(function* () {
    const { stdout } = yield* runMacTool("/usr/bin/plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      join(copyPath, "Contents", "Info.plist"),
    ]);
    const version = stdout.trim();
    if (version !== currentVersion && !isNewerRelease(version, currentVersion)) return false;
    yield* runMacTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", `=${requirement}`, copyPath]);
    return true;
  });
}

function removeQuarantine(copyPath: string) {
  return Effect.gen(function* () {
    yield* runMacTool("/usr/bin/xattr", ["-d", "-r", QUARANTINE_ATTRIBUTE, copyPath]).pipe(Effect.ignore);
    return yield* runMacTool("/usr/bin/xattr", ["-p", QUARANTINE_ATTRIBUTE, copyPath]).pipe(
      Effect.as(false),
      Effect.catch(() => Effect.succeed(true)),
    );
  });
}

function prepareInstalledCopy(runningBundle: string, currentVersion: string): Effect.Effect<string | null> {
  return Effect.gen(function* () {
    const requirement = yield* designatedRequirement(runningBundle);
    if (!requirement) return null;
    for (const folder of ["/Applications", join(homedir(), "Applications")]) {
      const copyPath = join(folder, basename(runningBundle));
      if (copyPath === runningBundle) continue;
      const usable = yield* isSameAppAtLeastAsNew(copyPath, requirement, currentVersion).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logger.info("An OpenBot copy cannot be used to install the update.", toLogValue(error.cause));
            return false;
          }),
        ),
      );
      if (usable && (yield* removeQuarantine(copyPath))) return copyPath;
    }
    return null;
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("The installed OpenBot copy could not be checked.", toLogValue(error.cause));
        return null;
      }),
    ),
  );
}

export function restartFromInstalledCopy(
  app: Pick<App, "getPath" | "quit" | "relaunch">,
  runningBundle: string,
  currentVersion: string,
): Effect.Effect<boolean> {
  return prepareInstalledCopy(runningBundle, currentVersion).pipe(
    Effect.map((copyPath) => {
      if (!copyPath) return false;
      logger.info("OpenBot restarts from its installed copy to install the update.");
      app.relaunch({
        execPath: join(copyPath, "Contents", "MacOS", basename(app.getPath("exe"))),
        args: process.argv.slice(1),
      });
      app.quit();
      return true;
    }),
  );
}
