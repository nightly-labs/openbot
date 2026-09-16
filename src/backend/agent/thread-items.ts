import { agentProviderName } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { AgentProvider } from "../agent-client";
import { AppServerError } from "../app-server-client";
import { type DynamicToolCallParams, getString, isRecord, reasoningText, type ThreadItem } from "../protocol";

export function isNonActionableCodexWarning(message: string): boolean {
  return message.startsWith("Skill descriptions were shortened to fit");
}

export function isArchivedThreadError(error: unknown): boolean {
  return error instanceof AppServerError && /\bis archived\b/i.test(error.message);
}

export function isMissingProviderSessionError(error: unknown, provider: AgentProvider): boolean {
  if ((provider !== "grok" && provider !== "opencode") || !(error instanceof Error)) return false;
  return (
    /\bunknown grok session\b/i.test(error.message) ||
    /\bsession\b.*\b(?:not found|does not exist|unknown)\b/i.test(error.message) ||
    /\b(?:not found|unknown)\b.*\bsession\b/i.test(error.message)
  );
}

export function isRequestTimeout(error: unknown, method: string): boolean {
  return error instanceof Error && error.message === `Codex request timed out: ${method}`;
}

export function isDynamicToolCall(value: unknown): value is DynamicToolCallParams {
  return (
    isRecord(value) &&
    isString(value.threadId) &&
    isString(value.turnId) &&
    isString(value.callId) &&
    (isString(value.namespace) || value.namespace === null) &&
    isString(value.tool) &&
    "arguments" in value
  );
}

export function toThreadItem(value: DynamicRecord): ThreadItem | null {
  const type = getString(value, "type");
  if (type === "reasoning") {
    return {
      type: "agentMessage",
      id: getString(value, "id") ?? undefined,
      phase: "commentary",
      text: reasoningText(value),
    };
  }
  return type ? { ...value, type } : null;
}

export function providerActivityText(text: string): string | null {
  const normalized = text.slice(0, 160).replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  return normalized;
}

export function providerForAgent(agent: { provider: AgentProvider }): AgentProvider {
  return agent.provider;
}

export function providerLabel(provider: AgentProvider): string {
  return agentProviderName(provider);
}
