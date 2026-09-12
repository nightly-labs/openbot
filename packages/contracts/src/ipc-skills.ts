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

export type InstalledSkillOrigin = "marketplace" | "managed";

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
}

export interface InstallSkillInput {
  agentId: string;
  skillId: string;
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

import { isOneOf } from "./runtime-values";
