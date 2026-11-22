import { agentProviderName, isAgentProvider } from "@openbot/contracts/ipc";
import { matchingSourceKeys } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import { currentText } from "@openbot/ui/text";

const RETRY_NOTICE_KEYS: ReadonlySet<string> = new Set([
  "error.backend.providerRetrying",
  "error.backend.providerRetryingLargeContext",
  "error.backend.providerModelAtCapacity",
]);

export function createTurnErrorBanners() {
  const retryNotices = new Map<string, string>();
  const errors = new Map<string, string>();
  const errorsBeforeTurn = new Map<string, string>();
  return {
    noteError(key: string, message: string, readable: string): void {
      errors.set(key, readable);
      errorsBeforeTurn.delete(key);
      if (matchingSourceKeys(message.trim()).some((sourceKey) => RETRY_NOTICE_KEYS.has(sourceKey)))
        retryNotices.set(key, readable);
      else retryNotices.delete(key);
    },
    noteTurnStarted(key: string): void {
      const error = errors.get(key);
      if (error !== undefined) errorsBeforeTurn.set(key, error);
    },
    clearAtTurnEnd<Run extends { message: string }>(
      key: string,
      newerTurnSucceeded: boolean,
      setErrors: BannerUpdate<string>,
      setRuns: BannerUpdate<Run>,
    ): void {
      const stale = new Set<string>();
      const notice = retryNotices.get(key);
      if (notice !== undefined) stale.add(notice);
      retryNotices.delete(key);
      const earlierError = newerTurnSucceeded ? errorsBeforeTurn.get(key) : undefined;
      if (earlierError !== undefined) {
        stale.add(earlierError);
        errorsBeforeTurn.delete(key);
        if (errors.get(key) === earlierError) errors.delete(key);
      }
      if (stale.size === 0) return;
      setErrors((current) => (stale.has(current[key] ?? "") ? withoutBanner(current, key) : current));
      setRuns((current) => (stale.has(current[key]?.message ?? "") ? withoutBanner(current, key) : current));
    },
  };
}

type BannerUpdate<T> = (update: (current: Record<string, T>) => Record<string, T>) => unknown;

function withoutBanner<T>(banners: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = banners;
  return rest;
}

const ERROR_DESCRIPTION_LIMIT = 300;
const ERROR_DETAILS_LIMIT = 2_000;
const ERROR_TOAST_DEDUPE_MS = 30_000;
const lastErrorToastAt = new Map<string, number>();

export function readableAgentError(message: string): string {
  const { t, errorMessage } = currentText();
  const readable = errorMessage(message, t("agent.error.continueFailed"));
  if (readable.length <= ERROR_DESCRIPTION_LIMIT) return readable;
  return `${readable.slice(0, ERROR_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

export function agentErrorDetails(message: string, readable: string): string | null {
  const { t } = currentText();
  const raw = message.trim();
  if (!raw || readable !== t("agent.error.continueFailed")) return null;
  return redactText(raw).slice(0, ERROR_DETAILS_LIMIT);
}

export function providerErrorTitle(code: string): string {
  const { t } = currentText();
  const provider = code.split("_", 1)[0];
  return isAgentProvider(provider)
    ? t("agent.error.providerNamed", { provider: agentProviderName(provider) })
    : t("agent.error.provider");
}

export function claimErrorToast(text: string): boolean {
  const now = Date.now();
  if ((lastErrorToastAt.get(text) ?? 0) + ERROR_TOAST_DEDUPE_MS >= now) return false;
  lastErrorToastAt.set(text, now);
  return true;
}
