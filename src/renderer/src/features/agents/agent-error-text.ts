import { agentProviderName, isAgentProvider } from "@openbot/contracts/ipc";
import { matchingSourceKeys } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import { currentText } from "@openbot/ui/text";

/** The notices of a turn whose provider retries a request. They say what the turn does now. */
const RETRY_NOTICE_KEYS: ReadonlySet<string> = new Set([
  "error.backend.providerRetrying",
  "error.backend.providerRetryingLargeContext",
  "error.backend.providerModelAtCapacity",
]);

/**
 * The retry notices that a chat banner shows now, by banner key. The host sends the English text, so
 * a client of any language and of a joined server reads the key from it. The end of the agent's turn
 * removes the notice: the provider then answered or failed, and a failure sends its own error. Kept,
 * the notice said that ChatGPT failed under a reply that had arrived (#10526).
 */
export function createRetryNotices() {
  const shown = new Map<string, string>();
  return {
    /** Records the banner that an agent error set. `readable` is the text that the banner shows. */
    noteError(key: string, message: string, readable: string): void {
      if (matchingSourceKeys(message.trim()).some((sourceKey) => RETRY_NOTICE_KEYS.has(sourceKey)))
        shown.set(key, readable);
      else shown.delete(key);
    },
    /** Removes the banner of `key` when it still shows the retry notice, with the run line above it. */
    clearAtTurnEnd<Run extends { message: string }>(
      key: string,
      setErrors: BannerUpdate<string>,
      setRuns: BannerUpdate<Run>,
    ): void {
      const notice = shown.get(key);
      if (notice === undefined) return;
      shown.delete(key);
      setErrors((current) => (current[key] === notice ? withoutBanner(current, key) : current));
      setRuns((current) => (current[key]?.message === notice ? withoutBanner(current, key) : current));
    },
  };
}

/** A setter of the banners of each chat, keyed like `composerDraftKey`. */
type BannerUpdate<T> = (update: (current: Record<string, T>) => Record<string, T>) => unknown;

function withoutBanner<T>(banners: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = banners;
  return rest;
}

/** A provider quotes what it was given, so an error can carry a whole request body back. */
const ERROR_DESCRIPTION_LIMIT = 300;
/** The copied details keep as much text as the provider log line of the same error. */
const ERROR_DETAILS_LIMIT = 2_000;
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

/**
 * The provider's own text, for the "Copy details" button, when the banner shows only the general
 * sentence (`readable`) because the text is empty, long or technical (#6410). It is redacted again
 * here, because a host of an older version redacts fewer secret shapes. Null when the banner already
 * shows the provider's text or a sentence of its own kind.
 */
export function agentErrorDetails(message: string, readable: string): string | null {
  const { t } = currentText();
  const raw = message.trim();
  if (!raw || readable !== t("agent.error.continueFailed")) return null;
  return redactText(raw).slice(0, ERROR_DETAILS_LIMIT);
}

/**
 * The toast title of an error with no agent. A provider's own failure has the code
 * `<provider>_<kind>`, such as `opencode_start_failed`, and its text often does not name the
 * provider (#2850). The message stays as it is, so its kind is still read from its start.
 */
export function providerErrorTitle(code: string): string {
  const { t } = currentText();
  const provider = code.split("_", 1)[0];
  return isAgentProvider(provider)
    ? t("agent.error.providerNamed", { provider: agentProviderName(provider) })
    : t("agent.error.provider");
}

/** True when this error text has had no toast in the last 30 seconds. The caller then shows one. */
export function claimErrorToast(text: string): boolean {
  const now = Date.now();
  if ((lastErrorToastAt.get(text) ?? 0) + ERROR_TOAST_DEDUPE_MS >= now) return false;
  lastErrorToastAt.set(text, now);
  return true;
}
