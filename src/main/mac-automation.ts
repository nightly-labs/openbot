// Asks macOS for Automation access to Apple apps before an agent needs it.

import { execFile } from "node:child_process";
import type { MacAutomationResult, MacAutomationTarget } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";

const logger = createOpenBotLogger("mac-automation");

/** Kept here, so the renderer names an app and never a bundle or a script. */
const BUNDLE_IDS: Record<MacAutomationTarget, string> = {
  calendar: "com.apple.iCal",
  contacts: "com.apple.AddressBook",
  mail: "com.apple.mail",
  notes: "com.apple.Notes",
  reminders: "com.apple.reminders",
  messages: "com.apple.MobileSMS",
  safari: "com.apple.Safari",
};

// The prompt waits for the user, so the deadline is long; it only ends an app that never answers.
const PROMPT_DEADLINE_MS = 120_000;

// "Not authorized to send Apple events": the user refused, now or earlier.
const NOT_AUTHORIZED = "-1743";

/**
 * One harmless event, which is what makes macOS ask. Asking whether an app runs sends no event and
 * so opens nothing; the app that the event opened is quit again, and one the user had open stays.
 * The access is already given when the quit runs, so an app that refuses to quit (Messages can
 * answer -128 while it starts) does not change the answer.
 */
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

// Every failure is an answer for this one app, so nothing is left for the error channel.
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

/**
 * Asks for each app in turn, because macOS shows one prompt at a time. An app that fails does not
 * stop the others: each answer is reported on its own.
 */
export const requestMacAutomation = Effect.fn("requestMacAutomation")(function* (
  platform: NodeJS.Platform,
  targets: readonly MacAutomationTarget[],
) {
  if (platform !== "darwin") return targets.map((target): MacAutomationResult => ({ target, status: "failed" }));
  return yield* Effect.forEach(targets, requestOne);
});
