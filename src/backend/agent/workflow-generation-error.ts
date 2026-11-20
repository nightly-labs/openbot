import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { type CauseCode, classifyFailure } from "@openbot/telemetry";
import type { AgentProvider } from "../agent-client";
import { providerLabel } from "./thread-items";

const PROVIDER_REASON_LIMIT = 300;

const PROVIDER_ONLY_CAUSES: ReadonlySet<CauseCode> = new Set([
  "billing",
  "usage_limit",
  "permission",
  "content_blocked",
  "context_too_long",
  "invalid_request",
]);

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
  const providerCause = failure?.cause instanceof Error ? classifyFailure(failure.cause) : "unknown";
  const ownCause = classifyFailure(failure);
  const found: CauseCode =
    providerCause !== "unknown" ? providerCause : PROVIDER_ONLY_CAUSES.has(ownCause) ? "unknown" : ownCause;
  const reason = failure?.message === sourceText("error.agent.profileFailed") ? providerReason(failure, redact) : null;
  switch (found) {
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
    case "billing":
      return sourceText("error.workflow.providerBilling");
    case "usage_limit":
      return sourceText("error.provider.usageLimitReached");
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
      break;
    default:
      return unhandledCause(found);
  }
  if (failure?.message === sourceText("error.agent.profileToolUse")) return sourceText("error.workflow.modelToolUse");
  return reason ? sourceText("error.workflow.providerRefused", { reason }) : sourceText("error.workflow.modelFailed");
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

function unhandledCause(_cause: never): string {
  return sourceText("error.workflow.modelFailed");
}
