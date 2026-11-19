import { type AgentProviderRef, isAgentProviderRef } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isAgentAdditionalFolders } from "./ipc-agent-folders";
import {
  type AgentModelId,
  type AgentReasoningEffort,
  type AvatarColor,
  type AvatarHue,
  isAgentModel,
  isAvatarColor,
  isAvatarHue,
  isAvatarSeed,
  isReasoningEffort,
} from "./ipc-agent-identity";
import {
  type AgentSessionSettingOverrides,
  isAgentSessionSettingOverrides,
  isAgentSessionSettingResets,
} from "./ipc-agent-session-settings";
import {
  type AgentProviderId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentProvider,
  isProviderAccountId,
} from "./ipc-agent-status";
import { isAgentTaskLimit } from "./ipc-agent-tasks";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBrowserProfileId } from "./ipc-browser-profiles";
import { isHiddenAt } from "./ipc-hidden-agents";
import { type BusyMessageMode, isBusyMessageMode } from "./ipc-queue";
import type { SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const AGENT_ACCESS_MODES = ["full", "workspace"] as const;
export type AgentAccess = (typeof AGENT_ACCESS_MODES)[number];
export const DEFAULT_AGENT_ACCESS: AgentAccess = "full";

export function isAgentAccess(value: unknown): value is AgentAccess {
  return isOneOf(AGENT_ACCESS_MODES, value);
}

export function agentComputerUseEnabled(agent: { computerUse?: boolean | undefined }): boolean {
  return agent.computerUse !== false;
}

export const AGENT_DEFAULT_KEYS = ["allowAutomation", "allowNewChat", "quickAcknowledgement"] as const;
export type AgentDefaultKey = (typeof AGENT_DEFAULT_KEYS)[number];
export type AgentDefaults = Record<AgentDefaultKey, boolean> & {
  planStartAfterMs: number | null;
  automationRunsPerHour: number;
  commitCoAuthor: boolean;
};

export const OPENBOT_COMMIT_TRAILER = "Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>";

export const DEFAULT_PLAN_START_AFTER_MS = 10_000;
export const MIN_PLAN_START_AFTER_MS = 5_000;
export const MAX_PLAN_START_AFTER_MS = 2_147_483_647;

export const DEFAULT_AUTOMATION_RUNS_PER_HOUR = 30;
export const MIN_AUTOMATION_RUNS_PER_HOUR = 1;
export const MAX_AUTOMATION_RUNS_PER_HOUR = 10_000;

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  allowAutomation: false,
  allowNewChat: false,
  quickAcknowledgement: false,
  planStartAfterMs: DEFAULT_PLAN_START_AFTER_MS,
  automationRunsPerHour: DEFAULT_AUTOMATION_RUNS_PER_HOUR,
  commitCoAuthor: true,
};

export function isAutomationRunsPerHour(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_AUTOMATION_RUNS_PER_HOUR &&
    value <= MAX_AUTOMATION_RUNS_PER_HOUR
  );
}

export function isPlanStartAfterMs(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value % 1_000 === 0 &&
      value >= MIN_PLAN_START_AFTER_MS &&
      value <= MAX_PLAN_START_AFTER_MS)
  );
}

export function isAgentDefaults(value: unknown): value is AgentDefaults {
  return (
    isDynamicRecord(value) &&
    AGENT_DEFAULT_KEYS.every((key) => isBoolean(value[key])) &&
    isPlanStartAfterMs(value.planStartAfterMs) &&
    isAutomationRunsPerHour(value.automationRunsPerHour) &&
    isBoolean(value.commitCoAuthor)
  );
}

export function agentAutomationAllowed(
  agent: { allowAutomation?: boolean | undefined },
  defaults: AgentDefaults,
): boolean {
  return agent.allowAutomation ?? defaults.allowAutomation;
}

export function agentNewChatAllowed(agent: { allowNewChat?: boolean | undefined }, defaults: AgentDefaults): boolean {
  return agent.allowNewChat ?? defaults.allowNewChat;
}

export function agentQuickAcknowledgementEnabled(
  agent: { quickAcknowledgement?: boolean | undefined },
  defaults: AgentDefaults,
): boolean {
  return agent.quickAcknowledgement ?? defaults.quickAcknowledgement;
}

export function workspaceAccessEnforced(agent: { access?: AgentAccess | undefined }): boolean {
  return agent.access === "workspace";
}

export interface AgentModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
  providerAccountId?: string | undefined;
}

export const AGENT_BACKUP_MODEL_LIMIT = 8;

export interface AgentBackupModels {
  automatic: boolean;
  order: AgentModelChoice[];
}

export function isAgentModelChoice(value: unknown): value is AgentModelChoice {
  return (
    isDynamicRecord(value) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId))
  );
}

export interface AgentUsageLimitReturn extends AgentModelChoice {
  reasoningEffort: AgentReasoningEffort;
  cause?: string | undefined;
  fastMode?: boolean | undefined;
  ultrafast?: boolean | undefined;
}

export function isAgentUsageLimitReturn(value: unknown): value is AgentUsageLimitReturn {
  return (
    isDynamicRecord(value) &&
    isAgentModelChoice(value) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.cause === undefined || isString(value.cause)) &&
    (value.fastMode === undefined || isBoolean(value.fastMode)) &&
    (value.ultrafast === undefined || isBoolean(value.ultrafast))
  );
}

export interface AgentPendingRuntime extends AgentModelChoice {
  reasoningEffort: AgentReasoningEffort;
}

export function isAgentPendingRuntime(value: unknown): value is AgentPendingRuntime {
  return isDynamicRecord(value) && isAgentModelChoice(value) && isReasoningEffort(value.reasoningEffort);
}

export function agentNextProviderAccountId(agent: {
  providerAccountId?: string | undefined;
  pendingRuntime?: AgentPendingRuntime | undefined;
}): string | undefined {
  return agent.pendingRuntime ? agent.pendingRuntime.providerAccountId : agent.providerAccountId;
}

export function isAgentBackupModels(value: unknown): value is AgentBackupModels {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.automatic) &&
    Array.isArray(value.order) &&
    value.order.length <= AGENT_BACKUP_MODEL_LIMIT &&
    value.order.every(isAgentModelChoice)
  );
}

export function sameAgentModelChoice(left: AgentModelChoice, right: AgentModelChoice): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === (right.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
  );
}

export function isAgentMarketplaceSource(value: unknown): value is NonNullable<AgentSummary["marketplaceSource"]> {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.listingId) &&
    isIdentifier(value.versionId) &&
    isNumber(value.version) &&
    Number.isInteger(value.version) &&
    Array.isArray(value.skillIds) &&
    value.skillIds.length <= INPUT_LIMITS.agents &&
    value.skillIds.every(isIdentifier) &&
    Array.isArray(value.routineIds) &&
    value.routineIds.length <= INPUT_LIMITS.agentRoutines &&
    value.routineIds.every(isIdentifier)
  );
}

export interface AgentSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  sessionSettingOverrides?: AgentSessionSettingOverrides;
  sessionSettingResets?: string[];
  access?: AgentAccess;
  additionalFolders?: string[];
  excludedFolders?: string[];
  computerUse?: boolean;
  allowAutomation?: boolean;
  allowNewChat?: boolean;
  quickAcknowledgement?: boolean;
  ownBrowserSession?: boolean;
  browserProfileId?: string;
  fastMode?: boolean;
  ultrafast?: boolean;
  busyMessageMode?: BusyMessageMode;
  taskLimit?: number;
  providerAccountId?: string;
  backupModels?: AgentBackupModels;
  usageLimitReturn?: AgentUsageLimitReturn;
  pendingRuntime?: AgentPendingRuntime;
  pinnedAccountId?: string;
  hiddenAt?: string;
  threadId: string | null;
  workspacePath: string;
  preview: string;
  updatedAt: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  chatColor?: AvatarColor;
  avatarUrl: string | null;
  marketplaceSource?: {
    listingId: string;
    versionId: string;
    version: number;
    skillIds: string[];
    routineIds: string[];
  };
}

export function isAgentSummary(value: unknown): value is AgentSummary {
  return isDynamicRecord(value) && isAgentProvider(value.provider) && hasAgentSummaryFields(value);
}

export type ClientAgentSummary = Omit<AgentSummary, "provider"> & { provider: AgentProviderRef };

export function isClientAgentSummary(value: unknown): value is ClientAgentSummary {
  return isDynamicRecord(value) && isAgentProviderRef(value.provider) && hasAgentSummaryFields(value);
}

function hasAgentSummaryFields(value: DynamicRecord): boolean {
  return (
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isBoolean(value.notifications) &&
    isAgentModel(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.sessionSettingOverrides === undefined || isAgentSessionSettingOverrides(value.sessionSettingOverrides)) &&
    (value.sessionSettingResets === undefined || isAgentSessionSettingResets(value.sessionSettingResets)) &&
    (value.access === undefined || isAgentAccess(value.access)) &&
    (value.additionalFolders === undefined || isAgentAdditionalFolders(value.additionalFolders)) &&
    (value.excludedFolders === undefined || isAgentAdditionalFolders(value.excludedFolders)) &&
    (value.computerUse === undefined || isBoolean(value.computerUse)) &&
    (value.allowAutomation === undefined || isBoolean(value.allowAutomation)) &&
    (value.allowNewChat === undefined || isBoolean(value.allowNewChat)) &&
    (value.quickAcknowledgement === undefined || isBoolean(value.quickAcknowledgement)) &&
    (value.ownBrowserSession === undefined || isBoolean(value.ownBrowserSession)) &&
    (value.browserProfileId === undefined || isBrowserProfileId(value.browserProfileId)) &&
    (value.fastMode === undefined || isBoolean(value.fastMode)) &&
    (value.ultrafast === undefined || isBoolean(value.ultrafast)) &&
    (value.busyMessageMode === undefined || isBusyMessageMode(value.busyMessageMode)) &&
    (value.taskLimit === undefined || isAgentTaskLimit(value.taskLimit)) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId)) &&
    (value.backupModels === undefined || isAgentBackupModels(value.backupModels)) &&
    (value.usageLimitReturn === undefined || isAgentUsageLimitReturn(value.usageLimitReturn)) &&
    (value.pendingRuntime === undefined || isAgentPendingRuntime(value.pendingRuntime)) &&
    (value.pinnedAccountId === undefined || isProviderAccountId(value.pinnedAccountId)) &&
    (value.hiddenAt === undefined || isHiddenAt(value.hiddenAt)) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    isBoundedString(value.workspacePath, INPUT_LIMITS.path) &&
    isBoundedString(value.preview, INPUT_LIMITS.messageText) &&
    (value.updatedAt === null || isBoundedString(value.updatedAt, 160)) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarColor === undefined || value.avatarColor === null || isAvatarColor(value.avatarColor)) &&
    (value.chatColor === undefined || isAvatarColor(value.chatColor)) &&
    (value.avatarUrl === null || isBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl)) &&
    (value.marketplaceSource === undefined || isAgentMarketplaceSource(value.marketplaceSource))
  );
}

export interface CreateAgentInput {
  name: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  initialMessage: string;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  providerAccountId?: string;
  operationId?: string;
}

export interface UpdateAgentInput {
  agentId: string;
  name?: string;
  title?: string;
  description?: string;
  notifications?: boolean;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  access?: AgentAccess;
  computerUse?: boolean;
  allowAutomation?: boolean | null;
  allowNewChat?: boolean | null;
  quickAcknowledgement?: boolean | null;
  fastMode?: boolean;
  ultrafast?: boolean;
  busyMessageMode?: BusyMessageMode | null;
  taskLimit?: number | null;
  providerAccountId?: string | null;
  backupModels?: AgentBackupModels | null;
  leaveUsageLimit?: boolean;
  avatarSeed?: string;
  avatarHue?: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  chatColor?: AvatarColor | null;
}

export interface DuplicateAgentResult {
  agent: ClientAgentSummary;
  layout: SidebarLayoutSnapshot;
}

export interface AvatarImageInput {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
}

export interface SetAgentAvatarInput {
  agentId: string;
  image: AvatarImageInput | null;
}
