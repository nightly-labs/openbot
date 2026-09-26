/**
 * The per-agent settings that belong to the computer that runs the agent: how far it reaches there,
 * and whether that computer answers its approvals by itself. The local window reads them from the
 * agent summary and the approval preference; an owner or admin of a joined server reads them here.
 */

import { type AgentAccess, isAgentAccess } from "./ipc-agents";
import { isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord } from "./runtime-values";

export interface AgentAdminSettings {
  access: AgentAccess;
  autoApprove: boolean;
  /** Turbo mode is on for the whole host, so every agent auto-approves and the choice is read-only. */
  autoApproveLocked: boolean;
}

/** One call can change access, the grant, or both. At least one must be present. */
export interface UpdateAgentAdminSettingsInput {
  agentId: string;
  access?: AgentAccess;
  autoApprove?: boolean;
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

/** The agent a host added from a marketplace listing or a shared template. The agent list has the rest. */
export interface AddedAgent {
  id: string;
  name: string;
}

export function decodeAddedAgent(value: unknown): AddedAgent {
  if (!isDynamicRecord(value) || !isIdentifier(value.id) || typeof value.name !== "string")
    throw new Error("Invalid added agent response.");
  return { id: value.id, name: value.name };
}
