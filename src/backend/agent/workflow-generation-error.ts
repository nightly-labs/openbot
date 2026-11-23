import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
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
  const failure = cause instanceof Error ? cause : null;
  if (failure?.message === sourceText("error.agent.profileTimedOut")) return failed;
  return workflowProviderError(failure, provider, failed) ?? failed;
}

const MEDIA_ANSWER_LENGTH = 500;

export function workflowMediaAnswerError(answer: string): string {
  const characters = Array.from(redactText(answer).replace(/\s+/gu, " ").trim());
  if (characters.length === 0) return sourceText("error.workflow.mediaFailed");
  const text =
    characters.length > MEDIA_ANSWER_LENGTH
      ? `${characters.slice(0, MEDIA_ANSWER_LENGTH - 1).join("")}…`
      : characters.join("");
  return sourceText("error.workflow.mediaNotMade", { answer: text });
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
