import { currentText } from "@openbot/ui/text";

/** A provider quotes what it was given, so an error can carry a whole request body back. */
const ERROR_DESCRIPTION_LIMIT = 300;
// Repeated model-refresh failures arrive as identical error events. Coalesce
// them so one outage shows one toast instead of one per retry.
const ERROR_TOAST_DEDUPE_MS = 30_000;
const lastErrorToastAt = new Map<string, number>();

/** One sentence a reader can act on, whichever surface shows it. */
export function readableAgentError(message: string): string {
  const { t, errorMessage } = currentText();
  const readable = errorMessage(message, t("agent.error.continueFailed"));
  if (readable.length <= ERROR_DESCRIPTION_LIMIT) return readable;
  return `${readable.slice(0, ERROR_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

/** True when this error text has had no toast in the last 30 seconds. The caller then shows one. */
export function claimErrorToast(text: string): boolean {
  const now = Date.now();
  if ((lastErrorToastAt.get(text) ?? 0) + ERROR_TOAST_DEDUPE_MS >= now) return false;
  lastErrorToastAt.set(text, now);
  return true;
}
