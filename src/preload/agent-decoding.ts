// What main answers for agents: provider status, models, the agents themselves, memories, routines,
// shared tables and the sidebar layout.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  type AccountUsage,
  type AgentMemory,
  type AgentModelOption,
  type AgentStatus,
  type AgentSummary,
  type DuplicateAgentResult,
  decodeOptionalAgentAnalytics,
  decodeOptionalHostAnalytics,
  isAccountUsage,
  isAgentMemory,
  isAgentModelOption,
  isAgentProvider,
  isAgentStatus,
  isAgentSummary,
  isRoutine,
  isRoutineRun,
  isSharedTable,
  isSidebarLayoutSnapshot,
  type ProviderApiKeyState,
  type ProviderCodeLoginStart,
  type SharedTable,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { decodeRecord, guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export const decodeRoutine = guardedDecoder(isRoutine, "routine response");
export const decodeRoutines = guardedListDecoder(isRoutine, "routine list response");
export const decodeRoutineRun = guardedDecoder(isRoutineRun, "routine run response");
export const decodeRoutineRuns = guardedListDecoder(isRoutineRun, "routine history response");

/** A reply carrying nothing but the provider and a status, so an unexpected field cannot slip in. */
export function decodeProviderApiKeyState(value: unknown): ProviderApiKeyState {
  if (
    !isDynamicRecord(value) ||
    !isAgentProvider(value.provider) ||
    !isOneOf(["missing", "saved", "unreadable"] as const, value.status)
  ) {
    throw new Error("Invalid provider key state response.");
  }
  return { provider: value.provider, status: value.status };
}

/**
 * A started code sign-in, checked field by field before the renderer shows it.
 *
 * The verification URL ends up in a link the user is invited to open, so it is held to https here
 * as well as in the backend: this is the last point before it reaches the screen.
 */
export function decodeProviderCodeLoginStart(value: unknown): ProviderCodeLoginStart {
  if (!isDynamicRecord(value)) throw new Error("Invalid code login response.");
  if (value.kind === "connected") return { kind: "connected" };
  if (
    value.kind !== "code" ||
    !isString(value.userCode) ||
    !isString(value.verificationUrl) ||
    !isNumber(value.expiresAt)
  ) {
    throw new Error("Invalid code login response.");
  }
  if (new URL(value.verificationUrl).protocol !== "https:") throw new Error("Invalid code login response.");
  return {
    kind: "code",
    userCode: value.userCode,
    verificationUrl: value.verificationUrl,
    expiresAt: value.expiresAt,
  };
}

export function decodeAgentStatusFromMain(value: unknown): AgentStatus {
  if (!isAgentStatus(value)) throw new Error("Invalid agent status response.");
  return value;
}

export function decodeAccountUsageFromMain(value: unknown): AccountUsage {
  if (!isAccountUsage(value)) throw new Error("Invalid agent usage response.");
  return value;
}

// Fails closed on a member for the same reason as `decodeAgentModelOptions` in the main process, and
// it is the local half of the same payload: `isAgentModel` gaining square brackets is what stopped a
// provider CLI's `claude-fable-5-1[1m]` from emptying this app's own model picker, not a decoder
// willing to hand the renderer a list shorter than the one the main process sent.
export function decodeAgentModels(value: unknown): AgentModelOption[] {
  if (!Array.isArray(value) || !value.every(isAgentModelOption)) {
    throw new Error("Invalid agent model response.");
  }
  return value;
}

export function decodeAgent(value: unknown): AgentSummary {
  if (!isAgentSummary(value)) throw new Error("Invalid agent response.");
  return value;
}

export function decodeAgents(value: unknown): AgentSummary[] {
  if (!Array.isArray(value) || !value.every(isAgentSummary)) {
    throw new Error("Invalid agent list response.");
  }
  return value;
}

export function decodeMemory(value: unknown): AgentMemory {
  if (!isAgentMemory(value)) throw new Error("Invalid agent memory response.");
  return value;
}

export function decodeTables(value: unknown): SharedTable[] {
  if (!Array.isArray(value) || !value.every(isSharedTable)) throw new Error("Invalid shared tables response.");
  return value;
}

export function decodeMemories(value: unknown): AgentMemory[] {
  if (!Array.isArray(value) || !value.every(isAgentMemory)) throw new Error("Invalid agent memories response.");
  return value;
}

export function decodeSidebarLayout(value: unknown): SidebarLayoutSnapshot {
  if (!isSidebarLayoutSnapshot(value)) throw new Error("Invalid sidebar layout response.");
  return value;
}

export function decodeDuplicateAgentResultFromMain(value: unknown): DuplicateAgentResult {
  const item = decodeRecord(value, "agent duplication");
  return { agent: decodeAgent(item.agent), layout: decodeSidebarLayout(item.layout) };
}

export function decodeAgentAnalyticsFromMain(value: unknown) {
  return decodeOptionalAgentAnalytics(value);
}

export function decodeHostAnalyticsFromMain(value: unknown) {
  return decodeOptionalHostAnalytics(value);
}
