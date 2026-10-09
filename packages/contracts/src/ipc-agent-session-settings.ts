import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export type AgentSessionSettingValue = string | boolean;
export interface AgentSessionSettingChoice {
  value: string;
  name: string;
  description?: string;
  group?: string;
}
export type AgentSessionSettingOption = {
  id: string;
  name: string;
  description?: string;
  category?: string;
} & (
  | { type: "boolean"; currentValue: boolean }
  | { type: "select"; currentValue: string; options: AgentSessionSettingChoice[] }
);
export interface AgentSessionSettingsSnapshot {
  options: AgentSessionSettingOption[];
}
/** Saved values are scoped to a provider, including the identity of a custom ACP agent. */
export type AgentSessionSettingOverrides = Record<string, Record<string, AgentSessionSettingValue>>;
export interface AgentSessionSettings extends AgentSessionSettingsSnapshot {
  agentId: string;
  providerIdentity: string;
  overrides: Record<string, AgentSessionSettingValue>;
  pending: boolean;
}
export interface SetAgentSessionSettingInput {
  agentId: string;
  settingId: string;
  value: AgentSessionSettingValue;
}
export interface ResetAgentSessionSettingInput {
  agentId: string;
  settingId: string;
}

export function isAgentSessionSettingOverrides(value: unknown): value is AgentSessionSettingOverrides {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length <= 32 &&
    Object.entries(value).every(
      ([identity, values]) =>
        nonempty(identity, 160) &&
        isDynamicRecord(values) &&
        Object.keys(values).length <= 64 &&
        Object.entries(values).every(
          ([key, entry]) => nonempty(key, 256) && (typeof entry === "boolean" || isBoundedString(entry, 4096)),
        ),
    )
  );
}

function nonempty(value: unknown, maximum: number): value is string {
  return isBoundedString(value, maximum) && value.length > 0;
}
function validValue(value: unknown): value is AgentSessionSettingValue {
  return typeof value === "boolean" || (typeof value === "string" && value.length <= 4096);
}
function validChoice(value: unknown): value is AgentSessionSettingChoice {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.value, 4096) &&
    isBoundedString(value.name, 4096) &&
    (value.description === undefined || (typeof value.description === "string" && value.description.length <= 16384)) &&
    (value.group === undefined || isBoundedString(value.group, 4096))
  );
}
function validOption(value: unknown): value is AgentSessionSettingOption {
  return (
    isDynamicRecord(value) &&
    nonempty(value.id, 256) &&
    isBoundedString(value.name, 4096) &&
    (value.description === undefined || (typeof value.description === "string" && value.description.length <= 16384)) &&
    (value.category === undefined || isBoundedString(value.category, 256)) &&
    (value.type === "boolean"
      ? typeof value.currentValue === "boolean"
      : value.type === "select" &&
        typeof value.currentValue === "string" &&
        value.currentValue.length <= 4096 &&
        Array.isArray(value.options) &&
        value.options.length <= 4096 &&
        value.options.every(validChoice))
  );
}
export function isAgentSessionSettings(value: unknown): value is AgentSessionSettings {
  return (
    isDynamicRecord(value) &&
    nonempty(value.agentId, 128) &&
    nonempty(value.providerIdentity, 160) &&
    typeof value.pending === "boolean" &&
    Array.isArray(value.options) &&
    value.options.length <= 64 &&
    value.options.every(validOption) &&
    isDynamicRecord(value.overrides) &&
    Object.keys(value.overrides).length <= 64 &&
    Object.entries(value.overrides).every(([id, entry]) => nonempty(id, 256) && validValue(entry))
  );
}
export function parseSetAgentSessionSetting(value: unknown): SetAgentSessionSettingInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => !["agentId", "settingId", "value"].includes(key)) ||
    !nonempty(value.agentId, 128) ||
    !nonempty(value.settingId, 256) ||
    !validValue(value.value)
  )
    throw new Error("Invalid session setting request.");
  return { agentId: value.agentId, settingId: value.settingId, value: value.value };
}
export function parseResetAgentSessionSetting(value: unknown): ResetAgentSessionSettingInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => !["agentId", "settingId"].includes(key)) ||
    !nonempty(value.agentId, 128) ||
    !nonempty(value.settingId, 256)
  )
    throw new Error("Invalid session setting reset.");
  return { agentId: value.agentId, settingId: value.settingId };
}

export function isAgentSessionSettingResets(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every((identity) => nonempty(identity, 160));
}
