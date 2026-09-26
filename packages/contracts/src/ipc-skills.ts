export const SKILL_CATEGORIES = [
  "coding",
  "design",
  "data-analytics",
  "documents",
  "productivity",
  "research",
  "automation",
  "other",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/**
 * What a category is called where a person reads it. Here rather than in the renderer because the
 * public plugin pages name the same categories, and two lists would drift the first time one is
 * renamed.
 */
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
  iconUrl: string | null;
  updatedAt: string;
}

export interface MarketplaceSkillDetail extends MarketplaceSkillSummary {
  versionId: string;
  bundleSha256: string;
  files: string[];
  instructions: string;
  examplePrompt?: string;
}

export interface MarketplaceSkillPage {
  skills: MarketplaceSkillSummary[];
  nextCursor: string | null;
}

export interface MarketplaceSkillQuery {
  query?: string;
  category?: SkillCategory;
  featured?: boolean;
  sort?: "installs";
  cursor?: string;
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

/**
 * `workspace` is a skill folder in `.agents/skills`, `.claude/skills` or `.opencode/skills` of the
 * agent workspace that OpenBot did not install. OpenBot lists it read-only and never writes to it.
 */
export const INSTALLED_SKILL_ORIGINS = ["marketplace", "managed", "local", "workspace"] as const;
export type InstalledSkillOrigin = (typeof INSTALLED_SKILL_ORIGINS)[number];

/** The Agent Skills specification limit for a SKILL.md `description`. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

export interface InstalledSkill {
  skillId: string;
  slug: string;
  name: string;
  installedVersion: number;
  availableVersion: number;
  state: InstalledSkillState;
  /** Missing on older hosts and Team GET payloads; treat as true. */
  enabled?: boolean;
  /** Missing on older hosts and Team GET payloads; treat as marketplace. */
  origin?: InstalledSkillOrigin;
  /** Missing on older hosts, Team GET payloads, and pre-description lock files. */
  description?: string;
  /** For a `workspace` skill: its folder, relative to the agent workspace. */
  location?: string;
  /**
   * For a `workspace` skill: why it does not follow the Agent Skills specification, or why
   * the agent's provider does not read its folder. A provider can skip such a skill.
   */
  problem?: string;
}

export interface InstallSkillInput {
  agentId: string;
  skillId: string;
  /**
   * The exact published version to install, for a caller that pins one - a plugin listing names the
   * version its app was written against. Omitted, the install takes the newest published version,
   * which is what the marketplace screens have always sent. An older host ignores the field and
   * installs the newest version, so a pin is a preference and never a requirement.
   */
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

/** A valid `location` or `problem` of an {@link InstalledSkill}. */
export function isSkillNote(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= SKILL_DESCRIPTION_MAX_LENGTH;
}

/**
 * The installed skills a remote host lists for one agent (`GET /v1/agents/:agentId/skills`). The
 * host is an untrusted sender: an unknown state fails the list, and an optional field that is not
 * valid is dropped.
 */
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

/** The search part of a catalog list request. The agent catalog takes the same fields. */
export function marketplaceQueryParams(query: MarketplaceSkillQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.query) params.set("query", query.query);
  if (query.category) params.set("category", query.category);
  if (query.featured) params.set("featured", "true");
  if (query.sort) params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  return params;
}

export function decodeMarketplaceSkillPage(value: unknown): MarketplaceSkillPage {
  if (!isDynamicRecord(value) || !Array.isArray(value.skills) || !value.skills.every(isMarketplaceSkillSummary))
    throw new Error("Invalid skill marketplace response.");
  if (value.nextCursor !== null && !isString(value.nextCursor)) throw new Error("Invalid skill marketplace response.");
  return { skills: value.skills, nextCursor: value.nextCursor };
}

export function decodeMarketplaceSkillDetail(value: unknown): MarketplaceSkillDetail {
  if (!isMarketplaceSkillDetail(value)) throw new Error("Invalid skill detail response.");
  return value;
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
    Array.isArray(value.files) &&
    value.files.every(isString)
  );
}

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
  revision?: number;
}
/** Installs one exact revision, so the agent gets the copy the user read. */
export type InstallLocalSkillInput = LocalSkillRevisionInput & { agentId: string; revision: number };
