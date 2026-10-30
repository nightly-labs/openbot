/**
 * The per-agent settings that belong to the computer that runs the agent: how far it reaches there,
 * and whether that computer answers its approvals by itself. The local window reads them from the
 * agent summary and the approval preference; an owner or admin of a joined server reads them here.
 */

import { type AgentProviderId, agentProviderDescriptor } from "./agent-providers";
import { isAgentTaskLimit } from "./ipc-agent-tasks";
import {
  type AgentAccess,
  type AgentBackupModels,
  type AgentModelChoice,
  type AgentUsageLimitReturn,
  isAgentAccess,
  isAgentBackupModels,
  isAgentUsageLimitReturn,
} from "./ipc-agents";
import { isIdentifier } from "./ipc-bounded-values";
import { type BusyMessageMode, isBusyMessageMode } from "./ipc-queue";
import { isBoolean, isDynamicRecord } from "./runtime-values";

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
