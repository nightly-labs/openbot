import {
  type AgentNotificationLevelsSnapshot,
  type AgentSessionSettings,
  type HiddenAgentsSnapshot,
  isAgentNotificationLevelsSnapshot,
  isAgentSessionSettings,
  isHiddenAgentsSnapshot,
} from "@openbot/contracts/ipc";
// What main answers for agents: provider status, models, the agents themselves, memories, routines,
// shared tables and the sidebar layout.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  type AccountUsage,
  type AgentMemory,
  type AgentMemorySelectionState,
  type AgentRuntimeSnapshot,
  type AgentStatus,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  type DuplicateAgentResult,
  decodeOptionalAgentAnalytics,
  decodeOptionalHostAnalytics,
  decodeProviderUsageResetOutcome,
  decodeProviderUsageResets,
  type HostProviderAccounts,
  isAccountUsage,
  isAgentHostSettings,
  isAgentMemory,
  isAgentMemorySelectionState,
  isAgentProvider,
  isAgentRuntimeSnapshot,
  isAgentStatus,
  isClientAgentModelOption,
  isClientAgentSummary,
  isProviderAccountId,
  isProviderAccountStatus,
  isRoutine,
  isRoutineCalendar,
  isRoutineFeed,
  isRoutineRun,
  isSharedTable,
  isSidebarLayoutSnapshot,
  MAX_PROVIDER_ACCOUNTS,
  type ProviderApiKeyState,
  type ProviderCodeLoginStart,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  type SharedTable,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { decodeRecord, guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isHttpsUrl, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export const decodeRoutine = guardedDecoder(isRoutine, "routine response");
export const decodeAgentHostSettingsFromMain = guardedDecoder(isAgentHostSettings, "agent host settings response");
export const decodeRoutines = guardedListDecoder(isRoutine, "routine list response");
export const decodeRoutineRun = guardedDecoder(isRoutineRun, "routine run response");
export const decodeRoutineRuns = guardedListDecoder(isRoutineRun, "routine history response");
export const decodeAutomationRunCommand = guardedDecoder(isString, "run command response");
export const decodeSideQuestionAnswer = guardedDecoder(isString, "side question answer");
export const decodeRoutineCalendar = guardedDecoder(isRoutineCalendar, "routine calendar response");
export const decodeRoutineFeed = guardedDecoder(isRoutineFeed, "routine feed response");

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
  if (!isHttpsUrl(value.verificationUrl) || !isNumber(value.expiresAt)) {
    throw new Error("Invalid code login response.");
  }
  if (value.kind === "paste" || value.kind === "link") {
    return { kind: value.kind, verificationUrl: value.verificationUrl, expiresAt: value.expiresAt };
  }
  if (
    value.kind !== "code" ||
    !isString(value.userCode) ||
    (value.verificationUrlComplete !== undefined && !isHttpsUrl(value.verificationUrlComplete))
  ) {
    throw new Error("Invalid code login response.");
  }
  return {
    kind: "code",
    userCode: value.userCode,
    verificationUrl: value.verificationUrl,
    ...(value.verificationUrlComplete === undefined ? {} : { verificationUrlComplete: value.verificationUrlComplete }),
    expiresAt: value.expiresAt,
  };
}

export function decodeAgentStatusFromMain(value: unknown): AgentStatus {
  if (!isAgentStatus(value)) throw new Error("Invalid agent status response.");
  return value;
}

export function decodeAgentRuntimeSnapshot(value: unknown): AgentRuntimeSnapshot | null {
  if (value !== null && !isAgentRuntimeSnapshot(value)) throw new Error("Invalid agent runtime snapshot response.");
  return value;
}

export function decodeAccountUsageFromMain(value: unknown): AccountUsage {
  if (!isAccountUsage(value)) throw new Error("Invalid agent usage response.");
  return value;
}

/** Main has already left out the providers that this build does not know, so each one must be known. */
export function decodeProviderUsageResetsFromMain(value: unknown): ProviderUsageResets[] {
  const resets = decodeProviderUsageResets(value);
  // The shared decoder leaves an unknown provider out; here that row is invalid.
  if (!Array.isArray(value) || resets.length !== value.length)
    throw new Error("Invalid provider usage resets response.");
  return resets;
}

export function decodeProviderUsageResetOutcomeFromMain(value: unknown): ProviderUsageResetOutcome {
  return decodeProviderUsageResetOutcome(value);
}

/** Main has already left out the providers that this build does not know, so each one must be known. */
export function decodeHostProviderAccountsFromMain(value: unknown): HostProviderAccounts {
  const invalid = () => new Error("Invalid provider accounts response.");
  if (!isDynamicRecord(value) || !Array.isArray(value.providers) || !Array.isArray(value.agents)) throw invalid();
  const providers = value.providers.map((row: unknown) => {
    if (
      !isDynamicRecord(row) ||
      !isAgentProvider(row.provider) ||
      !Array.isArray(row.accounts) ||
      row.accounts.length > MAX_PROVIDER_ACCOUNTS ||
      !row.accounts.every(isProviderAccountStatus)
    )
      throw invalid();
    return { provider: row.provider, accounts: row.accounts };
  });
  const agents = value.agents.map((row: unknown) => {
    if (!isDynamicRecord(row) || !isString(row.agentId) || !row.agentId || !isProviderAccountId(row.accountId))
      throw invalid();
    return { agentId: row.agentId, accountId: row.accountId };
  });
  return { providers, agents };
}

// Fails closed on a member for the same reason as `decodeAgentModelOptions` in the main process, and
// it is the local half of the same payload: `isAgentModel` gaining square brackets is what stopped a
// provider CLI's `claude-fable-5-1[1m]` from emptying this app's own model picker, not a decoder
// willing to hand the renderer a list shorter than the one the main process sent.
export function decodeAgentModels(value: unknown): ClientAgentModelOption[] {
  if (!Array.isArray(value) || !value.every(isClientAgentModelOption)) {
    throw new Error("Invalid agent model response.");
  }
  return value;
}

export function decodeAgent(value: unknown): ClientAgentSummary {
  if (!isClientAgentSummary(value)) throw new Error("Invalid agent response.");
  return value;
}

export function decodeAgents(value: unknown): ClientAgentSummary[] {
  if (!Array.isArray(value) || !value.every(isClientAgentSummary)) {
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

export function decodeMemorySelection(value: unknown): AgentMemorySelectionState {
  if (!isAgentMemorySelectionState(value)) throw new Error("Invalid agent memory selection response.");
  return value;
}

export function decodeOptionalMemorySelection(value: unknown): AgentMemorySelectionState | null {
  return value === null ? null : decodeMemorySelection(value);
}
export function decodeAgentSessionSettingsFromMain(value: unknown): AgentSessionSettings {
  if (!isAgentSessionSettings(value)) throw new Error("Invalid session settings response.");
  return value;
}

export function decodeHiddenAgentsFromMain(value: unknown): HiddenAgentsSnapshot {
  if (!isHiddenAgentsSnapshot(value)) throw new Error("Invalid hidden agents response.");
  return value;
}

export function decodeAgentNotificationLevelsFromMain(value: unknown): AgentNotificationLevelsSnapshot {
  if (!isAgentNotificationLevelsSnapshot(value)) throw new Error("Invalid agent notification levels response.");
  return value;
}
