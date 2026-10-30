import {
  type AvatarHue,
  type MarketplaceAgentSummary,
  type MarketplaceSkillSummary,
  SKILL_CATEGORIES,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { catalogImageUrl, pluginIconUrl } from "../api/marketplace-catalog";
import { MOBILE_PLUGINS, type MobilePlugin } from "./plugin-catalog.generated";

/** The three kinds the Marketplace offers. The filter menu names them Agents, Apps and Skills. */
export type MarketplaceKind = "agent" | "app" | "skill";

export const MARKETPLACE_KINDS: readonly MarketplaceKind[] = ["agent", "app", "skill"];

interface ListingBase {
  id: string;
  name: string;
  description: string;
  category: SkillCategory | null;
  creatorName: string;
  /** An absolute https address, or null for a listing without an image. */
  imageUrl: string | null;
  featured: boolean;
}

/** One row of the Marketplace. Each kind keeps the record it came from, for its page. */
export type MarketplaceListing =
  | (ListingBase & {
      kind: "agent";
      installs: number;
      version: number;
      avatarSeed: string;
      avatarHue: AvatarHue | null;
      agent: MarketplaceAgentSummary;
    })
  | (ListingBase & { kind: "skill"; installs: number; skill: MarketplaceSkillSummary })
  | (ListingBase & { kind: "app"; plugin: MobilePlugin });

export function agentListing(apiUrl: string, agent: MarketplaceAgentSummary): MarketplaceListing {
  return {
    kind: "agent",
    id: agent.id,
    name: agent.name,
    description: agent.title || agent.description,
    category: agent.category ?? null,
    creatorName: agent.creatorName,
    imageUrl: catalogImageUrl(apiUrl, agent.avatarUrl),
    featured: agent.featured,
    installs: agent.installs,
    version: agent.version,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    agent,
  };
}

export function skillListing(apiUrl: string, skill: MarketplaceSkillSummary): MarketplaceListing {
  return {
    kind: "skill",
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    creatorName: skill.creatorName,
    imageUrl: catalogImageUrl(apiUrl, skill.iconUrl),
    featured: skill.featured,
    installs: skill.installs,
    skill,
  };
}

/** The plugin's first app gives the icon; every plugin carries exactly one app today. */
export function appListings(apiUrl: string): MarketplaceListing[] {
  return MOBILE_PLUGINS.map(
    (plugin): MarketplaceListing => ({
      kind: "app",
      id: plugin.slug,
      name: plugin.name,
      description: plugin.tagline,
      category: plugin.category,
      creatorName: plugin.creatorName,
      imageUrl: plugin.apps[0] ? pluginIconUrl(apiUrl, plugin.slug, plugin.apps[0].id) : null,
      featured: plugin.featured,
      plugin,
    }),
  );
}

/** What the filter menu narrows the page to. Nothing set is the overview. */
export interface MarketplaceFilter {
  kind: MarketplaceKind | null;
  category: SkillCategory | null;
  installed: boolean;
}

export const NO_MARKETPLACE_FILTER: MarketplaceFilter = { kind: null, category: null, installed: false };

export function isMarketplaceFiltered(filter: MarketplaceFilter): boolean {
  return filter.kind !== null || filter.category !== null || filter.installed;
}

/** The listing matches every part of the filter that is set. */
export function matchesFilter(
  listing: MarketplaceListing,
  filter: MarketplaceFilter,
  installed: (listing: MarketplaceListing) => boolean,
): boolean {
  return (
    (filter.kind === null || listing.kind === filter.kind) &&
    (filter.category === null || listing.category === filter.category) &&
    (!filter.installed || installed(listing))
  );
}

/** A plain text match on the name, description and creator. The catalog search does the same server side. */
export function matchesQuery(listing: MarketplaceListing, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [listing.name, listing.description, listing.creatorName].some((text) =>
    text.toLocaleLowerCase().includes(needle),
  );
}

/** The categories in catalog order. `other` comes last, as on the desktop. */
export const MARKETPLACE_CATEGORIES: readonly SkillCategory[] = SKILL_CATEGORIES;

export const CATEGORY_LABELS = {
  coding: "mobile.marketplace.category.coding",
  design: "mobile.marketplace.category.design",
  "data-analytics": "mobile.marketplace.category.dataAnalytics",
  documents: "mobile.marketplace.category.documents",
  productivity: "mobile.marketplace.category.productivity",
  research: "mobile.marketplace.category.research",
  automation: "mobile.marketplace.category.automation",
  other: "mobile.marketplace.category.other",
} as const satisfies Record<SkillCategory, MobileTextKey>;

export const KIND_LABELS = {
  agent: "mobile.marketplace.kind.agents",
  app: "mobile.marketplace.kind.apps",
  skill: "mobile.marketplace.kind.skills",
} as const satisfies Record<MarketplaceKind, MobileTextKey>;

/** The singular, for the line under a listing's name. */
export const KIND_SINGULAR_LABELS = {
  agent: "mobile.marketplace.kind.agent",
  app: "mobile.marketplace.kind.app",
  skill: "mobile.marketplace.kind.skill",
} as const satisfies Record<MarketplaceKind, MobileTextKey>;

/** The overview's order: featured first, then by installs. Apps have no install count yet. */
export function byPopularity(left: MarketplaceListing, right: MarketplaceListing): number {
  if (left.featured !== right.featured) return left.featured ? -1 : 1;
  const installs = (listing: MarketplaceListing) => (listing.kind === "app" ? 0 : listing.installs);
  return installs(right) - installs(left);
}
