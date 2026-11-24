export const SKILL_CATEGORIES = [
  "productivity",
  "documents",
  "design",
  "research",
  "data-analytics",
  "automation",
  "coding",
  "other",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  coding: "Coding",
  design: "Design",
  "data-analytics": "Data & Analytics",
  documents: "Documents",
  productivity: "Productivity",
  research: "Research",
  automation: "Automation",
  other: "Other",
};
export type SkillReviewStatus = "pending" | "approved" | "rejected";
export type InstalledSkillState = "installed" | "update-available" | "modified" | "needs-repair";

export interface MarketplaceSkillSummary {
  creatorAvatarUrl?: string | null;
  id: string;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  creatorName: string;
  version: number;
  installs: number;
  featured: boolean;
  verified?: boolean;
  iconUrl: string | null;
  updatedAt: string;
}

export type MarketplaceSkillSort = "installs" | "updated" | "name";

export interface MarketplaceSkillDetail extends MarketplaceSkillSummary {
  versionId: string;
  bundleSha256: string;
  files: string[];
  instructions: string;
  examplePrompt?: string;
  cardUrl?: string | null;
}

export interface MarketplaceSkillPage {
  skills: MarketplaceSkillSummary[];
  nextCursor: string | null;
}

export interface MarketplaceSkillQuery {
  query?: string | undefined;
  category?: SkillCategory;
  featured?: boolean;
  verified?: boolean | undefined;
  sort?: MarketplaceSkillSort | undefined;
  cursor?: string | undefined;
  limit?: number;
}

export interface SkillSubmission {
  showCreatorAvatar?: boolean;
  id: string;
  skillId: string;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: number;
  status: SkillReviewStatus;
  rejectionNote: string | null;
  iconUrl: string | null;
  createdAt: string;
}

export interface SkillPackagePreview {
  draftId: string;
  name: string;
  description: string;
  slug: string;
  files: string[];
  size: number;
}

export interface SubmitSkillInput {
  showCreatorAvatar?: boolean;
  draftId: string;
  category: SkillCategory;
  icon: { mimeType: "image/png" | "image/jpeg" | "image/webp"; bytes: Uint8Array } | null;
  skillId?: string;
}

export const INSTALLED_SKILL_ORIGINS = ["marketplace", "managed", "local", "workspace"] as const;

export const HOME_SKILL_ID_PREFIX = "home:";

export function isHomeSkillId(skillId: string): boolean {
  return skillId.startsWith(HOME_SKILL_ID_PREFIX);
}
export type InstalledSkillOrigin = (typeof INSTALLED_SKILL_ORIGINS)[number];

export const SKILL_CREATION_REQUEST =
  "Help me create a new local skill. Use the skill-creation guide. Ask me what workflow it should support before you create it.";

export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

export interface InstalledSkill {
  skillId: string;
  slug: string;
  name: string;
  installedVersion: number;
  availableVersion: number;
  state: InstalledSkillState;
  enabled?: boolean;
  origin?: InstalledSkillOrigin;
  description?: string;
  location?: string;
  problem?: string;
}

export function isBuiltInSkill(skill: InstalledSkill): boolean {
  return (
    skill.origin === "managed" || skill.slug === "openbot-site-hosting" || skill.skillId === "openbot-site-hosting"
  );
}

export function isFolderSkill(skill: InstalledSkill): boolean {
  return skill.origin === "workspace";
}

export function isSkillEnabled(skill: InstalledSkill): boolean {
  return skill.enabled !== false;
}

export function isRemovableSkill(skill: InstalledSkill): boolean {
  return !isBuiltInSkill(skill) && !isFolderSkill(skill) && !isHomeSkillId(skill.skillId);
}

export function isUserAssignedSkill(skill: InstalledSkill): boolean {
  return !isBuiltInSkill(skill) && !isHomeSkillId(skill.skillId);
}

export function userAssignedSkills(skills: readonly InstalledSkill[]): InstalledSkill[] {
  return skills.filter(isUserAssignedSkill).sort((left, right) => left.name.localeCompare(right.name));
}

export function assignedSkillCount(skills: readonly InstalledSkill[]): number {
  return skills.filter((skill) => !isBuiltInSkill(skill) && !isFolderSkill(skill)).length;
}

export interface InstallSkillInput {
  agentId: string;
  skillId: string;
  versionId?: string;
  replaceModified?: boolean;
}

export interface UninstallSkillInput {
  agentId: string;
  skillId: string;
  removeModified?: boolean;
}

export interface SetEnabledSkillInput {
  agentId: string;
  skillId: string;
  enabled: boolean;
}

export function isSkillCategory(value: unknown): value is SkillCategory {
  return isOneOf(SKILL_CATEGORIES, value);
}

export function isSkillNote(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= SKILL_DESCRIPTION_MAX_LENGTH;
}

export function decodeInstalledSkills(value: unknown): InstalledSkill[] {
  if (!Array.isArray(value)) throw new Error("Invalid installed skill list.");
  return value.map((item) => {
    const skill = decodeRecord(item, "installed skill");
    const state = requiredString(skill, "state");
    if (!isOneOf(["installed", "update-available", "modified", "needs-repair"] as const, state)) {
      throw new Error("Invalid installed skill state.");
    }
    const description = optionalSkillDescription(skill.description);
    return {
      skillId: requiredString(skill, "skillId"),
      slug: requiredString(skill, "slug"),
      name: requiredString(skill, "name"),
      installedVersion: requiredNumber(skill, "installedVersion"),
      availableVersion: requiredNumber(skill, "availableVersion"),
      state,
      ...(skill.enabled === false ? { enabled: false } : skill.enabled === true ? { enabled: true } : {}),
      ...(isOneOf(INSTALLED_SKILL_ORIGINS, skill.origin) ? { origin: skill.origin } : {}),
      ...(description ? { description } : {}),
      ...(isSkillNote(skill.location) ? { location: skill.location } : {}),
      ...(isSkillNote(skill.problem) ? { problem: skill.problem } : {}),
    };
  });
}

function optionalSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= SKILL_DESCRIPTION_MAX_LENGTH ? description : undefined;
}

export function marketplaceQueryParams(query: MarketplaceSkillQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.query) params.set("query", query.query);
  if (query.category) params.set("category", query.category);
  if (query.featured) params.set("featured", "true");
  if (query.verified !== undefined) params.set("verified", String(query.verified));
  if (query.sort) params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  return params;
}

export function decodeMarketplaceSkillPage(value: unknown): MarketplaceSkillPage {
  if (!isDynamicRecord(value) || !Array.isArray(value.skills) || !value.skills.every(isMarketplaceSkillSummary))
    throw new Error("Invalid skill marketplace response.");
  if (value.nextCursor !== null && !isString(value.nextCursor)) throw new Error("Invalid skill marketplace response.");
  return {
    skills: value.skills.map(({ verified, ...skill }) => (isBoolean(verified) ? { ...skill, verified } : skill)),
    nextCursor: value.nextCursor,
  };
}

export function decodeMarketplaceSkillDetail(value: unknown): MarketplaceSkillDetail {
  if (!isMarketplaceSkillDetail(value)) throw new Error("Invalid skill detail response.");
  const { verified, ...skill } = value;
  return isBoolean(verified) ? { ...skill, verified } : skill;
}

function isMarketplaceSkillSummary(value: unknown): value is MarketplaceSkillSummary {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.slug) &&
    isString(value.name) &&
    isString(value.description) &&
    isSkillCategory(value.category) &&
    isString(value.creatorName) &&
    (value.creatorAvatarUrl === undefined || value.creatorAvatarUrl === null || isString(value.creatorAvatarUrl)) &&
    isNumber(value.version) &&
    isNumber(value.installs) &&
    isBoolean(value.featured) &&
    (value.iconUrl === null || isString(value.iconUrl)) &&
    isString(value.updatedAt)
  );
}

function isMarketplaceSkillDetail(value: unknown): value is MarketplaceSkillDetail {
  return (
    isDynamicRecord(value) &&
    isMarketplaceSkillSummary(value) &&
    isString(value.versionId) &&
    isString(value.bundleSha256) &&
    isString(value.instructions) &&
    (value.examplePrompt === undefined || (isString(value.examplePrompt) && value.examplePrompt.length <= 1_000)) &&
    (value.cardUrl === undefined || value.cardUrl === null || isString(value.cardUrl)) &&
    Array.isArray(value.files) &&
    value.files.every(isString)
  );
}

import { isIdentifier } from "./ipc-bounded-values";
import { decodeRecord, requiredNumber, requiredString } from "./ipc-decoding";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export interface CreateLocalSkillInput {
  agentId: string;
  sourcePath: string;
}
export interface ReviseLocalSkillInput extends CreateLocalSkillInput {
  skillId: string;
  expectedRevision: number;
}
export interface LocalSkillRevisionInput {
  skillId: string;
  revision?: number | undefined;
}
export type InstallLocalSkillInput = LocalSkillRevisionInput & { agentId: string; revision: number };

export const SKILL_LEARNING_MODES = ["automatic", "ask", "off"] as const;
export type SkillLearningMode = (typeof SKILL_LEARNING_MODES)[number];
export const DEFAULT_SKILL_LEARNING_MODE: SkillLearningMode = "automatic";

export function isSkillLearningMode(value: unknown): value is SkillLearningMode {
  return isOneOf(SKILL_LEARNING_MODES, value);
}

export interface SkillLearningPreference {
  mode: SkillLearningMode;
}

export interface HostSkillLearning {
  mode: string;
  choices: string[];
}

export function hostSkillLearning({ mode }: SkillLearningPreference): HostSkillLearning {
  return { mode, choices: [...SKILL_LEARNING_MODES] };
}

export function decodeHostSkillLearning(value: unknown): HostSkillLearning {
  if (
    !isDynamicRecord(value) ||
    !isString(value.mode) ||
    !Array.isArray(value.choices) ||
    !value.choices.every(isString)
  )
    throw new Error("Invalid skill learning setting.");
  return { mode: value.mode, choices: [...value.choices] };
}

export interface SaveSkillSuggestionInput {
  agentId: string;
  messageId: string;
}

export interface SaveSkillSuggestionResult {
  saved: boolean;
}

export function parseSaveSkillSuggestion(value: unknown): SaveSkillSuggestionInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isIdentifier(value.messageId))
    throw new Error("Invalid skill suggestion.");
  return { agentId: value.agentId, messageId: value.messageId };
}

export function decodeSaveSkillSuggestionResult(value: unknown): SaveSkillSuggestionResult {
  if (!isDynamicRecord(value) || !isBoolean(value.saved)) throw new Error("Invalid skill suggestion result.");
  return { saved: value.saved };
}
