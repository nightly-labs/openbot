// The custom agent payloads. `save` and `check` carry environment values, often an API key, so no
// message here quotes a value.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type CheckCustomAgentInput,
  CUSTOM_AGENT_LIMITS,
  type CustomAgentEnvInput,
  type DeleteCustomAgentInput,
  isCustomAgentEnvName,
  isCustomAgentId,
  type SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { agentCommandForm } from "../../backend/acp-agent-command";
import { isObject, requireString } from "./validation";

/** The change service rejects reserved IDs only when creating a new agent. */
function parseAgentId(value: unknown): string {
  if (!isString(value) || !isCustomAgentId(value)) throw new Error(sourceText("error.provider.customAgentIdInvalid"));
  return value;
}

function parseCommand(value: unknown): string {
  if (!isString(value) || !agentCommandForm(value))
    throw new Error(sourceText("error.provider.customAgentCommandInvalid"));
  return value;
}

function parseArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > CUSTOM_AGENT_LIMITS.args ||
    !value.every((arg) => isString(arg) && arg.length <= CUSTOM_AGENT_LIMITS.arg && !/[\0\r\n]/.test(arg))
  ) {
    throw new Error(sourceText("error.provider.customAgentArgsInvalid"));
  }
  return [...value];
}

/** `value: null` keeps the saved value. An empty value is a value: some agents read a flag as set. */
function parseEnv(value: unknown): CustomAgentEnvInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > CUSTOM_AGENT_LIMITS.env) {
    throw new Error(sourceText("error.provider.customAgentEnvInvalid"));
  }
  const env: CustomAgentEnvInput[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObject(entry) || !isCustomAgentEnvName(entry.name) || seen.has(entry.name)) {
      throw new Error(sourceText("error.provider.customAgentEnvInvalid"));
    }
    seen.add(entry.name);
    if (entry.value !== null && !(isString(entry.value) && entry.value.length <= CUSTOM_AGENT_LIMITS.envValue)) {
      throw new Error(sourceText("error.provider.customAgentEnvInvalid"));
    }
    env.push({ name: entry.name, value: entry.value });
  }
  return env;
}

export function parseSaveCustomAgent(input: unknown): SaveCustomAgentInput {
  if (!isObject(input)) throw new Error(sourceText("error.provider.customAgentCommandInvalid"));
  return {
    id: parseAgentId(input.id),
    name: requireString(input.name, "Display name", INPUT_LIMITS.agentName).trim(),
    command: parseCommand(input.command),
    args: parseArgs(input.args),
    env: parseEnv(input.env),
  };
}

export function parseDeleteCustomAgent(input: unknown): DeleteCustomAgentInput {
  if (!isObject(input)) throw new Error(sourceText("error.provider.customAgentIdInvalid"));
  return { id: parseAgentId(input.id) };
}

export function parseCheckCustomAgent(input: unknown): CheckCustomAgentInput {
  if (!isObject(input)) throw new Error(sourceText("error.provider.customAgentCommandInvalid"));
  return {
    command: parseCommand(input.command),
    args: parseArgs(input.args),
    env: parseEnv(input.env),
    ...(input.savedAgentId === undefined ? {} : { savedAgentId: parseAgentId(input.savedAgentId) }),
  };
}
