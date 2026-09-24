// The `openbot-import.json` manifest at the root of an agent import archive.
//
// The format is a product contract: the Grok Bot export skill in
// `resources/agent-import/grok-bot/SKILL.md` writes it, and an export made by an older skill must
// still import. Add optional fields only; a change of meaning needs a new `version`.
//
// Structure errors reject the archive with the agent or channel and field named. A routine, memory,
// channel member or lead that cannot be kept is dropped with a warning, because the rest is still
// worth importing. `channels` is optional: an export made before group chats has none.

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

/** A group chat. Members and lead are agent keys of the same export. */
export interface ImportChannel {
  key: string;
  name: string;
  title: string;
  instructions: string;
  members: string[];
  lead: string | null;
  routines: ImportRoutine[];
  memories: string[];
}

export interface ImportManifest {
  sourceApp: string;
  exportedAt: string | null;
  agents: ImportAgent[];
  channels: ImportChannel[];
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

  const channelValues = value.channels === undefined ? [] : value.channels;
  if (!Array.isArray(channelValues)) throw new Error("The channel list is invalid.");
  if (channelValues.length > AGENT_IMPORT_LIMITS.channels)
    throw new Error(`The export contains more than ${AGENT_IMPORT_LIMITS.channels} channels.`);
  const channelKeys = new Set<string>();
  const channels: ImportChannel[] = [];
  for (const [index, item] of channelValues.entries()) {
    const channel = decodeChannel(item, index, keys, warnings, now);
    if (channelKeys.has(channel.key)) throw new Error(`Two channels use the key "${channel.key}".`);
    channelKeys.add(channel.key);
    if (channel.members.length === 0) {
      warnings.push(`${channel.name}: the channel is skipped because none of its agents are in the export.`);
      continue;
    }
    channels.push(channel);
  }
  return {
    manifest: { sourceApp, exportedAt, agents, channels },
    warnings: warnings.slice(0, AGENT_IMPORT_LIMITS.warnings),
  };
}

function decodeChannel(
  value: unknown,
  index: number,
  agentKeys: ReadonlySet<string>,
  warnings: string[],
  now: () => Date,
): ImportChannel {
  if (!isDynamicRecord(value)) throw new Error(`Channel ${index + 1} is invalid.`);
  if (!isAgentImportKey(value.key)) throw new Error(`Channel ${index + 1} has an invalid key.`);
  const key = value.key;
  const name = isString(value.name) ? value.name.trim() : "";
  if (!name || name.length > INPUT_LIMITS.agentName) invalidChannelField(key, "name");
  const title = value.title === undefined || value.title === null ? "" : value.title;
  if (!isBoundedString(title, INPUT_LIMITS.agentTitle)) invalidChannelField(key, "title");
  const instructions = value.instructions === undefined || value.instructions === null ? "" : value.instructions;
  if (!isBoundedString(instructions, INPUT_LIMITS.agentDescription)) invalidChannelField(key, "instructions");
  if (!Array.isArray(value.members) || value.members.length > INPUT_LIMITS.agents)
    invalidChannelField(key, "member list");
  const members = [...new Set(value.members.filter(isString))];
  const known = members.filter((member) => agentKeys.has(member));
  if (known.length < members.length || members.length < value.members.length)
    warnings.push(`${name}: members that are not agents in this export are left out.`);
  let lead = value.lead === undefined || value.lead === null ? null : value.lead;
  if (lead !== null && !(isString(lead) && known.includes(lead))) {
    warnings.push(`${name}: the lead is not a member, so the channel has no lead.`);
    lead = null;
  }
  const routines = value.routines === undefined ? [] : value.routines;
  if (!Array.isArray(routines)) invalidChannelField(key, "routine list");
  const memories = value.memories === undefined ? [] : value.memories;
  if (!Array.isArray(memories)) invalidChannelField(key, "memory list");
  return {
    key,
    name,
    title,
    instructions,
    members: known,
    lead,
    routines: decodeRoutines(routines, name, warnings, now),
    memories: decodeMemories(memories, name, warnings, INPUT_LIMITS.channelMemories),
  };
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
    memories: decodeMemories(memories, name, warnings, INPUT_LIMITS.agentMemories),
  };
}

function invalidField(key: string, field: string): never {
  throw new Error(`Agent "${key}" has an invalid ${field}.`);
}

function invalidChannelField(key: string, field: string): never {
  throw new Error(`Channel "${key}" has an invalid ${field}.`);
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

function decodeMemories(values: unknown[], owner: string, warnings: string[], limit: number): string[] {
  const memories = values
    .filter(isString)
    .map((text) => text.trim())
    .filter(Boolean);
  const kept = memories.filter((text) => text.length <= INPUT_LIMITS.agentMemoryText);
  if (kept.length < values.length)
    warnings.push(
      `${owner}: ${values.length - kept.length} memories are skipped because they are empty or longer than ${INPUT_LIMITS.agentMemoryText} characters.`,
    );
  if (kept.length > limit) warnings.push(`${owner}: only the first ${limit} memories are imported.`);
  return kept.slice(0, limit);
}
