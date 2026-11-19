import { sourceText } from "@openbot/i18n/source";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentProvider } from "../agent-client";
import { providerLabel } from "./thread-items";

/**
 * The text that a failed workflow model step or condition shows: what went wrong and what to do.
 * The provider's own text (the cause of the generation's error) decides first, because it says why
 * a turn failed or retried until the deadline. The generation's own failure decides next: a request
 * error, such as a `thread/start` that timed out, has no provider text under it. Any other failure
 * keeps the general text (#7992).
 */
export function workflowGenerationError(cause: unknown, provider: AgentProvider): string {
  const failure = cause instanceof Error ? cause : null;
  const providerCause = failure?.cause instanceof Error ? classifyFailure(failure.cause) : "unknown";
  switch (providerCause === "unknown" ? classifyFailure(failure) : providerCause) {
    case "authentication":
      return sourceText("error.provider.signInExpired", { provider: providerLabel(provider) });
    case "model_not_found":
      return sourceText("error.workflow.modelUnavailable");
    case "rate_limit":
    case "provider_unavailable":
      return sourceText("error.workflow.providerBusy");
    case "network":
      return sourceText("error.workflow.providerOffline");
    case "timeout":
      return sourceText("error.workflow.modelTimedOut");
  }
  if (failure?.message === sourceText("error.agent.profileToolUse")) return sourceText("error.workflow.modelToolUse");
  return sourceText("error.workflow.modelFailed");
}
