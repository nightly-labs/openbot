import { INPUT_LIMITS } from "./input-limits";
import { type AvatarHue, isAvatarHue, isAvatarSeed } from "./ipc-agent-identity";
import type { AgentSummary, AvatarImageInput } from "./ipc-agents";
import type { MarketplaceAgentRoutine, MarketplaceAgentSkill } from "./ipc-marketplace-agents";
import { isRoutineSchedule } from "./ipc-routines";
import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

/**
 * An agent template is a public, link-only copy of one agent's instructions, skills and routines.
 * It never holds workspace files or memories. A marketplace skill travels as a reference to an
 * approved version; a local skill travels as its `SKILL.md` text only.
 */
export type AgentTemplateSkill =
  | ({ kind: "marketplace" } & MarketplaceAgentSkill)
  | { kind: "embedded"; slug: string; name: string; markdown: string };

export interface AgentTemplateSnapshot {
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  skills: AgentTemplateSkill[];
  routines: MarketplaceAgentRoutine[];
}

export interface AgentTemplateDetail extends AgentTemplateSnapshot {
  id: string;
  avatarUrl: string | null;
  /** The share card image (`AGENT_TEMPLATE_CARD`), or null when the publish sent none. */
  cardUrl?: string | null;
  creatorName: string;
  updatedAt: string;
}

export interface AgentTemplatePublication {
  templateId: string;
  shareUrl: string;
  publishedAt: string;
}

/** What the publish dialog shows for one local agent. `publication` is null when it is not published. */
export interface AgentTemplatePreview extends AgentTemplateSnapshot {
  agentId: string;
  avatarUrl: string | null;
  /** The uploaded avatar's bytes, so the share card can draw it. Null for a generated avatar. */
  avatarImage: AvatarImageInput | null;
  updatedAt: string | null;
  publication: AgentTemplatePublication | null;
  /**
   * Why the skills could not be read, such as a marketplace skill with local changes. The preview
   * still opens, so a published agent can be unpublished; publishing refuses with this error.
   */
  skillsError: string | null;
}

export interface PublishAgentTemplateInput {
  agentId: string;
  /** A PNG of `AGENT_TEMPLATE_CARD` size for link previews, or null to publish without one. */
  card: Uint8Array | null;
}

export interface InstallAgentTemplateInput {
  templateId: string;
  timezone: string;
}

export interface InstallAgentTemplateResult {
  agent: AgentSummary;
}

/** The share card: the 1.91:1 image X and other sites show for a link. */
export const AGENT_TEMPLATE_CARD = {
  width: 1200,
  height: 630,
  maxBytes: 1_500_000,
} as const;

/** Reads the PNG signature and the IHDR size, so a card of another type or size is refused. */
export function isAgentTemplateCardPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 24 || bytes.byteLength > AGENT_TEMPLATE_CARD.maxBytes) return false;
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  return (
    chunk === "IHDR" &&
    view.getUint32(16) === AGENT_TEMPLATE_CARD.width &&
    view.getUint32(20) === AGENT_TEMPLATE_CARD.height
  );
}

export const AGENT_TEMPLATE_LIMITS = {
  skills: 32,
  embeddedSkills: 10,
  skillMarkdown: 65_536,
  skillName: 80,
  skillSlug: 64,
} as const;

const SKILL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function isAgentTemplateSkill(value: unknown): value is AgentTemplateSkill {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "marketplace")
    return (
      isString(value.skillId) &&
      isString(value.versionId) &&
      isString(value.slug) &&
      isString(value.name) &&
      isNumber(value.version)
    );
  return (
    value.kind === "embedded" &&
    isString(value.slug) &&
    SKILL_SLUG_PATTERN.test(value.slug) &&
    isString(value.name) &&
    value.name.trim().length > 0 &&
    value.name.length <= AGENT_TEMPLATE_LIMITS.skillName &&
    isString(value.markdown) &&
    value.markdown.trim().length > 0 &&
    value.markdown.length <= AGENT_TEMPLATE_LIMITS.skillMarkdown
  );
}

export function isAgentTemplateRoutine(value: unknown): value is MarketplaceAgentRoutine {
  return (
    isDynamicRecord(value) &&
    isString(value.name) &&
    value.name.trim().length > 0 &&
    value.name.length <= INPUT_LIMITS.routineName &&
    isString(value.instruction) &&
    value.instruction.trim().length > 0 &&
    value.instruction.length <= INPUT_LIMITS.routineInstruction &&
    isBoolean(value.active) &&
    isRoutineSchedule(value.schedule)
  );
}

export function isAgentTemplateSnapshot(value: unknown): value is AgentTemplateSnapshot {
  return (
    isDynamicRecord(value) &&
    isString(value.name) &&
    value.name.trim().length > 0 &&
    value.name.length <= INPUT_LIMITS.agentName &&
    isString(value.title) &&
    value.title.length <= INPUT_LIMITS.agentTitle &&
    isString(value.description) &&
    value.description.trim().length > 0 &&
    value.description.length <= INPUT_LIMITS.agentDescription &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    Array.isArray(value.skills) &&
    value.skills.length <= AGENT_TEMPLATE_LIMITS.skills &&
    value.skills.every(isAgentTemplateSkill) &&
    value.skills.filter((skill) => skill.kind === "embedded").length <= AGENT_TEMPLATE_LIMITS.embeddedSkills &&
    Array.isArray(value.routines) &&
    value.routines.length <= INPUT_LIMITS.agentRoutines &&
    value.routines.every(isAgentTemplateRoutine)
  );
}

export function isAgentTemplateDetail(value: unknown): value is AgentTemplateDetail {
  return (
    isAgentTemplateSnapshot(value) &&
    isDynamicRecord(value) &&
    isString(value.id) &&
    (value.avatarUrl === null || isString(value.avatarUrl)) &&
    (value.cardUrl === undefined || value.cardUrl === null || isString(value.cardUrl)) &&
    isString(value.creatorName) &&
    isString(value.updatedAt)
  );
}

/** Copies only the known fields, so an extra key from the wire never reaches storage or the renderer. */
export function toAgentTemplateSnapshot(value: AgentTemplateSnapshot): AgentTemplateSnapshot {
  return {
    name: value.name.trim(),
    title: value.title.trim(),
    description: value.description.trim(),
    avatarSeed: value.avatarSeed,
    avatarHue: value.avatarHue,
    skills: value.skills.map((skill) =>
      skill.kind === "marketplace"
        ? {
            kind: "marketplace",
            skillId: skill.skillId,
            versionId: skill.versionId,
            slug: skill.slug,
            name: skill.name,
            version: skill.version,
          }
        : { kind: "embedded", slug: skill.slug, name: skill.name, markdown: skill.markdown },
    ),
    routines: value.routines.map(({ name, instruction, active, schedule }) => ({
      name,
      instruction,
      active,
      schedule: structuredClone(schedule),
    })),
  };
}
