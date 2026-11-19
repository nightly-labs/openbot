import { sourceText } from "@openbot/i18n/source";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentProvider } from "../agent-client";
import { providerLabel } from "./thread-items";

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
