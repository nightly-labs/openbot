import { type AgentProviderRef, isAgentProviderRef } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isAgentAdditionalFolders } from "./ipc-agent-folders";
import {
  type AgentModelId,
  type AgentReasoningEffort,
  type AvatarHue,
  isAgentModel,
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

/**
 * How far an agent may reach on this computer. `workspace` limits writes to the agent's workspace, the
 * shared folder and the temporary folders; `full` is the unrestricted access every agent had before the setting existed.
 */
export const AGENT_ACCESS_MODES = ["full", "workspace"] as const;
export type AgentAccess = (typeof AGENT_ACCESS_MODES)[number];
export const DEFAULT_AGENT_ACCESS: AgentAccess = "full";

export function isAgentAccess(value: unknown): value is AgentAccess {
  return isOneOf(AGENT_ACCESS_MODES, value);
}

/** Whether the agent may use Computer Use. Absent means on, as for every agent before the setting existed. */
export function agentComputerUseEnabled(agent: { computerUse?: boolean | undefined }): boolean {
  return agent.computerUse !== false;
}

/** The agent settings that have an account default. An agent with no value of its own follows it. */
export const AGENT_DEFAULT_KEYS = ["allowAutomation", "allowNewChat", "quickAcknowledgement"] as const;
export type AgentDefaultKey = (typeof AGENT_DEFAULT_KEYS)[number];
export type AgentDefaults = Record<AgentDefaultKey, boolean>;

/** Off, which is what every agent had before the defaults existed. */
export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  allowAutomation: false,
  allowNewChat: false,
  quickAcknowledgement: false,
};

export function isAgentDefaults(value: unknown): value is AgentDefaults {
  return isDynamicRecord(value) && AGENT_DEFAULT_KEYS.every((key) => isBoolean(value[key]));
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

/**
 * Whether this agent runs inside the workspace sandbox now. Every provider enforces it. Codex runs the
 * agent in its `workspace-write` sandbox. Claude runs Bash in its sandbox and asks before a file edit
 * outside the roots. Grok and OpenCode run the agent in a provider process of its own, inside an
 * operating system sandbox (`process-confinement.ts`); on Linux and Windows that process does not start.
 */
export function workspaceAccessEnforced(agent: { access?: AgentAccess | undefined }): boolean {
  return agent.access === "workspace";
}

/** A provider, a model and an account that an agent can run on. */
export interface AgentModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
  /** Absent means the provider's own sign-in, `DEFAULT_PROVIDER_ACCOUNT_ID`. */
  providerAccountId?: string | undefined;
}

/** The most backup models an agent keeps. */
export const AGENT_BACKUP_MODEL_LIMIT = 8;

/**
 * What an agent does when a usage limit holds a message that has not started. Absent means the
 * agent asks in the chat, with no saved order. An automatic order also moves the agent when a
 * provider error fails a turn that did no work yet.
 */
export interface AgentBackupModels {
  /** True: the agent switches at once to the first available model in `order`. False: it asks first. */
  automatic: boolean;
  /** The models to try, first to last. */
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

/** The model an agent left for a usage limit or a provider error, with the reasoning effort it had there. */
export interface AgentUsageLimitReturn extends AgentModelChoice {
  reasoningEffort: AgentReasoningEffort;
  /**
   * "provider-error" when a provider error made the agent leave. Absent means a usage limit. Another
   * value, from a newer build, reads as a usage limit, so the agent still goes back.
   */
  cause?: string | undefined;
}

export function isAgentUsageLimitReturn(value: unknown): value is AgentUsageLimitReturn {
  return (
    isDynamicRecord(value) &&
    isAgentModelChoice(value) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.cause === undefined || isString(value.cause))
  );
}

/**
 * Local-only. The provider, model, account and effort to use from the next turn, while this turn
 * still runs.
 */
export interface AgentPendingRuntime extends AgentModelChoice {
  reasoningEffort: AgentReasoningEffort;
}

export function isAgentPendingRuntime(value: unknown): value is AgentPendingRuntime {
  return isDynamicRecord(value) && isAgentModelChoice(value) && isReasoningEffort(value.reasoningEffort);
}

/**
 * The account of the next turn. A queued runtime without an account uses the provider's own
 * sign-in, not the account of the running turn.
 */
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

/** Whether two choices name the same provider, model and account. */
export function sameAgentModelChoice(left: AgentModelChoice, right: AgentModelChoice): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === (right.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
  );
}

/** The listing an agent was added from, as the host sends it. Clients read it to show what is installed. */
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
  /** Local saved provider settings; released Team API agent payloads omit this field. */
  sessionSettingOverrides?: AgentSessionSettingOverrides;
  /** Provider sessions that must restart to restore defaults after a reset. Local-only. */
  sessionSettingResets?: string[];
  /**
   * Local-only, like Auto approve: the Team API does not carry it, so an agent read from a remote host
   * has none. Absent means `DEFAULT_AGENT_ACCESS`.
   */
  access?: AgentAccess;
  /**
   * The folders that the user gave the agent besides its workspace and the shared folder, as absolute
   * paths. Local-only, like `access`. Absent means none. Only `agentFolders` changes them.
   */
  additionalFolders?: string[];
  /**
   * Folders in the workspace, the shared folder or `additionalFolders` that the agent must not change
   * in Workspace only. Local-only, like `access`. Absent means none. Only `agentFolders` changes them.
   */
  excludedFolders?: string[];
  /**
   * Whether the agent gets the Computer Use tools. Local-only, like `access`. Absent means on; see
   * `agentComputerUseEnabled`.
   */
  computerUse?: boolean;
  /**
   * Whether a local script can run this agent's routines through the automation server. Local-only,
   * like `access`. Absent means the account default; see `agentAutomationAllowed`.
   */
  allowAutomation?: boolean;
  /**
   * Whether the agent can start a new chat with its `start_new_chat` tool. Local-only, like `access`.
   * Absent means the account default; see `agentNewChatAllowed`.
   */
  allowNewChat?: boolean;
  /**
   * Whether the agent shows its plan with the `acknowledge_request` tool before a long task.
   * Local-only, like `access`. Absent means the account default; see `agentQuickAcknowledgementEnabled`.
   */
  quickAcknowledgement?: boolean;
  /**
   * Whether the browser tabs of the agent use a session of their own, with their own cookies and
   * sign-ins. Local-only, like `access`. Absent means off: the tabs use the shared session. When
   * `browserProfileId` is also set, the named profile applies; see `agentBrowserProfile`.
   */
  ownBrowserSession?: boolean;
  /**
   * The named browser profile that the tabs of the agent use. Local-only, like `access`. It comes
   * before `ownBrowserSession`; see `agentBrowserProfile`. The agent store also sets
   * `ownBrowserSession` with it, so an older OpenBot opens the agent's own session, never the shared one.
   */
  browserProfileId?: string;
  /**
   * Whether the agent asks Codex for the fast service tier of its model. Local-only, like `access`.
   * Absent means that OpenBot leaves the tier to Codex.
   */
  fastMode?: boolean;
  /**
   * What a message sent while the agent is busy does. Local-only, like `access`. Absent means the
   * app default.
   */
  busyMessageMode?: BusyMessageMode;
  /**
   * How many tasks of the agent run a turn at the same time, 1 to `AGENT_TASK_LIMIT_MAX`. Local-only,
   * like `access`; an owner or admin of a joined server reads it on `agent-task-limit-v1`. Absent
   * means `AGENT_TASK_LIMIT_DEFAULT`; see `agentTaskLimit`.
   */
  taskLimit?: number;
  /**
   * The provider account the agent's turns run on. Local-only, like `access`. Absent means the
   * provider's own sign-in, `DEFAULT_PROVIDER_ACCOUNT_ID`.
   */
  providerAccountId?: string;
  /** Local-only, like `access`. Absent means the agent asks before it leaves a usage limit. */
  backupModels?: AgentBackupModels;
  /**
   * The agent's own model while a usage limit has moved it to a backup. Local-only. The agent goes
   * back to it when the limit ends.
   */
  usageLimitReturn?: AgentUsageLimitReturn;
  /**
   * Local-only. The provider, model, account and effort to use from the next turn, while this turn
   * still runs. Absent means the next turn uses the provider, model, account and effort on this agent.
   */
  pendingRuntime?: AgentPendingRuntime;
  /**
   * ISO 8601 time when a user hid the agent. Local-only, like `access`: a remote client reads the
   * hidden agents through `agent-hidden-v1`. Absent means the agent is not hidden.
   */
  hiddenAt?: string;
  threadId: string | null;
  workspacePath: string;
  preview: string;
  updatedAt: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
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

/**
 * An agent that a client reads from a host. A newer host can run it on a provider that this OpenBot
 * does not know; the agent stays listed, and its chat works because the host runs it.
 */
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
    (value.busyMessageMode === undefined || isBusyMessageMode(value.busyMessageMode)) &&
    (value.taskLimit === undefined || isAgentTaskLimit(value.taskLimit)) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId)) &&
    (value.backupModels === undefined || isAgentBackupModels(value.backupModels)) &&
    (value.usageLimitReturn === undefined || isAgentUsageLimitReturn(value.usageLimitReturn)) &&
    (value.pendingRuntime === undefined || isAgentPendingRuntime(value.pendingRuntime)) &&
    (value.hiddenAt === undefined || isHiddenAt(value.hiddenAt)) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    isBoundedString(value.workspacePath, INPUT_LIMITS.path) &&
    isBoundedString(value.preview, INPUT_LIMITS.messageText) &&
    (value.updatedAt === null || isBoundedString(value.updatedAt, 160)) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarUrl === null || isBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl)) &&
    (value.marketplaceSource === undefined || isAgentMarketplaceSource(value.marketplaceSource))
  );
}

export interface CreateAgentInput {
  name: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  initialMessage: string;
  /**
   * The provider and model the agent starts on, applied before the initial message is queued.
   * Absent, the backend picks its starting default. A provider change after the first message is
   * queued is rejected while work is active, so naming them here is the only way a chosen pair
   * survives creation.
   */
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
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
  /** `null` returns the agent to the account default, as for `allowNewChat` and `quickAcknowledgement`. */
  allowAutomation?: boolean | null;
  allowNewChat?: boolean | null;
  quickAcknowledgement?: boolean | null;
  fastMode?: boolean;
  /** `null` returns the agent to the app default. */
  busyMessageMode?: BusyMessageMode | null;
  /** `null` returns the agent to the default task limit. */
  taskLimit?: number | null;
  /** `null` returns the agent to the provider's own sign-in. */
  providerAccountId?: string | null;
  /** `null` returns the agent to the default: ask, with no saved order. */
  backupModels?: AgentBackupModels | null;
  /**
   * The provider, model or account change moves held work away from a usage limit. The agent goes
   * back to its current model when that limit ends. Ignored when no limit holds the agent.
   */
  leaveUsageLimit?: boolean;
  avatarSeed?: string;
  avatarHue?: AvatarHue | null;
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
