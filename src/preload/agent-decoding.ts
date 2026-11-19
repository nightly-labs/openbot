import {
  type AccountUsage,
  type AgentMemory,
  type AgentMemorySelectionState,
  type AgentNotificationLevelsSnapshot,
  type AgentProviderId,
  type AgentRuntimeSnapshot,
  type AgentSessionSettings,
  type AgentStatus,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  type DuplicateAgentResult,
  decodeOptionalAgentAnalytics,
  decodeOptionalHostAnalytics,
  decodeProviderUsageResetOutcome,
  decodeProviderUsageResets,
  type HiddenAgentsSnapshot,
  type HostDefaultProvider,
  type HostProviderAccounts,
  isAccountUsage,
  isAgentHostSettings,
  isAgentMemory,
  isAgentMemorySelectionState,
  isAgentModel,
  isAgentNotificationLevelsSnapshot,
  isAgentProvider,
  isAgentRuntimeSnapshot,
  isAgentSessionSettings,
  isAgentStatus,
  isClientAgentModelOption,
  isClientAgentSummary,
  isHiddenAgentsSnapshot,
  isProviderAccountId,
  isProviderAccountPool,
  isProviderAccountStatus,
  isRoutine,
  isRoutineCalendar,
  isRoutineFeed,
  isRoutineRun,
  isSharedTable,
  isSidebarLayoutSnapshot,
  isSidebarPinsSnapshot,
  MAX_PROVIDER_ACCOUNTS,
  type ProviderApiKeyState,
  type ProviderCodeLoginStart,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  type SharedTable,
  type SidebarLayoutSnapshot,
  type SidebarPinsSnapshot,
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

export function decodeProviderUsageResetsFromMain(value: unknown): ProviderUsageResets[] {
  const resets = decodeProviderUsageResets(value);
  if (!Array.isArray(value) || resets.length !== value.length)
    throw new Error("Invalid provider usage resets response.");
  return resets;
}

export function decodeProviderUsageResetOutcomeFromMain(value: unknown): ProviderUsageResetOutcome {
  return decodeProviderUsageResetOutcome(value);
}

export function decodeHostDefaultProviderFromMain(value: unknown): HostDefaultProvider {
  const { preferredProvider, preferredModel } = decodeRecord(value, "default provider");
  if (preferredProvider !== null && !isAgentProvider(preferredProvider)) throw new Error("Invalid default provider.");
  if (preferredModel !== null && !isAgentModel(preferredModel)) throw new Error("Invalid default model.");
  return { preferredProvider, preferredModel };
}

export function decodeProviderUseFromMain(value: unknown): AgentProviderId[] {
  if (!Array.isArray(value) || !value.every(isAgentProvider)) throw new Error("Invalid provider use.");
  return value;
}

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
  if (value.pools === undefined) return { providers, agents };
  if (!Array.isArray(value.pools)) throw invalid();
  const pools = value.pools.map((row: unknown) => {
    if (!isDynamicRecord(row) || !isAgentProvider(row.provider) || !isProviderAccountPool(row.pool)) throw invalid();
    return { provider: row.provider, pool: { leftOut: row.pool.leftOut, inUse: row.pool.inUse } };
  });
  return { providers, pools, agents };
}

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

export function decodeQuitShortcutHint(value: unknown): ClientAgentSummary[] | null {
  return value === null ? null : decodeAgents(value);
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

export function decodeSidebarPinsFromMain(value: unknown): SidebarPinsSnapshot {
  if (!isSidebarPinsSnapshot(value)) throw new Error("Invalid pinned chats response.");
  return value;
}

export function decodeAgentNotificationLevelsFromMain(value: unknown): AgentNotificationLevelsSnapshot {
  if (!isAgentNotificationLevelsSnapshot(value)) throw new Error("Invalid agent notification levels response.");
  return value;
}
