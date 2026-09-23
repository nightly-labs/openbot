// The `openbot-import.json` manifest at the root of an agent import archive.
//
// The format is a product contract: the Grok Bot export skill in
// `resources/agent-import/grok-bot/SKILL.md` writes it, and an export made by an older skill must
// still import. Add optional fields only; a change of meaning needs a new `version`.
//
// Structure errors reject the archive with the agent and field named. A routine or memory that
// cannot be kept is dropped with a warning, because the rest of the agent is still worth importing.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_IMPORT_LIMITS, isAgentImportKey, isRoutineSchedule, type RoutineSchedule } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isUnsafeArchivePath } from "./skill-package";

export const AGENT_IMPORT_MANIFEST = "openbot-import.json";
const FORMAT = "openbot-agent-import";
const VERSION = 1;

export interface ImportRoutine {
  name: string;
  instruction: string;
  active: boolean;
  timezone: string | null;
  schedule: RoutineSchedule;
}

export interface ImportAgent {
  key: string;
  name: string;
  title: string;
  description: string;
  /** Archive paths, each checked to be inside `agents/<key>/`. */
  avatar: string | null;
  skills: string[];
  files: string | null;
  routines: ImportRoutine[];
  memories: string[];
}

export interface ImportManifest {
  sourceApp: string;
  exportedAt: string | null;
  agents: ImportAgent[];
}

export function decodeImportManifest(
  bytes: Uint8Array,
  now: () => Date = () => new Date(),
): { manifest: ImportManifest; warnings: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${AGENT_IMPORT_MANIFEST} is not valid JSON.`);
  }
  if (!isDynamicRecord(value) || value.format !== FORMAT)
    throw new Error(`${AGENT_IMPORT_MANIFEST} is not an OpenBot agent export.`);
  if (value.version !== VERSION)
    throw new Error("This export was made by a newer export skill. Update OpenBot and try again.");
  const source = isDynamicRecord(value.source) ? value.source : {};
  const sourceApp = isBoundedString(source.app, AGENT_IMPORT_LIMITS.sourceApp) && source.app ? source.app : "unknown";
  const exportedAt =
    isString(source.exportedAt) && !Number.isNaN(Date.parse(source.exportedAt)) ? source.exportedAt : null;
  if (!Array.isArray(value.agents) || value.agents.length === 0) throw new Error("The export contains no agents.");
  if (value.agents.length > INPUT_LIMITS.agents)
    throw new Error(`The export contains more than ${INPUT_LIMITS.agents} agents.`);

  const warnings: string[] = [];
  const keys = new Set<string>();
  const agents = value.agents.map((item, index) => {
    const agent = decodeAgent(item, index, warnings, now);
    if (keys.has(agent.key)) throw new Error(`Two agents use the key "${agent.key}".`);
    keys.add(agent.key);
    return agent;
  });
  return { manifest: { sourceApp, exportedAt, agents }, warnings: warnings.slice(0, AGENT_IMPORT_LIMITS.warnings) };
}

function decodeAgent(value: unknown, index: number, warnings: string[], now: () => Date): ImportAgent {
  if (!isDynamicRecord(value)) throw new Error(`Agent ${index + 1} is invalid.`);
  if (!isAgentImportKey(value.key)) throw new Error(`Agent ${index + 1} has an invalid key.`);
  const key = value.key;
  const name = isString(value.name) ? value.name.trim() : "";
  if (!name || name.length > INPUT_LIMITS.agentName) invalidField(key, "name");
  const title = value.title === undefined || value.title === null ? "" : value.title;
  if (!isBoundedString(title, INPUT_LIMITS.agentTitle)) invalidField(key, "title");
  const description = value.description;
  if (!isBoundedString(description, INPUT_LIMITS.agentDescription)) invalidField(key, "description");
  const prefix = `agents/${key}/`;
  const path = (candidate: unknown, field: string): string | null => {
    if (candidate === undefined || candidate === null) return null;
    if (!isString(candidate)) invalidField(key, field);
    const normalized = candidate.replace(/\/+$/u, "");
    if (!normalized.startsWith(prefix) || isUnsafeArchivePath(normalized)) invalidField(key, field);
    return normalized;
  };
  const skills = value.skills === undefined ? [] : value.skills;
  if (!Array.isArray(skills) || skills.length > INPUT_LIMITS.agentSkills) invalidField(key, "skill list");
  const routines = value.routines === undefined ? [] : value.routines;
  if (!Array.isArray(routines)) invalidField(key, "routine list");
  const memories = value.memories === undefined ? [] : value.memories;
  if (!Array.isArray(memories)) invalidField(key, "memory list");

  return {
    key,
    name,
    title,
    description,
    avatar: path(value.avatar, "avatar path"),
    skills: skills.map((skill: unknown) => path(skill, "skill path") ?? invalidField(key, "skill path")),
    files: path(value.files, "files path"),
    routines: decodeRoutines(routines, name, warnings, now),
    memories: decodeMemories(memories, name, warnings),
  };
}

function invalidField(key: string, field: string): never {
  throw new Error(`Agent "${key}" has an invalid ${field}.`);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return isString(value) && value.length <= maximum;
}

function decodeRoutines(values: unknown[], agent: string, warnings: string[], now: () => Date): ImportRoutine[] {
  const routines: ImportRoutine[] = [];
  for (const [index, value] of values.entries()) {
    const label = isDynamicRecord(value) && isString(value.name) ? value.name : `routine ${index + 1}`;
    if (routines.length >= INPUT_LIMITS.agentRoutines) {
      warnings.push(`${agent}: only the first ${INPUT_LIMITS.agentRoutines} routines are imported.`);
      break;
    }
    if (!isDynamicRecord(value)) {
      warnings.push(`${agent}: ${label} is skipped because it is invalid.`);
      continue;
    }
    // The export skill cannot know when the interval should start, so an absent anchor means now.
    const schedule =
      isDynamicRecord(value.schedule) && value.schedule.kind === "interval" && value.schedule.anchorAt === undefined
        ? { ...value.schedule, anchorAt: now().toISOString() }
        : value.schedule;
    const name = isString(value.name) ? value.name.trim() : "";
    if (
      !name ||
      name.length > INPUT_LIMITS.routineName ||
      !isString(value.instruction) ||
      !value.instruction.trim() ||
      value.instruction.length > INPUT_LIMITS.routineInstruction ||
      !isRoutineSchedule(schedule)
    ) {
      warnings.push(
        `${agent}: routine "${label.slice(0, 80)}" is skipped because its name, text, or schedule is invalid.`,
      );
      continue;
    }
    routines.push({
      name,
      instruction: value.instruction,
      active: isBoolean(value.active) ? value.active : true,
      timezone: isString(value.timezone) ? value.timezone : null,
      schedule,
    });
  }
  return routines;
}

function decodeMemories(values: unknown[], agent: string, warnings: string[]): string[] {
  const memories = values
    .filter(isString)
    .map((text) => text.trim())
    .filter(Boolean);
  const kept = memories.filter((text) => text.length <= INPUT_LIMITS.agentMemoryText);
  if (kept.length < values.length)
    warnings.push(
      `${agent}: ${values.length - kept.length} memories are skipped because they are empty or longer than ${INPUT_LIMITS.agentMemoryText} characters.`,
    );
  if (kept.length > INPUT_LIMITS.agentMemories)
    warnings.push(`${agent}: only the first ${INPUT_LIMITS.agentMemories} memories are imported.`);
  return kept.slice(0, INPUT_LIMITS.agentMemories);
}
