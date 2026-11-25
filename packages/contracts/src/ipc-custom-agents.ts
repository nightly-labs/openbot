import { isCustomAgentId, isNewCustomAgentId } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isNullableBoundedString } from "./ipc-bounded-values";
import { CUSTOM_PROVIDER_RESTARTS, type CustomProviderRestart } from "./ipc-custom-providers";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const CUSTOM_AGENT_LIMITS = {
  agents: 16,
  command: 1_024,
  args: 32,
  arg: 1_024,
  env: 16,
  envValue: 4_096,
  capabilities: 32,
  checkModels: 256,
  usagePrompt: 256,
  usageAnswer: 4_000,
} as const;

export const CUSTOM_AGENT_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CustomAgentEnvInput {
  name: string;
  value: string | null;
}

export interface SaveCustomAgentInput {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: CustomAgentEnvInput[];
  usagePrompt: string | null;
}

export interface DeleteCustomAgentInput {
  id: string;
}

export interface CustomAgentSummary {
  id: string;
  name: string;
  command: string;
  args: string[];
  envNames: string[];
  usagePrompt?: string | null | undefined;
  resolvedCommand: string | null;
}

export interface CustomAgentUsage {
  id: string;
  text: string;
}

export interface CustomAgentResult {
  agents: CustomAgentSummary[];
  restart: CustomProviderRestart;
}

export interface CheckCustomAgentInput {
  command: string;
  args: string[];
  env: CustomAgentEnvInput[];
  savedAgentId?: string;
}

export interface CustomAgentCheckResult {
  agentName: string;
  version: string | null;
  protocolVersion: number;
  capabilities: string[];
  models: string[];
}

export interface DetectedAcpAgent {
  id: string;
  name: string;
  command: string;
  args: string[];
}

function isArgs(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= CUSTOM_AGENT_LIMITS.args &&
    value.every((arg) => isBoundedString(arg, CUSTOM_AGENT_LIMITS.arg))
  );
}

export function isCustomAgentUsagePrompt(value: unknown): value is string {
  return isBoundedString(value, CUSTOM_AGENT_LIMITS.usagePrompt) && value.trim().length > 0 && !/[\0\r\n]/.test(value);
}

export function isCustomAgentEnvName(value: unknown): value is string {
  return isBoundedString(value, INPUT_LIMITS.identifier) && CUSTOM_AGENT_ENV_NAME_PATTERN.test(value);
}

export function isCustomAgentSummary(value: unknown): value is CustomAgentSummary {
  return (
    isDynamicRecord(value) &&
    !("env" in value) &&
    !("secret" in value) &&
    !("value" in value) &&
    isString(value.id) &&
    isCustomAgentId(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.command, CUSTOM_AGENT_LIMITS.command) &&
    isArgs(value.args) &&
    Array.isArray(value.envNames) &&
    value.envNames.length <= CUSTOM_AGENT_LIMITS.env &&
    value.envNames.every(isCustomAgentEnvName) &&
    (value.usagePrompt === undefined || value.usagePrompt === null || isCustomAgentUsagePrompt(value.usagePrompt)) &&
    isNullableBoundedString(value.resolvedCommand, CUSTOM_AGENT_LIMITS.command)
  );
}

export function isCustomAgentResult(value: unknown): value is CustomAgentResult {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.agents) &&
    value.agents.length <= CUSTOM_AGENT_LIMITS.agents &&
    value.agents.every(isCustomAgentSummary) &&
    isOneOf(CUSTOM_PROVIDER_RESTARTS, value.restart)
  );
}

export function isCustomAgentUsage(value: unknown): value is CustomAgentUsage {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isCustomAgentId(value.id) &&
    isBoundedString(value.text, CUSTOM_AGENT_LIMITS.usageAnswer)
  );
}

export function isCustomAgentCheckResult(value: unknown): value is CustomAgentCheckResult {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.agentName, INPUT_LIMITS.agentName) &&
    isNullableBoundedString(value.version, 160) &&
    typeof value.protocolVersion === "number" &&
    Number.isInteger(value.protocolVersion) &&
    Array.isArray(value.capabilities) &&
    value.capabilities.length <= CUSTOM_AGENT_LIMITS.capabilities &&
    value.capabilities.every((name) => isBoundedString(name, INPUT_LIMITS.identifier)) &&
    Array.isArray(value.models) &&
    value.models.length <= CUSTOM_AGENT_LIMITS.checkModels &&
    value.models.every((name) => isBoundedString(name, INPUT_LIMITS.modelName))
  );
}

export function isDetectedAcpAgent(value: unknown): value is DetectedAcpAgent {
  return (
    isDynamicRecord(value) &&
    !("env" in value) &&
    isString(value.id) &&
    isNewCustomAgentId(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.command, CUSTOM_AGENT_LIMITS.command) &&
    isArgs(value.args)
  );
}
