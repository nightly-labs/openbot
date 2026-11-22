import { agentProviderName, isAgentProvider } from "@openbot/contracts/ipc";
import { matchingSourceKeys } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import { currentText } from "@openbot/ui/text";

const RETRY_NOTICE_KEYS: ReadonlySet<string> = new Set([
  "error.backend.providerRetrying",
  "error.backend.providerRetryingLargeContext",
  "error.backend.providerModelAtCapacity",
]);

export function createRetryNotices() {
  const shown = new Map<string, string>();
  return {
    noteError(key: string, message: string, readable: string): void {
      if (matchingSourceKeys(message.trim()).some((sourceKey) => RETRY_NOTICE_KEYS.has(sourceKey)))
        shown.set(key, readable);
      else shown.delete(key);
    },
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
