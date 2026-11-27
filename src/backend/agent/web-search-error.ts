import { sourceText } from "@openbot/i18n/source";
import { isSpentBalanceDiagnostic } from "./provider-diagnostics";
import { providerLabel } from "./thread-items";
import { providerFailureCause } from "./workflow-generation-error";

const TRANSIENT_FAILURES = new Set([
  sourceText("error.agent.profileTimedOut"),
  sourceText("error.agent.profileDisconnected"),
  sourceText("error.agent.profileEndpointsChanged"),
]);

export function webSearchError(cause: unknown): string {
  const failure = cause instanceof Error ? cause : null;
  const providerSaid = failure?.cause instanceof Error ? failure.cause.message : null;
  const provider = providerLabel("codex");
  if (failure && TRANSIENT_FAILURES.has(failure.message)) return sourceText("error.agent.webSearchFailed");
  switch (providerFailureCause(failure)) {
    case "authentication":
      return sourceText("error.provider.signInExpired", { provider });
    case "permission":
      if (providerSaid === null) break;
      return sourceText("error.agent.webSearchAccount", { provider });
    case "usage_limit":
      if (providerSaid === null || !isSpentBalanceDiagnostic(providerSaid))
        return sourceText("error.provider.usageLimitReached");
      return sourceText("error.agent.webSearchAccount", { provider });
    case "model_not_found":
    case "billing":
      return sourceText("error.agent.webSearchAccount", { provider });
    case "rate_limit":
    case "provider_unavailable":
    case "provider_internal_error":
      return sourceText("error.agent.webSearchProviderBusy", { provider });
    case "network":
      return sourceText("error.agent.webSearchOffline", { provider });
    case "timeout":
    case "stalled":
    case "provider_exited":
      return sourceText("error.agent.webSearchFailed");
  }
  return sourceText("error.agent.webSearchUnavailable", { provider });
}
