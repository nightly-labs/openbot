import { execFile } from "node:child_process";
import type { MacAutomationResult, MacAutomationTarget } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";

const logger = createOpenBotLogger("mac-automation");

const BUNDLE_IDS: Record<MacAutomationTarget, string> = {
  calendar: "com.apple.iCal",
  contacts: "com.apple.AddressBook",
  mail: "com.apple.mail",
  notes: "com.apple.Notes",
  reminders: "com.apple.reminders",
  messages: "com.apple.MobileSMS",
  safari: "com.apple.Safari",
};

const PROMPT_DEADLINE_MS = 120_000;

const NOT_AUTHORIZED = "-1743";

function automationScript(bundleId: string): string {
  const app = `application id "${bundleId}"`;
  return [
    `set wasRunning to ${app} is running`,
    `tell ${app} to count windows`,
    "if not wasRunning then",
    "try",
    `tell ${app} to quit`,
    "end try",
    "end if",
  ].join("\n");
}

const requestOne = (target: MacAutomationTarget) =>
  Effect.promise(
    (signal) =>
      new Promise<MacAutomationResult>((resolve) => {
        execFile(
          "osascript",
          ["-e", automationScript(BUNDLE_IDS[target])],
          { timeout: PROMPT_DEADLINE_MS, signal },
          (error, _stdout, stderr) => {
            if (!error) return resolve({ target, status: "granted" });
            if (stderr.includes(NOT_AUTHORIZED)) return resolve({ target, status: "denied" });
            logger.warn("macOS Automation access could not be requested.", { target, cause: toLogValue(error) });
            resolve({ target, status: "failed" });
          },
        );
      }),
  );

export const requestMacAutomation = Effect.fn("requestMacAutomation")(function* (
  platform: NodeJS.Platform,
  targets: readonly MacAutomationTarget[],
) {
  if (platform !== "darwin") return targets.map((target): MacAutomationResult => ({ target, status: "failed" }));
  return yield* Effect.forEach(targets, requestOne);
});
