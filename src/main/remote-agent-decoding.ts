import {
  type AgentSessionSettings,
  decodeAgentAnalytics,
  decodeHostAnalytics,
  decodeHostProviderAccounts,
  decodeInstalledSkills,
  decodeProviderUsageResetOutcome,
  decodeProviderUsageResets,
  type HostProviderAccounts,
  isAgentHostSettings,
  isAgentSessionSettings,
  isAgentTask,
  isAgentTaskReadState,
  isAgentTasksSnapshot,
  isConversationSnapshot,
  isHiddenAgentsSnapshot,
} from "@openbot/contracts/ipc";
// Agent-shaped wire payloads: summaries, status, models, skills, memories, routines, queue.
// See `remote-host-decoding.ts` for why the `FromHost` suffix exists and must not be merged away.

import type {
  AccountUsage,
  AgentMemory,
  AgentStatus,
  AgentSummary,
  ClientAgentModelOption,
  ClientAgentSummary,
  DraftAttachment,
  DuplicateAgentResult,
  InstalledSkill,
  ProviderUsageResetOutcome,
  ProviderUsageResets,
  QueuedMessageReceipt,
  QueueSnapshot,
  SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import {
  isAccountUsage,
  isAgentMemory,
  isAgentStatus,
  isAttachmentSummary,
  isClientAgentModelOption,
  isClientAgentSummary,
  isQueuedMessageReceipt,
  isQueueSnapshot,
  isRoutine,
  isRoutineFlowCanvas,
  isRoutineFlowLink,
  isRoutineRun,
  isSidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { decodeRecord, guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

export const decodeAgentHostSettingsFromHost = guardedDecoder(isAgentHostSettings, "agent host settings response");
export const decodeHiddenAgentsFromHost = guardedDecoder(isHiddenAgentsSnapshot, "hidden agents response");
export const decodeRemoteAgentTasks = guardedDecoder(isAgentTasksSnapshot, "remote agent tasks");
export const decodeRemoteAgentTask = guardedDecoder(isAgentTask, "remote agent task");
export const decodeRemoteTaskConversation = guardedDecoder(isConversationSnapshot, "remote task conversation");
export const decodeRemoteTaskReadState = guardedDecoder(isAgentTaskReadState, "remote thread read state");

export function decodeDraftAttachment(value: unknown): DraftAttachment {
  if (!isAttachmentSummary(value)) throw new Error("Invalid attachment.");
  return {
    id: value.id,
    name: value.name,
    size: value.size,
    kind: value.kind,
    mimeType: value.mimeType,
    previewKind: value.previewKind,
    previewUrl: value.previewUrl,
  };
}

export function decodeAgentSummary(value: unknown): ClientAgentSummary {
  // Backup models stay on their host, and this decoder drops them. A later host can save a provider
  // or more models than this version accepts, so they are not checked. An owner or admin reads them
  // on `agent-backup-models-v1`.
  const {
    backupModels: _backupModels,
    usageLimitReturn: _usageLimitReturn,
    pendingRuntime: _pendingRuntime,
    ...record
  } = decodeRecord(value, "agent");
  // Servers older than 63b55606 omit `avatarUrl` entirely. The shared guard requires the field, so
  // normalize the absent case to null before validating rather than loosening the guard for everyone.
  const candidate = record.avatarUrl === undefined ? { ...record, avatarUrl: null } : record;
  if (!isClientAgentSummary(candidate)) throw new Error("Invalid agent.");
  const marketplaceSource = decodeMarketplaceSource(candidate.marketplaceSource);
  return {
    id: candidate.id,
    provider: candidate.provider,
    name: candidate.name,
    title: candidate.title,
    description: candidate.description,
    notifications: candidate.notifications,
    model: candidate.model,
    reasoningEffort: candidate.reasoningEffort,
    threadId: candidate.threadId,
    workspacePath: candidate.workspacePath,
    preview: candidate.preview,
    updatedAt: candidate.updatedAt,
    avatarSeed: candidate.avatarSeed,
    avatarHue: candidate.avatarHue,
    avatarUrl: candidate.avatarUrl,
    ...(marketplaceSource === undefined ? {} : { marketplaceSource }),
  };
}

function decodeMarketplaceSource(value: unknown): AgentSummary["marketplaceSource"] {
  if (value === undefined) return undefined;
  const record = decodeRecord(value, "agent marketplace source");
  const skillIds = record.skillIds;
  const routineIds = record.routineIds;
  if (
    !isString(record.listingId) ||
    !isString(record.versionId) ||
    !isNumber(record.version) ||
    !Number.isInteger(record.version) ||
    !Array.isArray(skillIds) ||
    !skillIds.every(isString) ||
    !Array.isArray(routineIds) ||
    !routineIds.every(isString)
  ) {
    throw new Error("Invalid agent marketplace source.");
  }
  return {
    listingId: record.listingId,
    versionId: record.versionId,
    version: record.version,
    skillIds: [...skillIds],
    routineIds: [...routineIds],
  };
}

export function decodeAgentStatusFromHost(value: unknown): AgentStatus {
  if (!isAgentStatus(value)) {
    throw new Error("Invalid remote agent status.");
  }
  return value;
}

/** The `provider-accounts-v1` list, as the web client also reads it: an unknown provider is left out. */
export function decodeHostProviderAccountsFromHost(value: unknown): HostProviderAccounts {
  return decodeHostProviderAccounts(value);
}

/** The `provider-usage-reset-v1` list: an unknown provider is left out. */
export function decodeProviderUsageResetsFromHost(value: unknown): ProviderUsageResets[] {
  if (!isDynamicRecord(value)) throw new Error("Invalid provider usage resets.");
  return decodeProviderUsageResets(value.accounts);
}

export function decodeProviderUsageResetOutcomeFromHost(value: unknown): ProviderUsageResetOutcome {
  if (!isDynamicRecord(value)) throw new Error("Invalid provider usage reset.");
  return decodeProviderUsageResetOutcome(value.outcome);
}

export function decodeAccountUsageFromHost(value: unknown): AccountUsage {
  if (!isAccountUsage(value)) {
    throw new Error("Invalid remote account usage.");
  }
  return value;
}

// Fails closed on a member, not just on the array: `packages/contracts/AGENTS.md` makes a malformed
// known payload a `protocol_error`, and a list this build silently shortens is the shape that rule
// exists to forbid -- the host and the client would disagree about what was offered with nothing
// saying so. What made `claude-fable-5-1[1m]` take a whole server offline was not this guard but
// `isAgentModel` having no square brackets in its character set, so a legitimate id read as
// malformed; widening the set is the fix, and a model id is deliberately an opaque token there
// rather than a closed list for exactly this reason. An id that still fails it is a host sending
// something no version of this protocol allows. A new reasoning effort is an additive change the
// contract routes through capability negotiation instead. A provider that this build does not know
// is not malformed from a protocol 8 host: its model stays in the list, and the picker disables it.
export function decodeAgentModelOptions(value: unknown): ClientAgentModelOption[] {
  if (!Array.isArray(value) || !value.every(isClientAgentModelOption)) {
    throw new Error("Invalid remote agent models.");
  }
  return value;
}

export function decodeAgentSummaries(value: unknown): ClientAgentSummary[] {
  if (!Array.isArray(value)) throw new Error("Invalid remote agent list.");
  return value.map(decodeAgentSummary);
}

export function decodeInstalledSkillsFromHost(value: unknown): InstalledSkill[] {
  return decodeInstalledSkills(value);
}

export function decodeAgentMemory(value: unknown): AgentMemory {
  if (!isAgentMemory(value)) throw new Error("Invalid remote agent memory.");
  return value;
}

export const decodeRoutine = guardedDecoder(isRoutine, "remote routine");
export const decodeRoutines = guardedListDecoder(isRoutine, "remote routine list");
export const decodeRoutineRun = guardedDecoder(isRoutineRun, "remote routine run");
export const decodeRoutineRuns = guardedListDecoder(isRoutineRun, "remote routine history");
export const decodeRemoteRoutineFlowCanvas = guardedDecoder(isRoutineFlowCanvas, "remote routine flow canvas");
export const decodeRemoteRoutineFlowLink = guardedDecoder(isRoutineFlowLink, "remote routine flow link");
export function decodeSidebarLayoutSnapshot(value: unknown): SidebarLayoutSnapshot {
  if (!isSidebarLayoutSnapshot(value)) throw new Error("Invalid sidebar layout response.");
  return value;
}

export function decodeDuplicateAgentResultFromHost(value: unknown): DuplicateAgentResult {
  const record = decodeRecord(value, "agent duplication");
  return {
    agent: decodeAgentSummary(record.agent),
    layout: decodeSidebarLayoutSnapshot(record.layout),
  };
}

export function decodeQueueSnapshot(value: unknown): QueueSnapshot {
  if (!isQueueSnapshot(value)) {
    throw new Error("Invalid remote queue.");
  }
  return value;
}

export function decodeQueuedMessageReceipt(value: unknown): QueuedMessageReceipt {
  if (!isQueuedMessageReceipt(value)) {
    throw new Error("Invalid remote message receipt.");
  }
  return value;
}

export function decodeAgentAnalyticsFromHost(value: unknown) {
  return decodeAgentAnalytics(value);
}

export function decodeHostAnalyticsFromHost(value: unknown) {
  return decodeHostAnalytics(value);
}

export function decodeAgentSessionSettingsFromHost(value: unknown): AgentSessionSettings {
  if (!isAgentSessionSettings(value)) throw new Error("Invalid session settings response.");
  return value;
}
