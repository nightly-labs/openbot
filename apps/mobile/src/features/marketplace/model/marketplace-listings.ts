import {
  type AvatarHue,
  type MarketplaceAgentSummary,
  type MarketplaceSkillSummary,
  type McpServerConfig,
  SKILL_CATEGORIES,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { MobileConnectorId } from "@/features/servers/model/connectors";
import { mcpServerDetail } from "@/features/servers/model/mcp-server-draft";
import type { ConnectorRow } from "@/features/servers/model/use-connector-rows";
import { catalogImageUrl, pluginIconUrl } from "../api/marketplace-catalog";
import type { MobilePlugin } from "./plugin-catalog.generated";

export type MarketplaceKind = "agent" | "app" | "skill";

export const MARKETPLACE_KINDS: readonly MarketplaceKind[] = ["agent", "app", "skill"];

interface ListingBase {
  id: string;
  name: string;
  description: string;
  category: SkillCategory | null;
  creatorName: string;
  imageUrl: string | null;
  featured: boolean;
}

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
  | (ListingBase & { kind: "app"; source: "plugin"; plugin: MobilePlugin })
  | (ListingBase & { kind: "app"; source: "connector"; connector: MobileConnectorId; connected: boolean })
  | (ListingBase & { kind: "app"; source: "custom"; server: McpServerConfig });

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

export function appListings(apiUrl: string, plugins: readonly MobilePlugin[]): MarketplaceListing[] {
  return plugins.map(
    (plugin): MarketplaceListing => ({
      kind: "app",
      id: plugin.slug,
      name: plugin.name,
      description: plugin.tagline,
      category: plugin.category,
      creatorName: plugin.creatorName,
      imageUrl: plugin.apps[0] ? pluginIconUrl(apiUrl, plugin.slug, plugin.apps[0].id) : null,
      featured: plugin.featured,
      source: "plugin",
      plugin,
    }),
  );
}

const CONNECTOR_CATEGORY = {
  slack: "productivity",
  discord: "productivity",
  telegram: "productivity",
  whatsapp: "productivity",
  github: "coding",
  onepassword: "productivity",
  bitwarden: "productivity",
  protonpass: "productivity",
} as const satisfies Record<MobileConnectorId, SkillCategory>;

export const CONNECTOR_TAGLINES = {
  slack: "mobile.marketplace.app.slackTagline",
  discord: "mobile.marketplace.app.discordTagline",
  telegram: "mobile.marketplace.app.telegramTagline",
  whatsapp: "mobile.marketplace.app.whatsappTagline",
  github: "mobile.marketplace.app.githubTagline",
  onepassword: "mobile.marketplace.app.onePasswordTagline",
  bitwarden: "mobile.marketplace.app.bitwardenTagline",
  protonpass: "mobile.marketplace.app.protonPassTagline",
} as const satisfies Record<MobileConnectorId, MobileTextKey>;

export function connectorListing(row: ConnectorRow, name: string, tagline: string): MarketplaceListing | null {
  if (row.status === "unavailable") return null;
  return {
    kind: "app",
    source: "connector",
    id: `connector:${row.id}`,
    name,
    description: tagline,
    category: CONNECTOR_CATEGORY[row.id],
    creatorName: "",
    imageUrl: null,
    featured: false,
    connector: row.id,
    connected: row.status !== "idle" && row.status !== "unknown",
  };
}

export function customListing(server: McpServerConfig): MarketplaceListing {
  return {
    kind: "app",
    source: "custom",
    id: `custom:${server.id}`,
    name: server.name,
    description: mcpServerDetail(server),
    category: null,
    creatorName: "",
    imageUrl: null,
    featured: false,
    server,
  };
}

export interface MarketplaceFilter {
  kind: MarketplaceKind | null;
  category: SkillCategory | null;
  installed: boolean;
}

export const NO_MARKETPLACE_FILTER: MarketplaceFilter = { kind: null, category: null, installed: false };

export function isMarketplaceFiltered(filter: MarketplaceFilter): boolean {
  return filter.kind !== null || filter.category !== null || filter.installed;
}

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

export function matchesQuery(listing: MarketplaceListing, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [listing.name, listing.description, listing.creatorName].some((text) =>
    text.toLocaleLowerCase().includes(needle),
  );
}

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

export const KIND_SINGULAR_LABELS = {
  agent: "mobile.marketplace.kind.agent",
  app: "mobile.marketplace.kind.app",
  skill: "mobile.marketplace.kind.skill",
} as const satisfies Record<MarketplaceKind, MobileTextKey>;

export function installsOf(listing: MarketplaceListing): number {
  return listing.kind === "app" ? 0 : listing.installs;
}

export function byPopularity(left: MarketplaceListing, right: MarketplaceListing): number {
  if (left.featured !== right.featured) return left.featured ? -1 : 1;
  return installsOf(right) - installsOf(left);
}

export function marketplaceFilterTokens(filter: MarketplaceFilter, t: MobileTranslate) {
  return [
    filter.kind ? { id: "kind", label: t(KIND_LABELS[filter.kind]) } : null,
    filter.category ? { id: "category", label: t(CATEGORY_LABELS[filter.category]) } : null,
    filter.installed ? { id: "installed", label: t("mobile.marketplace.installed") } : null,
  ].filter((token) => token !== null);
}
