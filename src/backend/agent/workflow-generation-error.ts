import { sourceText } from "@openbot/i18n/source";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentProvider } from "../agent-client";
import { providerLabel } from "./thread-items";

export function workflowGenerationError(cause: unknown, provider: AgentProvider): string {
  const failure = cause instanceof Error ? cause : null;
  if (
    failure?.message === sourceText("error.workflow.modelImageUnsupported") ||
    failure?.message === sourceText("error.workflow.modelImageType")
  )
    return failure.message;
  const providerError = workflowProviderError(failure, provider, sourceText("error.workflow.modelTimedOut"));
  if (providerError) return providerError;
  if (failure?.message === sourceText("error.agent.profileToolUse")) return sourceText("error.workflow.modelToolUse");
  return sourceText("error.workflow.modelFailed");
}

export function workflowMediaError(cause: unknown, provider: AgentProvider): string {
  const failed = sourceText("error.workflow.mediaFailed");
  return workflowProviderError(cause instanceof Error ? cause : null, provider, failed) ?? failed;
}

const MEDIA_ANSWER_LENGTH = 500;

export function workflowMediaAnswerError(answer: string): string {
  const text = answer.replace(/\s+/gu, " ").trim();
  if (!text) return sourceText("error.workflow.mediaFailed");
  return sourceText("error.workflow.mediaNotMade", {
    answer: text.length > MEDIA_ANSWER_LENGTH ? `${text.slice(0, MEDIA_ANSWER_LENGTH - 1)}…` : text,
  });
}

function workflowProviderError(failure: Error | null, provider: AgentProvider, timedOut: string): string | null {
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
      return timedOut;
  }
  return null;
}
