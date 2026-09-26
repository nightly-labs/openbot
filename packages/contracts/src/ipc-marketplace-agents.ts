import { type AvatarHue, isAvatarHue, isAvatarSeed } from "./ipc-agent-identity";
import type { AgentSummary } from "./ipc-agents";
import { isRoutineSchedule, type RoutineSchedule } from "./ipc-routines";
import { isSkillCategory, type SkillCategory } from "./ipc-skills";
import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export type AgentReviewStatus = "pending" | "approved" | "rejected";

export interface MarketplaceAgentSkill {
  skillId: string;
  versionId: string;
  slug: string;
  name: string;
  version: number;
}

export interface MarketplaceAgentRoutine {
  name: string;
  instruction: string;
  active: boolean;
  schedule: RoutineSchedule;
}

export interface MarketplaceAgentSummary {
  category?: SkillCategory;
  creatorAvatarUrl?: string | null;
  id: string;
  name: string;
  title: string;
  description: string;
  creatorName: string;
  version: number;
  installs: number;
  featured: boolean;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  skillCount: number;
  routineCount: number;
  activeRoutineCount: number;
  updatedAt: string;
}

export interface MarketplaceAgentDetail extends MarketplaceAgentSummary {
  versionId: string;
  skills: MarketplaceAgentSkill[];
  routines: MarketplaceAgentRoutine[];
}

export interface MarketplaceAgentPage {
  agents: MarketplaceAgentSummary[];
  nextCursor: string | null;
}

export interface MarketplaceAgentQuery {
  category?: SkillCategory;
  query?: string;
  featured?: boolean;
  sort?: "installs";
  cursor?: string;
  limit?: number;
}

export interface AgentSubmission {
  category?: SkillCategory;
  showCreatorAvatar?: boolean;
  id: string;
  listingId: string;
  name: string;
  title: string;
  description: string;
  version: number;
  status: AgentReviewStatus;
  rejectionNote: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  skillCount: number;
  routineCount: number;
  activeRoutineCount: number;
  createdAt: string;
}

export interface AgentPublicationPreview {
  agentId: string;
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  skills: MarketplaceAgentSkill[];
  routines: MarketplaceAgentRoutine[];
}

export interface SubmitMarketplaceAgentInput {
  category?: SkillCategory;
  showCreatorAvatar?: boolean;
  agentId: string;
  listingId?: string;
}

export interface InstallMarketplaceAgentInput {
  listingId: string;
  agentId?: string;
  timezone: string;
  receiptId: string;
}

export interface InstallMarketplaceAgentResult {
  agent: AgentSummary;
}

export function decodeMarketplaceAgentPage(value: unknown): MarketplaceAgentPage {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.agents) ||
    !value.agents.every(isMarketplaceAgentSummary) ||
    (value.nextCursor !== null && !isString(value.nextCursor))
  )
    throw new Error("Invalid agent marketplace response.");
  return { agents: value.agents, nextCursor: value.nextCursor };
}

export function decodeMarketplaceAgentDetail(value: unknown): MarketplaceAgentDetail {
  if (!isMarketplaceAgentSummary(value)) throw new Error("Invalid marketplace agent detail.");
  if (!isDynamicRecord(value)) throw new Error("Invalid marketplace agent detail.");
  const item = value;
  if (
    !isString(item.versionId) ||
    !Array.isArray(item.skills) ||
    !item.skills.every(isSkill) ||
    !Array.isArray(item.routines) ||
    !item.routines.every(isRoutine)
  )
    throw new Error("Invalid marketplace agent detail.");
  return {
    ...value,
    versionId: item.versionId,
    skills: item.skills.map(agentSkill),
    routines: item.routines.map(agentRoutine),
  };
}

function agentSkill(value: unknown): MarketplaceAgentSkill {
  if (!isDynamicRecord(value) || !isSkill(value)) throw new Error("Invalid marketplace agent skill.");
  return {
    skillId: value.skillId,
    versionId: value.versionId,
    slug: value.slug,
    name: value.name,
    version: value.version,
  };
}

function agentRoutine(value: unknown): MarketplaceAgentRoutine {
  if (!isDynamicRecord(value) || !isRoutine(value)) throw new Error("Invalid marketplace agent routine.");
  return { name: value.name, instruction: value.instruction, active: value.active, schedule: value.schedule };
}

function isMarketplaceAgentSummary(value: unknown): value is MarketplaceAgentSummary {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.title) &&
    isString(value.description) &&
    isString(value.creatorName) &&
    (value.creatorAvatarUrl === undefined || value.creatorAvatarUrl === null || isString(value.creatorAvatarUrl)) &&
    (value.category === undefined || isSkillCategory(value.category)) &&
    isNumber(value.version) &&
    isNumber(value.installs) &&
    isBoolean(value.featured) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarUrl === null || isString(value.avatarUrl)) &&
    isNumber(value.skillCount) &&
    isNumber(value.routineCount) &&
    isNumber(value.activeRoutineCount) &&
    isString(value.updatedAt)
  );
}

function isSkill(value: unknown): value is MarketplaceAgentSkill {
  return (
    isDynamicRecord(value) &&
    isString(value.skillId) &&
    isString(value.versionId) &&
    isString(value.slug) &&
    isString(value.name) &&
    isNumber(value.version)
  );
}

function isRoutine(value: unknown): value is MarketplaceAgentRoutine {
  return (
    isDynamicRecord(value) &&
    isString(value.name) &&
    isString(value.instruction) &&
    isBoolean(value.active) &&
    isRoutineSchedule(value.schedule)
  );
}
