import { sourceText } from "@openbot/i18n/source";
import { providerLabel } from "./thread-items";
import { providerFailureCause } from "./workflow-generation-error";

const TRANSIENT_FAILURES = new Set([
  sourceText("error.agent.profileDisconnected"),
  sourceText("error.agent.profileEndpointsChanged"),
]);

export function webSearchError(cause: unknown): string {
  const failure = cause instanceof Error ? cause : null;
  const provider = providerLabel("codex");
  if (failure && TRANSIENT_FAILURES.has(failure.message)) return sourceText("error.agent.webSearchFailed");
  switch (providerFailureCause(failure)) {
    case "authentication":
      return sourceText("error.provider.signInExpired", { provider });
    case "model_not_found":
    case "permission":
    case "billing":
      return sourceText("error.agent.webSearchAccount", { provider });
    case "rate_limit":
    case "provider_unavailable":
      return sourceText("error.agent.webSearchProviderBusy", { provider });
    case "network":
      return sourceText("error.agent.webSearchOffline", { provider });
    case "timeout":
      return sourceText("error.agent.webSearchFailed");
  }
  return sourceText("error.agent.webSearchUnavailable", { provider });
}
