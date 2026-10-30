/**
 * Hermes Agent import: the profiles of a Hermes folder on this computer, read by the main process.
 *
 * Only the local server imports from Hermes, because the folder is on this computer. The renderer
 * never receives a path to read or a file's text: main keeps the profiles under a token and answers
 * what each one holds, item by item. The renderer names the token, the profiles, and the items the
 * user allows. Values in `.env` and `auth.json` are never read into a preview.
 */

import { INPUT_LIMITS } from "./input-limits";
import {
  AGENT_IMPORT_LIMITS,
  type AgentImportChannel,
  type AgentImportResult,
  type AgentImportSkipped,
} from "./ipc-agent-import";
import { isAgentSummary } from "./ipc-agents";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isString } from "./runtime-values";

export const HERMES_IMPORT_LIMITS = {
  profiles: 64,
  items: 96,
  names: 64,
  name: 128,
  path: 1_024,
  model: 200,
} as const;

/** The name of a Hermes profile, as Hermes checks it. `default` is the Hermes folder itself. */
export const HERMES_PROFILE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

export const HERMES_IMPORT_ITEM_KINDS = [
  "instructions",
  "memories",
  "skills",
  "skill",
  "builtInSkills",
  "mcpServer",
  "routines",
  "routine",
  "terminal",
  "gateway",
  "secrets",
  "history",
] as const;
export type HermesImportItemKind = (typeof HERMES_IMPORT_ITEM_KINDS)[number];

/** `ready`: imports. `approve`: imports only when the user allows it. `skipped`: stays in Hermes. */
export const HERMES_IMPORT_ITEM_STATUSES = ["ready", "approve", "skipped"] as const;
export type HermesImportItemStatus = (typeof HERMES_IMPORT_ITEM_STATUSES)[number];

/** Why an item needs approval or stays in Hermes. The renderer shows the text for each one. */
export const HERMES_IMPORT_REASONS = [
  "defaultSoul",
  "scripts",
  "unsafeFile",
  "invalidSkill",
  "duplicateSkill",
  "builtIn",
  "mcpOff",
  "mcpNameTaken",
  "routineSchedule",
  "routineScript",
  "terminalBackend",
  "gateway",
  "secrets",
  "history",
] as const;
export type HermesImportReason = (typeof HERMES_IMPORT_REASONS)[number];

export interface HermesImportItem {
  /** Unique in its profile, such as `skill:github-pr-review` or `mcp:github`. */
  id: string;
  kind: HermesImportItemKind;
  status: HermesImportItemStatus;
  /** The skill, server, routine, platform or key names in the item, in Hermes's order. */
  names: string[];
  /** Entries, skills, jobs or keys the item stands for. */
  count: number;
  reason: HermesImportReason | null;
}

export interface HermesImportProfile {
  key: string;
  /** The name the new agent gets. */
  name: string;
  /** The profile folder, with the home folder shown as `~`. */
  path: string;
  /** The model in `config.yaml`, for the user to recognize the profile. The agent keeps OpenBot's model. */
  model: string | null;
  /** The agent an earlier import made from this profile, while it is still on this computer. */
  agent: { id: string; name: string } | null;
  items: HermesImportItem[];
}

export interface HermesImportPreview {
  token: string;
  /** The Hermes folder, with the home folder shown as `~`. */
  home: string;
  profiles: HermesImportProfile[];
}

export interface ApplyHermesImportInput {
  token: string;
  /** The profiles to import, each with the ids of the `approve` items the user allows. */
  profiles: { key: string; allow: string[] }[];
}

function invalid(label: string): never {
  throw new Error(`Invalid ${label}.`);
}

function record(value: unknown, label: string) {
  if (!isDynamicRecord(value)) invalid(label);
  return value;
}

export function isHermesProfileKey(value: unknown): value is string {
  return isString(value) && HERMES_PROFILE_KEY.test(value);
}

function isItemId(value: unknown): value is string {
  return isBoundedString(value, HERMES_IMPORT_LIMITS.name + 16) && value.length > 0;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((entry) => entry === value);
}

function names(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > HERMES_IMPORT_LIMITS.names ||
    !value.every((name) => isBoundedString(name, HERMES_IMPORT_LIMITS.name))
  )
    invalid("Hermes item names");
  return value;
}

function decodeItem(value: unknown): HermesImportItem {
  const item = record(value, "Hermes item");
  if (
    !isItemId(item.id) ||
    !isOneOf(HERMES_IMPORT_ITEM_KINDS, item.kind) ||
    !isOneOf(HERMES_IMPORT_ITEM_STATUSES, item.status) ||
    !isNumber(item.count) ||
    !Number.isSafeInteger(item.count) ||
    item.count < 0 ||
    (item.reason !== null && !isOneOf(HERMES_IMPORT_REASONS, item.reason))
  )
    invalid("Hermes item");
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    names: names(item.names),
    count: item.count,
    reason: item.reason,
  };
}

function decodeProfile(value: unknown): HermesImportProfile {
  const profile = record(value, "Hermes profile");
  if (
    !isHermesProfileKey(profile.key) ||
    !isBoundedString(profile.name, INPUT_LIMITS.agentName) ||
    !isBoundedString(profile.path, HERMES_IMPORT_LIMITS.path) ||
    !isNullableBoundedString(profile.model, HERMES_IMPORT_LIMITS.model) ||
    !Array.isArray(profile.items) ||
    profile.items.length > HERMES_IMPORT_LIMITS.items
  )
    invalid("Hermes profile");
  let agent: HermesImportProfile["agent"] = null;
  if (profile.agent !== null) {
    const linked = record(profile.agent, "Hermes profile");
    if (!isIdentifier(linked.id) || !isBoundedString(linked.name, INPUT_LIMITS.agentName)) invalid("Hermes profile");
    agent = { id: linked.id, name: linked.name };
  }
  return {
    key: profile.key,
    name: profile.name,
    path: profile.path,
    model: profile.model,
    agent,
    items: profile.items.map(decodeItem),
  };
}

export function decodeHermesImportPreview(value: unknown): HermesImportPreview | null {
  if (value === null) return null;
  const preview = record(value, "Hermes preview");
  if (
    !isIdentifier(preview.token) ||
    !isBoundedString(preview.home, HERMES_IMPORT_LIMITS.path) ||
    !Array.isArray(preview.profiles) ||
    preview.profiles.length > HERMES_IMPORT_LIMITS.profiles
  )
    invalid("Hermes preview");
  return { token: preview.token, home: preview.home, profiles: preview.profiles.map(decodeProfile) };
}

export function parseApplyHermesImportInput(value: unknown): ApplyHermesImportInput {
  const input = record(value, "Hermes import request");
  if (!isIdentifier(input.token)) invalid("Hermes import token");
  if (
    !Array.isArray(input.profiles) ||
    input.profiles.length === 0 ||
    input.profiles.length > HERMES_IMPORT_LIMITS.profiles
  )
    invalid("Hermes profile selection");
  const profiles = input.profiles.map((value) => {
    const entry = record(value, "Hermes profile selection");
    if (
      !isHermesProfileKey(entry.key) ||
      !Array.isArray(entry.allow) ||
      entry.allow.length > HERMES_IMPORT_LIMITS.items ||
      !entry.allow.every(isItemId) ||
      new Set(entry.allow).size !== entry.allow.length
    )
      invalid("Hermes profile selection");
    return { key: entry.key, allow: entry.allow };
  });
  if (new Set(profiles.map((profile) => profile.key)).size !== profiles.length) invalid("Hermes profile selection");
  return { token: input.token, profiles };
}

/** The result of a Hermes import, in the shape of an agent import. A skipped entry names a profile key. */
export function decodeHermesImportResult(value: unknown): AgentImportResult {
  const result = record(value, "Hermes import result");
  if (!Array.isArray(result.agents) || !result.agents.every(isAgentSummary)) invalid("Hermes import result");
  if (
    !Array.isArray(result.skipped) ||
    !Array.isArray(result.warnings) ||
    result.warnings.length > AGENT_IMPORT_LIMITS.warnings ||
    !result.warnings.every((warning) => isBoundedString(warning, AGENT_IMPORT_LIMITS.message))
  )
    invalid("Hermes import result");
  const skipped = result.skipped.map((item): AgentImportSkipped => {
    const entry = record(item, "skipped Hermes profile");
    if (
      !isHermesProfileKey(entry.key) ||
      !isBoundedString(entry.name, INPUT_LIMITS.agentName) ||
      !isBoundedString(entry.reason, AGENT_IMPORT_LIMITS.message)
    )
      invalid("skipped Hermes profile");
    return { key: entry.key, name: entry.name, reason: entry.reason };
  });
  const channels: AgentImportChannel[] = [];
  return { agents: result.agents, skipped, channels, skippedChannels: [], warnings: result.warnings };
}
