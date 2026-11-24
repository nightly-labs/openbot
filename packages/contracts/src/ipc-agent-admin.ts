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
  autoApproveLocked: boolean;
}

export interface UpdateAgentAdminSettingsInput {
  agentId: string;
  access?: AgentAccess;
  autoApprove?: boolean;
}

export const AGENT_PERMISSION_LEVELS = ["workspace", "ask", "full"] as const;
export type AgentPermissionLevel = (typeof AGENT_PERMISSION_LEVELS)[number];

export function agentPermissionLevels(
  provider: AgentProviderId | undefined,
  current?: AgentPermissionLevel,
): readonly AgentPermissionLevel[] {
  return provider === undefined || agentProviderDescriptor(provider).approvalsInFullAccess || current === "ask"
    ? AGENT_PERMISSION_LEVELS
    : ["workspace", "full"];
}

export function agentPermissionLevel(
  settings: Pick<AgentAdminSettings, "access" | "autoApprove"> & { autoApproveLocked?: boolean },
): AgentPermissionLevel {
  if (settings.access === "workspace") return "workspace";
  return settings.autoApprove || settings.autoApproveLocked ? "full" : "ask";
}

export function agentPermissionUpdate(agentId: string, level: AgentPermissionLevel): UpdateAgentAdminSettingsInput {
  if (level === "workspace") return { agentId, access: "workspace" };
  return { agentId, access: "full", autoApprove: level === "full" };
}

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

export interface AgentHostSettings {
  computerUse: boolean;
  allowAutomation: boolean;
  busyMessageMode: BusyMessageMode | null;
  defaultBusyMessageMode: BusyMessageMode;
}

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

export interface AgentBackupModelSettings {
  backupModels: AgentBackupModels | null;
  usageLimitReturn: AgentUsageLimitReturn | null;
}

export interface UpdateAgentBackupModelsInput {
  agentId: string;
  backupModels: AgentBackupModels | null;
}

function copyModelChoice({ provider, model, providerAccountId }: AgentModelChoice): AgentModelChoice {
  return { provider, model, ...(providerAccountId === undefined ? {} : { providerAccountId }) };
}

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

export interface AgentBuiltinMemorySettings {
  memory: boolean;
}

export interface UpdateAgentBuiltinMemoryInput {
  agentId: string;
  memory: boolean;
}

export function decodeAgentBuiltinMemorySettings(value: unknown): AgentBuiltinMemorySettings {
  if (!isDynamicRecord(value) || !isBoolean(value.memory)) throw new Error("Invalid memory setting.");
  return { memory: value.memory };
}

export function parseUpdateAgentBuiltinMemoryInput(value: unknown): UpdateAgentBuiltinMemoryInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isBoolean(value.memory))
    throw new Error("Invalid memory setting.");
  return { agentId: value.agentId, memory: value.memory };
}

export interface AgentFastModeSettings {
  fastMode: boolean | null;
  ultrafast?: boolean;
}

export interface UpdateAgentFastModeInput {
  agentId: string;
  fastMode: boolean;
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

export type AgentSpeed = "standard" | "fast" | "ultrafast";

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

export function agentSpeed(settings: AgentFastModeSettings): AgentSpeed | null {
  if (settings.fastMode === null) return null;
  if (!settings.fastMode) return "standard";
  return settings.ultrafast ? "ultrafast" : "fast";
}

export function agentFastModeSettings({ speed }: AgentSpeedSettings): AgentFastModeSettings {
  if (speed === null) return { fastMode: null };
  return { fastMode: speed !== "standard", ...(speed === "ultrafast" ? { ultrafast: true } : {}) };
}

export interface AgentFastModel {
  provider: string;
  id: string;
  fastServiceTier: string;
  ultrafastServiceTier?: string;
}

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

export interface AddedAgent {
  id: string;
  name: string;
}

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

export const AGENT_DEFAULT_SETTING_KEYS = [
  "allowAutomation",
  "allowNewChat",
  "quickAcknowledgement",
  "busyMessageMode",
] as const;
export type AgentDefaultSetting = (typeof AGENT_DEFAULT_SETTING_KEYS)[number];

export const AGENT_DEFAULT_CHOICES = ["default", "on", "off"] as const;
export type AgentDefaultChoice = (typeof AGENT_DEFAULT_CHOICES)[number];

export interface AgentDefaultsAgentValues {
  agentId: string;
  allowAutomation: boolean | null;
  allowNewChat: boolean | null;
  quickAcknowledgement: boolean | null;
  busyMessageMode: BusyMessageMode | null;
}

export interface AgentDefaultsOverview {
  defaults: AgentDefaults;
  busyMessageMode: BusyMessageMode;
  agents: AgentDefaultsAgentValues[];
}

export function agentDefaultChoiceValues(
  setting: AgentDefaultSetting,
  choice: AgentDefaultChoice,
): Partial<Omit<AgentDefaultsAgentValues, "agentId">> {
  if (setting === "busyMessageMode")
    return { busyMessageMode: choice === "default" ? null : choice === "on" ? "steer" : "queue" };
  return { [setting]: choice === "default" ? null : choice === "on" };
}

export type UpdateAgentDefaultsInput = Partial<AgentDefaults> & { busyMessageMode?: BusyMessageMode };

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
