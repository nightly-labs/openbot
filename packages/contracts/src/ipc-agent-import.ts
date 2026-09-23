/**
 * Agent import: agents exported from another app as one `.zip`, read by the local host.
 *
 * The main process reads and checks the archive, keeps it under a token, and answers a preview.
 * The renderer never receives a path or the archive bytes: it names the token and the agents to
 * import. Import goes to the local host only.
 */

import { INPUT_LIMITS } from "./input-limits";
import { type AgentSummary, isAgentSummary } from "./ipc-agents";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isString } from "./runtime-values";

export const AGENT_IMPORT_LIMITS = {
  archiveBytes: 500 * 1024 * 1024,
  files: 5_000,
  /** One key names one agent in the archive: lowercase letters, digits and hyphens. */
  key: 64,
  sourceApp: 64,
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
}

export interface AgentImportPreview {
  token: string;
  sourceApp: string;
  exportedAt: string | null;
  agents: AgentImportPreviewAgent[];
  warnings: string[];
}

export interface ApplyAgentImportInput {
  token: string;
  keys: string[];
}

export interface AgentImportSkipped {
  key: string;
  name: string;
  reason: string;
}

export interface AgentImportResult {
  agents: AgentSummary[];
  skipped: AgentImportSkipped[];
  warnings: string[];
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
  return { token: input.token, keys: input.keys };
}

function decodePreviewAgent(value: unknown): AgentImportPreviewAgent {
  const agent = record(value, "imported agent");
  if (
    !isAgentImportKey(agent.key) ||
    !isBoundedString(agent.name, INPUT_LIMITS.agentName) ||
    !isBoundedString(agent.title, INPUT_LIMITS.agentTitle) ||
    !isBoundedString(agent.description, INPUT_LIMITS.agentDescription) ||
    (agent.avatarUrl !== null && !(isString(agent.avatarUrl) && agent.avatarUrl.startsWith("data:image/")))
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
    preview.agents.length > INPUT_LIMITS.agents
  )
    invalid("import preview");
  return {
    token: preview.token,
    sourceApp: preview.sourceApp,
    exportedAt: preview.exportedAt,
    agents: preview.agents.map(decodePreviewAgent),
    warnings: messages(preview.warnings, "import warnings"),
  };
}

export function decodeAgentImportResult(value: unknown): AgentImportResult {
  const result = record(value, "import result");
  if (!Array.isArray(result.agents) || !result.agents.every(isAgentSummary)) invalid("import result");
  if (!Array.isArray(result.skipped)) invalid("import result");
  const skipped = result.skipped.map((item): AgentImportSkipped => {
    const entry = record(item, "skipped agent");
    if (
      !isAgentImportKey(entry.key) ||
      !isBoundedString(entry.name, INPUT_LIMITS.agentName) ||
      !isBoundedString(entry.reason, AGENT_IMPORT_LIMITS.message)
    )
      invalid("skipped agent");
    return { key: entry.key, name: entry.name, reason: entry.reason };
  });
  return { agents: result.agents, skipped, warnings: messages(result.warnings, "import warnings") };
}
