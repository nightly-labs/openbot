/**
 * The per-agent settings that belong to the computer that runs the agent: how far it reaches there,
 * and whether that computer answers its approvals by itself. The local window reads them from the
 * agent summary and the approval preference; an owner or admin of a joined server reads them here.
 */

import { type AgentProviderId, agentProviderDescriptor } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isAgentModel } from "./ipc-agent-identity";
import { isAgentTaskLimit } from "./ipc-agent-tasks";
import {
  AGENT_DEFAULT_KEYS,
  type AgentAccess,
  type AgentBackupModels,
  type AgentDefaults,
  type AgentModelChoice,
  type AgentUsageLimitReturn,
  isAgentAccess,
  isAgentBackupModels,
  isAgentDefaults,
  isAgentUsageLimitReturn,
  isAutomationRunsPerHour,
  isPlanStartAfterMs,
} from "./ipc-agents";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type BusyMessageMode, isBusyMessageMode } from "./ipc-queue";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";
import { AGENT_DEFAULTS_MAX_AGENTS } from "./team-protocol/agent-defaults-v1";

export interface AgentAdminSettings {
  access: AgentAccess;
  autoApprove: boolean;
  /**
   * Released hosts send true while their Turbo mode is on: every agent then auto-approves and the
   * choice is read-only. Hosts without Turbo mode always send false.
   */
  autoApproveLocked: boolean;
}

/** One call can change access, the grant, or both. At least one must be present. */
export interface UpdateAgentAdminSettingsInput {
  agentId: string;
  access?: AgentAccess;
  autoApprove?: boolean;
}

/**
 * The one choice the user makes about what an agent may do. `workspace`: it works in its workspace
 * and asks to go outside it. `ask`: it reaches the whole computer and asks before it acts. `full`:
 * it reaches the whole computer and never asks.
 */
export const AGENT_PERMISSION_LEVELS = ["workspace", "ask", "full"] as const;
export type AgentPermissionLevel = (typeof AGENT_PERMISSION_LEVELS)[number];

/**
 * The levels a provider can honor. A provider that cannot ask in full reach has no `ask`, except
 * while the agent is stored at `ask`: OpenBot still asks before its built-in tools and sites then,
 * and the select must show that. An older host can leave the provider out; then every level shows.
 */
export function agentPermissionLevels(
  provider: AgentProviderId | undefined,
  current?: AgentPermissionLevel,
): readonly AgentPermissionLevel[] {
  return provider === undefined || agentProviderDescriptor(provider).approvalsInFullAccess || current === "ask"
    ? AGENT_PERMISSION_LEVELS
    : ["workspace", "full"];
}

/** The level that the stored settings give. */
export function agentPermissionLevel(
  settings: Pick<AgentAdminSettings, "access" | "autoApprove"> & { autoApproveLocked?: boolean },
): AgentPermissionLevel {
  if (settings.access === "workspace") return "workspace";
  return settings.autoApprove || settings.autoApproveLocked ? "full" : "ask";
}

/** The stored settings for a level. Workspace only keeps the grant, which applies only in full reach. */
export function agentPermissionUpdate(agentId: string, level: AgentPermissionLevel): UpdateAgentAdminSettingsInput {
  if (level === "workspace") return { agentId, access: "workspace" };
  return { agentId, access: "full", autoApprove: level === "full" };
}

/** Moving to a level later in `AGENT_PERMISSION_LEVELS` gives the agent more freedom. */
export function widensAgentPermission(from: AgentPermissionLevel, to: AgentPermissionLevel): boolean {
  return AGENT_PERMISSION_LEVELS.indexOf(to) > AGENT_PERMISSION_LEVELS.indexOf(from);
}

export function isAgentAdminSettings(value: unknown): value is AgentAdminSettings {
  return (
    isDynamicRecord(value) &&
    isAgentAccess(value.access) &&
    isBoolean(value.autoApprove) &&
    isBoolean(value.autoApproveLocked)
  );
}

export function decodeAgentAdminSettings(value: unknown): AgentAdminSettings {
  if (!isAgentAdminSettings(value)) throw new Error("Invalid agent settings response.");
  return value;
}

export function parseUpdateAgentAdminSettingsInput(value: unknown): UpdateAgentAdminSettingsInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    (value.access !== undefined && !isAgentAccess(value.access)) ||
    (value.autoApprove !== undefined && !isBoolean(value.autoApprove)) ||
    (value.access === undefined && value.autoApprove === undefined)
  ) {
    throw new Error("Invalid agent settings update.");
  }
  const input: UpdateAgentAdminSettingsInput = { agentId: value.agentId };
  if (value.access !== undefined) input.access = value.access;
  if (value.autoApprove !== undefined) input.autoApprove = value.autoApprove;
  return input;
}

/**
 * Three more per-agent settings that act only on the computer that runs the agent: its Computer Use
 * tools there, the scripts there that can run its routines, and what a message sent while it works
 * does. The local window reads them from the agent summary; an owner or admin of a joined server
 * reads them here.
 */
export interface AgentHostSettings {
  computerUse: boolean;
  allowAutomation: boolean;
  /** Null follows the host default. */
  busyMessageMode: BusyMessageMode | null;
  /** The app default of the host. Only the host changes it. */
  defaultBusyMessageMode: BusyMessageMode;
}

/** One call can change one or more of the three. A null mode follows the host default. */
export interface UpdateAgentHostSettingsInput {
  agentId: string;
  computerUse?: boolean;
  allowAutomation?: boolean;
  busyMessageMode?: BusyMessageMode | null;
}

export function isAgentHostSettings(value: unknown): value is AgentHostSettings {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.computerUse) &&
    isBoolean(value.allowAutomation) &&
    (value.busyMessageMode === null || isBusyMessageMode(value.busyMessageMode)) &&
    isBusyMessageMode(value.defaultBusyMessageMode)
  );
}

export function decodeAgentHostSettings(value: unknown): AgentHostSettings {
  if (!isAgentHostSettings(value)) throw new Error("Invalid agent settings response.");
  return value;
}

export function parseUpdateAgentHostSettingsInput(value: unknown): UpdateAgentHostSettingsInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    (value.computerUse !== undefined && !isBoolean(value.computerUse)) ||
    (value.allowAutomation !== undefined && !isBoolean(value.allowAutomation)) ||
    (value.busyMessageMode !== undefined &&
      value.busyMessageMode !== null &&
      !isBusyMessageMode(value.busyMessageMode)) ||
    (value.computerUse === undefined && value.allowAutomation === undefined && value.busyMessageMode === undefined)
  ) {
    throw new Error("Invalid agent settings update.");
  }
  const input: UpdateAgentHostSettingsInput = { agentId: value.agentId };
  if (value.computerUse !== undefined) input.computerUse = value.computerUse;
  if (value.allowAutomation !== undefined) input.allowAutomation = value.allowAutomation;
  if (value.busyMessageMode !== undefined) input.busyMessageMode = value.busyMessageMode;
  return input;
}

/**
 * The backup models of one agent. The local window reads them from the agent summary; an owner or
 * admin of a joined server reads them here. Null: the agent asks in the chat, with no saved order.
 */
export interface AgentBackupModelSettings {
  backupModels: AgentBackupModels | null;
  /** The model that the agent left for a usage limit, or null. Read only. */
  usageLimitReturn: AgentUsageLimitReturn | null;
}

export interface UpdateAgentBackupModelsInput {
  agentId: string;
  backupModels: AgentBackupModels | null;
}

function copyModelChoice({ provider, model, providerAccountId }: AgentModelChoice): AgentModelChoice {
  return { provider, model, ...(providerAccountId === undefined ? {} : { providerAccountId }) };
}

/**
 * Refuses a provider that this OpenBot does not know, so the client hides the setting instead of
 * saving an order without it. Copies only the known fields.
 */
function decodeBackupModels(value: unknown): AgentBackupModels | null {
  if (value === null) return null;
  if (!isAgentBackupModels(value)) throw new Error("Invalid backup models.");
  return { automatic: value.automatic, order: value.order.map(copyModelChoice) };
}

export function decodeAgentBackupModelSettings(value: unknown): AgentBackupModelSettings {
  if (!isDynamicRecord(value)) throw new Error("Invalid backup models.");
  const back = value.usageLimitReturn;
  if (back !== null && !isAgentUsageLimitReturn(back)) throw new Error("Invalid backup models.");
  return {
    backupModels: decodeBackupModels(value.backupModels),
    usageLimitReturn: back && { ...copyModelChoice(back), reasoningEffort: back.reasoningEffort },
  };
}

export function parseUpdateAgentBackupModelsInput(value: unknown): UpdateAgentBackupModelsInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId)) throw new Error("Invalid backup models.");
  return { agentId: value.agentId, backupModels: decodeBackupModels(value.backupModels) };
}

/**
 * How many tasks of one agent run a turn at the same time. The local window reads it from the agent
 * summary; an owner or admin of a joined server reads it here. Null: the default,
 * `AGENT_TASK_LIMIT_DEFAULT`.
 */
export interface AgentTaskLimitSettings {
  taskLimit: number | null;
}

export interface UpdateAgentTaskLimitInput {
  agentId: string;
  taskLimit: number | null;
}

function decodeTaskLimit(value: unknown): number | null {
  if (value !== null && !isAgentTaskLimit(value)) throw new Error("Invalid task limit.");
  return value;
}

export function decodeAgentTaskLimitSettings(value: unknown): AgentTaskLimitSettings {
  if (!isDynamicRecord(value)) throw new Error("Invalid task limit.");
  return { taskLimit: decodeTaskLimit(value.taskLimit) };
}

export function parseUpdateAgentTaskLimitInput(value: unknown): UpdateAgentTaskLimitInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId)) throw new Error("Invalid task limit.");
  return { agentId: value.agentId, taskLimit: decodeTaskLimit(value.taskLimit) };
}

/**
 * Whether the agent may start a new chat itself when its chat gets long. The read gives the value
 * that applies: the agent's own choice, else the host default. A change saves the agent's own choice.
 */
export interface AgentNewChatSettings {
  allowNewChat: boolean;
}

export interface UpdateAgentNewChatInput {
  agentId: string;
  allowNewChat: boolean;
}

export function decodeAgentNewChatSettings(value: unknown): AgentNewChatSettings {
  if (!isDynamicRecord(value) || !isBoolean(value.allowNewChat)) throw new Error("Invalid new chat setting.");
  return { allowNewChat: value.allowNewChat };
}

export function parseUpdateAgentNewChatInput(value: unknown): UpdateAgentNewChatInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isBoolean(value.allowNewChat))
    throw new Error("Invalid new chat setting.");
  return { agentId: value.agentId, allowNewChat: value.allowNewChat };
}

/**
 * Whether one agent shows its plan card before a long task. The local window reads it from the agent
 * summary and the app defaults; an owner or admin of a joined server reads it here, as the value that
 * applies on the host.
 */
export interface AgentPlanCardSettings {
  quickAcknowledgement: boolean;
}

export interface UpdateAgentPlanCardInput {
  agentId: string;
  quickAcknowledgement: boolean;
}

export function decodeAgentPlanCardSettings(value: unknown): AgentPlanCardSettings {
  if (!isDynamicRecord(value) || !isBoolean(value.quickAcknowledgement)) throw new Error("Invalid plan card setting.");
  return { quickAcknowledgement: value.quickAcknowledgement };
}

export function parseUpdateAgentPlanCardInput(value: unknown): UpdateAgentPlanCardInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isBoolean(value.quickAcknowledgement))
    throw new Error("Invalid plan card setting.");
  return { agentId: value.agentId, quickAcknowledgement: value.quickAcknowledgement };
}

/**
 * Whether one agent asks its provider for the fast service tier. The local window reads it from the
 * agent summary; a member of a joined server reads it on `agent-speed-v1`, or on `agent-fast-mode-v1`
 * from an older host. Null: never set, so the host sends no tier and the provider keeps its own.
 * `ultrafast` comes only with `fastMode: true`, and only from a host with `agent-speed-v1`.
 */
export interface AgentFastModeSettings {
  fastMode: boolean | null;
  ultrafast?: boolean;
}

export interface UpdateAgentFastModeInput {
  agentId: string;
  fastMode: boolean;
  /** With `fastMode: true`, the Ultrafast tier in place of Fast. A joined server needs `agent-speed-v1`. */
  ultrafast?: boolean;
}

export function decodeAgentFastModeSettings(value: unknown): AgentFastModeSettings {
  if (
    !isDynamicRecord(value) ||
    (value.fastMode !== null && !isBoolean(value.fastMode)) ||
    (value.ultrafast !== undefined && !isBoolean(value.ultrafast))
  )
    throw new Error("Invalid fast mode setting.");
  return {
    fastMode: value.fastMode,
    ...(value.fastMode === true && value.ultrafast === true ? { ultrafast: true } : {}),
  };
}

export function parseUpdateAgentFastModeInput(value: unknown): UpdateAgentFastModeInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !isBoolean(value.fastMode) ||
    (value.ultrafast !== undefined && !isBoolean(value.ultrafast))
  )
    throw new Error("Invalid fast mode setting.");
  return {
    agentId: value.agentId,
    fastMode: value.fastMode,
    ...(value.fastMode && value.ultrafast === true ? { ultrafast: true } : {}),
  };
}

/** The speed of an agent on `agent-speed-v1`. */
export type AgentSpeed = "standard" | "fast" | "ultrafast";

/** The speed settings of one agent on `agent-speed-v1`. Null: never set. */
export interface AgentSpeedSettings {
  speed: AgentSpeed | null;
}

export interface UpdateAgentSpeedInput {
  agentId: string;
  speed: AgentSpeed;
}

function isAgentSpeed(value: unknown): value is AgentSpeed {
  return value === "standard" || value === "fast" || value === "ultrafast";
}

export function decodeAgentSpeedSettings(value: unknown): AgentSpeedSettings {
  if (!isDynamicRecord(value) || (value.speed !== null && !isAgentSpeed(value.speed)))
    throw new Error("Invalid speed setting.");
  return { speed: value.speed };
}

export function parseUpdateAgentSpeedInput(value: unknown): UpdateAgentSpeedInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isAgentSpeed(value.speed))
    throw new Error("Invalid speed setting.");
  return { agentId: value.agentId, speed: value.speed };
}

/** The speed of the stored `fastMode` and `ultrafast` of an agent. */
export function agentSpeed(settings: AgentFastModeSettings): AgentSpeed | null {
  if (settings.fastMode === null) return null;
  if (!settings.fastMode) return "standard";
  return settings.ultrafast ? "ultrafast" : "fast";
}

/** The stored `fastMode` and `ultrafast` of a speed. */
export function agentFastModeSettings({ speed }: AgentSpeedSettings): AgentFastModeSettings {
  if (speed === null) return { fastMode: null };
  return { fastMode: speed !== "standard", ...(speed === "ultrafast" ? { ultrafast: true } : {}) };
}

/**
 * A model of a host that has a fast service tier, and the tier ids that the host sends for it. Only
 * `agent-speed-v1` carries `ultrafastServiceTier`.
 */
export interface AgentFastModel {
  provider: string;
  id: string;
  fastServiceTier: string;
  ultrafastServiceTier?: string;
}

/** A model entry that this build cannot read is left out, as the released model list does. */
export function decodeAgentFastModels(value: unknown): AgentFastModel[] {
  if (!isDynamicRecord(value) || !Array.isArray(value.models)) throw new Error("Invalid fast models.");
  return value.models.flatMap((model: unknown) =>
    isDynamicRecord(model) &&
    isIdentifier(model.provider) &&
    isAgentModel(model.id) &&
    isBoundedString(model.fastServiceTier, INPUT_LIMITS.serviceTier) &&
    model.fastServiceTier
      ? [
          {
            provider: model.provider,
            id: model.id,
            fastServiceTier: model.fastServiceTier,
            ...(isBoundedString(model.ultrafastServiceTier, INPUT_LIMITS.serviceTier) && model.ultrafastServiceTier
              ? { ultrafastServiceTier: model.ultrafastServiceTier }
              : {}),
          },
        ]
      : [],
  );
}

/**
 * Puts the fast tiers of `agent-speed-v1` or `agent-fast-mode-v1` back on a host's model list, which
 * drops them.
 */
export function withFastServiceTiers<
  Model extends { provider: string; id: string; fastServiceTier?: string; ultrafastServiceTier?: string },
>(models: Model[], fast: AgentFastModel[]): Model[] {
  const tiers = new Map(fast.map((model) => [`${model.provider}\u0000${model.id}`, model]));
  return models.map((model) => {
    const tier = tiers.get(`${model.provider}\u0000${model.id}`);
    if (!tier) return model;
    return {
      ...model,
      fastServiceTier: tier.fastServiceTier,
      ...(tier.ultrafastServiceTier ? { ultrafastServiceTier: tier.ultrafastServiceTier } : {}),
    };
  });
}

/** The agent a host added from a marketplace listing or a shared template. The agent list has the rest. */
export interface AddedAgent {
  id: string;
  name: string;
}

/** The agent-install-v1 answer, which names the new agent `agentId`. */
export function decodeHostAddedAgent(value: unknown): AddedAgent {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || typeof value.name !== "string")
    throw new Error("Invalid added agent.");
  return { id: value.agentId, name: value.name };
}

export function decodeAddedAgent(value: unknown): AddedAgent {
  if (!isDynamicRecord(value) || !isIdentifier(value.id) || typeof value.name !== "string")
    throw new Error("Invalid added agent response.");
  return { id: value.id, name: value.name };
}

/** A setting of Settings › Agents: the three agent defaults, and "Steer agents while they work". */
export const AGENT_DEFAULT_SETTING_KEYS = [
  "allowAutomation",
  "allowNewChat",
  "quickAcknowledgement",
  "busyMessageMode",
] as const;
export type AgentDefaultSetting = (typeof AGENT_DEFAULT_SETTING_KEYS)[number];

/** What one agent does for a setting: follow the default, or its own value. */
export const AGENT_DEFAULT_CHOICES = ["default", "on", "off"] as const;
export type AgentDefaultChoice = (typeof AGENT_DEFAULT_CHOICES)[number];

/** The own values of one agent. Null: the agent follows the default. */
export interface AgentDefaultsAgentValues {
  agentId: string;
  allowAutomation: boolean | null;
  allowNewChat: boolean | null;
  quickAcknowledgement: boolean | null;
  busyMessageMode: BusyMessageMode | null;
}

/**
 * Settings › Agents of one computer: its agent defaults, its default for a message sent to a busy
 * agent, and the own values of its agents. An owner or admin of a joined server reads it on
 * `agent-defaults-v1`.
 */
export interface AgentDefaultsOverview {
  defaults: AgentDefaults;
  busyMessageMode: BusyMessageMode;
  agents: AgentDefaultsAgentValues[];
}

/**
 * The own value that a choice gives one agent for one setting. `default` removes the own value, so the
 * agent follows the default. For "Steer agents while they work", on is `steer`.
 */
export function agentDefaultChoiceValues(
  setting: AgentDefaultSetting,
  choice: AgentDefaultChoice,
): Partial<Omit<AgentDefaultsAgentValues, "agentId">> {
  if (setting === "busyMessageMode")
    return { busyMessageMode: choice === "default" ? null : choice === "on" ? "steer" : "queue" };
  return { [setting]: choice === "default" ? null : choice === "on" };
}

/** The defaults to change. An absent field keeps its value. */
export type UpdateAgentDefaultsInput = Partial<AgentDefaults> & { busyMessageMode?: BusyMessageMode };

/** Gives `choice` for `setting` to each agent of `agentIds`. */
export interface SetAgentDefaultChoiceInput {
  agentIds: string[];
  setting: AgentDefaultSetting;
  choice: AgentDefaultChoice;
}

function decodeOwnFlag(value: unknown): boolean | null {
  if (value === null || isBoolean(value)) return value;
  throw new Error("Invalid agent defaults.");
}

export function decodeAgentDefaultsOverview(value: unknown): AgentDefaultsOverview {
  if (
    !isDynamicRecord(value) ||
    !isAgentDefaults(value.defaults) ||
    !isBusyMessageMode(value.busyMessageMode) ||
    !Array.isArray(value.agents)
  )
    throw new Error("Invalid agent defaults.");
  const { defaults } = value;
  return {
    defaults: {
      allowAutomation: defaults.allowAutomation,
      allowNewChat: defaults.allowNewChat,
      quickAcknowledgement: defaults.quickAcknowledgement,
      planStartAfterMs: defaults.planStartAfterMs,
      automationRunsPerHour: defaults.automationRunsPerHour,
      commitCoAuthor: defaults.commitCoAuthor,
    },
    busyMessageMode: value.busyMessageMode,
    agents: value.agents.map((agent: unknown) => {
      if (
        !isDynamicRecord(agent) ||
        !isIdentifier(agent.agentId) ||
        (agent.busyMessageMode !== null && !isBusyMessageMode(agent.busyMessageMode))
      )
        throw new Error("Invalid agent defaults.");
      return {
        agentId: agent.agentId,
        allowAutomation: decodeOwnFlag(agent.allowAutomation),
        allowNewChat: decodeOwnFlag(agent.allowNewChat),
        quickAcknowledgement: decodeOwnFlag(agent.quickAcknowledgement),
        busyMessageMode: agent.busyMessageMode,
      };
    }),
  };
}

export function parseUpdateAgentDefaultsInput(value: unknown): UpdateAgentDefaultsInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid agent defaults.");
  const input: UpdateAgentDefaultsInput = {};
  for (const key of AGENT_DEFAULT_KEYS) {
    const flag = value[key];
    if (flag === undefined) continue;
    if (!isBoolean(flag)) throw new Error("Invalid agent defaults.");
    input[key] = flag;
  }
  if (value.planStartAfterMs !== undefined) {
    if (!isPlanStartAfterMs(value.planStartAfterMs)) throw new Error("Invalid agent defaults.");
    input.planStartAfterMs = value.planStartAfterMs;
  }
  if (value.automationRunsPerHour !== undefined) {
    if (!isAutomationRunsPerHour(value.automationRunsPerHour)) throw new Error("Invalid agent defaults.");
    input.automationRunsPerHour = value.automationRunsPerHour;
  }
  if (value.commitCoAuthor !== undefined) {
    if (!isBoolean(value.commitCoAuthor)) throw new Error("Invalid agent defaults.");
    input.commitCoAuthor = value.commitCoAuthor;
  }
  if (value.busyMessageMode !== undefined) {
    if (!isBusyMessageMode(value.busyMessageMode)) throw new Error("Invalid agent defaults.");
    input.busyMessageMode = value.busyMessageMode;
  }
  return input;
}

export function parseSetAgentDefaultChoiceInput(value: unknown): SetAgentDefaultChoiceInput {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.agentIds) ||
    value.agentIds.length > AGENT_DEFAULTS_MAX_AGENTS ||
    !value.agentIds.every(isIdentifier) ||
    !isOneOf(AGENT_DEFAULT_SETTING_KEYS, value.setting) ||
    !isOneOf(AGENT_DEFAULT_CHOICES, value.choice)
  )
    throw new Error("Invalid agent default choice.");
  return { agentIds: [...value.agentIds], setting: value.setting, choice: value.choice };
}
