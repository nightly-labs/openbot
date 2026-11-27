import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { type CauseCode, classifyFailure } from "@openbot/telemetry";
import type { AgentProvider } from "../agent-client";
import { isSpentBalanceDiagnostic } from "./provider-diagnostics";
import { providerLabel } from "./thread-items";

const PROVIDER_REASON_LIMIT = 300;

export function workflowGenerationError(
  cause: unknown,
  provider: AgentProvider,
  redact: (text: string) => string = redactText,
): string {
  const failure = cause instanceof Error ? cause : null;
  if (
    failure?.message === sourceText("error.workflow.modelImageUnsupported") ||
    failure?.message === sourceText("error.workflow.modelImageType")
  )
    return failure.message;
  const providerError = workflowProviderError(failure, provider, sourceText("error.workflow.modelTimedOut"));
  if (providerError) return providerError;
  if (failure?.message === sourceText("error.agent.profileToolUse")) return sourceText("error.workflow.modelToolUse");
  const reason = failure?.message === sourceText("error.agent.profileFailed") ? providerReason(failure, redact) : null;
  const refusal = providerRefusal(failure, reason);
  if (refusal) return refusal;
  return reason ? sourceText("error.workflow.providerRefused", { reason }) : sourceText("error.workflow.modelFailed");
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

export function providerFailureCause(failure: Error | null): CauseCode {
  const providerCause = failure?.cause instanceof Error ? classifyFailure(failure.cause) : "unknown";
  return providerCause === "unknown" ? classifyFailure(failure) : providerCause;
}

function workflowProviderError(failure: Error | null, provider: AgentProvider, timedOut: string): string | null {
  switch (providerFailureCause(failure)) {
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

function providerRefusal(failure: Error | null, reason: string | null): string | null {
  const said = failure?.cause instanceof Error ? failure.cause : null;
  if (!said) return null;
  const found: CauseCode = classifyFailure(said);
  switch (found) {
    case "billing":
      return sourceText("error.workflow.providerBilling");
    case "usage_limit":
      return isSpentBalanceDiagnostic(said.message)
        ? sourceText("error.workflow.providerBilling")
        : sourceText("error.provider.usageLimitReached");
    case "permission":
      return reason
        ? sourceText("error.workflow.modelRefusedReason", { reason })
        : sourceText("error.workflow.modelRefused");
    case "content_blocked":
      return sourceText("error.workflow.contentBlocked");
    case "context_too_long":
      return sourceText("error.workflow.inputTooLong");
    case "invalid_request":
      return reason
        ? sourceText("error.workflow.requestRefusedReason", { reason })
        : sourceText("error.workflow.requestRefused");
    case "authentication":
    case "model_not_found":
    case "rate_limit":
    case "provider_unavailable":
    case "network":
    case "timeout":
    case "invalid_upload_request":
    case "stalled":
    case "storage":
    case "not_found":
    case "conflict":
    case "turn_limit":
    case "empty_answer":
    case "provider_internal_error":
    case "provider_exited":
    case "attachment_type_unsupported":
    case "attachment_too_large":
    case "attachment_upload_failed":
    case "cancelled":
    case "unknown":
      return null;
    default:
      return unhandledCause(found);
  }
}

function providerReason(failure: Error, redact: (text: string) => string): string | null {
  const said = failure.cause instanceof Error ? failure.cause.message : "";
  const text = redact(said)
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:[A-Za-z]*Error:\s*)+/u, "");
  if (!text || isFixedSourceText(text)) return null;
  const characters = Array.from(text);
  return characters.length > PROVIDER_REASON_LIMIT
    ? `${characters.slice(0, PROVIDER_REASON_LIMIT - 1).join("")}…`
    : text;
}

function unhandledCause(_cause: never): null {
  return null;
}
