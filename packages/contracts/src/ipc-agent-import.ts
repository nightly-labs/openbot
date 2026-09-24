/**
 * Agent import: agents exported from another app as one `.zip`, read by the local host.
 *
 * The main process reads and checks the archive, keeps it under a token, and answers a preview.
 * The renderer never receives a path or the archive bytes: it names the token and the agents and
 * channels to import. Import goes to the local host only.
 */

import { INPUT_LIMITS } from "./input-limits";
import { type AgentSummary, isAgentSummary } from "./ipc-agents";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export const AGENT_IMPORT_LIMITS = {
  archiveBytes: 500 * 1024 * 1024,
  files: 5_000,
  /** One key names one agent in the archive: lowercase letters, digits and hyphens. */
  key: 64,
  sourceApp: 64,
  /** Group chats in one export. Each becomes a channel. */
  channels: 100,
  message: 500,
  warnings: 200,
} as const;

export interface AgentImportPreviewAgent {
  key: string;
  name: string;
  title: string;
  description: string;
  /** A `data:` URL of the checked avatar, or null when the archive has none. */
  avatarUrl: string | null;
  skillCount: number;
  routineCount: number;
  memoryCount: number;
  fileCount: number;
  fileBytes: number;
  /** An agent on this server already has this name. The import adds another one beside it. */
  nameExists: boolean;
}

/** A group chat in the export. Its members are agent keys of the same export. */
export interface AgentImportPreviewChannel {
  key: string;
  name: string;
  title: string;
  memberKeys: string[];
  /** One of `memberKeys`, or null when the group chat has no lead. */
  leadKey: string | null;
  memoryCount: number;
  routineCount: number;
}

export interface AgentImportPreview {
  token: string;
  sourceApp: string;
  exportedAt: string | null;
  agents: AgentImportPreviewAgent[];
  channels: AgentImportPreviewChannel[];
  warnings: string[];
}

export interface ApplyAgentImportInput {
  token: string;
  keys: string[];
  channelKeys: string[];
}

export interface AgentImportSkipped {
  key: string;
  name: string;
  reason: string;
}

export interface AgentImportResult {
  agents: AgentSummary[];
  skipped: AgentImportSkipped[];
  channels: AgentImportChannel[];
  skippedChannels: AgentImportSkipped[];
  warnings: string[];
}

/** A channel the import created. */
export interface AgentImportChannel {
  id: string;
  name: string;
}

function invalid(label: string): never {
  throw new Error(`Invalid ${label}.`);
}

function record(value: unknown, label: string) {
  if (!isDynamicRecord(value)) invalid(label);
  return value;
}

export function isAgentImportKey(value: unknown): value is string {
  return isBoundedString(value, AGENT_IMPORT_LIMITS.key) && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value);
}

function count(value: unknown, label: string): number {
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}

function messages(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > AGENT_IMPORT_LIMITS.warnings ||
    !value.every((item) => isBoundedString(item, AGENT_IMPORT_LIMITS.message))
  )
    invalid(label);
  return value;
}

export function parseApplyAgentImportInput(value: unknown): ApplyAgentImportInput {
  const input = record(value, "import request");
  if (!isIdentifier(input.token)) invalid("import token");
  if (
    !Array.isArray(input.keys) ||
    input.keys.length === 0 ||
    input.keys.length > INPUT_LIMITS.agents ||
    !input.keys.every(isAgentImportKey) ||
    new Set(input.keys).size !== input.keys.length
  )
    invalid("agent selection");
  if (!isKeyList(input.channelKeys, AGENT_IMPORT_LIMITS.channels)) invalid("channel selection");
  return { token: input.token, keys: input.keys, channelKeys: input.channelKeys };
}

function isKeyList(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(isAgentImportKey) &&
    new Set(value).size === value.length
  );
}

function decodePreviewChannel(value: unknown): AgentImportPreviewChannel {
  const channel = record(value, "imported channel");
  if (
    !isAgentImportKey(channel.key) ||
    !isBoundedString(channel.name, INPUT_LIMITS.agentName) ||
    !isBoundedString(channel.title, INPUT_LIMITS.agentTitle) ||
    !isKeyList(channel.memberKeys, INPUT_LIMITS.agents) ||
    (channel.leadKey !== null && !(isString(channel.leadKey) && channel.memberKeys.includes(channel.leadKey)))
  )
    invalid("imported channel");
  return {
    key: channel.key,
    name: channel.name,
    title: channel.title,
    memberKeys: channel.memberKeys,
    leadKey: channel.leadKey,
    memoryCount: count(channel.memoryCount, "imported channel"),
    routineCount: count(channel.routineCount, "imported channel"),
  };
}

function decodeSkipped(value: unknown, label: string): AgentImportSkipped[] {
  if (!Array.isArray(value)) invalid("import result");
  return value.map((item): AgentImportSkipped => {
    const entry = record(item, label);
    if (
      !isAgentImportKey(entry.key) ||
      !isBoundedString(entry.name, INPUT_LIMITS.agentName) ||
      !isBoundedString(entry.reason, AGENT_IMPORT_LIMITS.message)
    )
      invalid(label);
    return { key: entry.key, name: entry.name, reason: entry.reason };
  });
}

function decodePreviewAgent(value: unknown): AgentImportPreviewAgent {
  const agent = record(value, "imported agent");
  if (
    !isAgentImportKey(agent.key) ||
    !isBoundedString(agent.name, INPUT_LIMITS.agentName) ||
    !isBoundedString(agent.title, INPUT_LIMITS.agentTitle) ||
    !isBoundedString(agent.description, INPUT_LIMITS.agentDescription) ||
    (agent.avatarUrl !== null && !(isString(agent.avatarUrl) && agent.avatarUrl.startsWith("data:image/"))) ||
    !isBoolean(agent.nameExists)
  )
    invalid("imported agent");
  return {
    key: agent.key,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    avatarUrl: agent.avatarUrl,
    skillCount: count(agent.skillCount, "imported agent"),
    routineCount: count(agent.routineCount, "imported agent"),
    memoryCount: count(agent.memoryCount, "imported agent"),
    fileCount: count(agent.fileCount, "imported agent"),
    fileBytes: count(agent.fileBytes, "imported agent"),
    nameExists: agent.nameExists,
  };
}

export function decodeAgentImportPreview(value: unknown): AgentImportPreview | null {
  if (value === null) return null;
  const preview = record(value, "import preview");
  if (
    !isIdentifier(preview.token) ||
    !isBoundedString(preview.sourceApp, AGENT_IMPORT_LIMITS.sourceApp) ||
    !isNullableBoundedString(preview.exportedAt, 64) ||
    !Array.isArray(preview.agents) ||
    preview.agents.length > INPUT_LIMITS.agents ||
    !Array.isArray(preview.channels) ||
    preview.channels.length > AGENT_IMPORT_LIMITS.channels
  )
    invalid("import preview");
  return {
    token: preview.token,
    sourceApp: preview.sourceApp,
    exportedAt: preview.exportedAt,
    agents: preview.agents.map(decodePreviewAgent),
    channels: preview.channels.map(decodePreviewChannel),
    warnings: messages(preview.warnings, "import warnings"),
  };
}

export function decodeAgentImportResult(value: unknown): AgentImportResult {
  const result = record(value, "import result");
  if (!Array.isArray(result.agents) || !result.agents.every(isAgentSummary)) invalid("import result");
  if (!Array.isArray(result.channels)) invalid("import result");
  const channels = result.channels.map((item): AgentImportChannel => {
    const entry = record(item, "imported channel");
    if (!isIdentifier(entry.id) || !isBoundedString(entry.name, INPUT_LIMITS.agentName)) invalid("imported channel");
    return { id: entry.id, name: entry.name };
  });
  return {
    agents: result.agents,
    skipped: decodeSkipped(result.skipped, "skipped agent"),
    channels,
    skippedChannels: decodeSkipped(result.skippedChannels, "skipped channel"),
    warnings: messages(result.warnings, "import warnings"),
  };
}
