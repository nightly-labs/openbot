/**
 * What a marketplace plugin looks like to the renderer, while the listing is still being designed.
 *
 * A plugin is one developer's bundle: the MCP server it publishes, shown as an **app**, the skills
 * that drive that server, and the listing text. Nothing here has a wire protocol yet - there is no
 * `skills:*` or `marketplace-agents:*` equivalent to answer these, so the types stay in the renderer
 * rather than in `@openbot/contracts/ipc`, where a shape can only be added once it is the shape the
 * main process really sends. `SkillCategory` is the one borrowed type: a plugin is filed under the
 * same categories the rest of the marketplace already offers.
 */

import type { McpTransport, SkillCategory } from "@openbot/contracts/ipc";

/**
 * Where a shared plugin link points. Derived from the slug rather than carried as catalog data, so
 * a listing can never put a foreign address behind the button that says it copies its own link.
 */
export function createPluginShareUrl(slug: string): string {
  return `https://openbot.run/plugins/${slug}`;
}

/** One of the example questions a plugin listing opens with. */
export interface MarketplacePluginPrompt {
  id: string;
  text: string;
}

/**
 * The server an app installs as: the name the record takes and the address it answers on. It is the
 * shape of the MCP server, never a stored configuration - no id, no credential. A listing that
 * needed a key would declare which key, and the user would type it, so nothing secret is catalog
 * data.
 */
export interface MarketplacePluginServer {
  /** The name the MCP record takes on this computer, and what an installed check matches on. */
  name: string;
  transport: McpTransport;
  url: string;
}

/** An MCP server the plugin publishes. The listing calls it an app, because that is what it is to the user. */
export interface MarketplacePluginApp {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  server: MarketplacePluginServer;
}

/**
 * A skill the plugin installs alongside its app. `id` is the marketplace skill, and `versionId` is
 * the published version the listing pins: a plugin is written against one version of its own
 * instructions, so an install takes that version and not whatever is newest today.
 */
export interface MarketplacePluginSkill {
  id: string;
  versionId: string;
  slug: string;
  description: string;
}

export interface MarketplacePluginSummary {
  id: string;
  slug: string;
  name: string;
  /** The one line under the name. The listing shows this; `description` is the paragraph inside. */
  tagline: string;
  description: string;
  category: SkillCategory;
  creatorName: string;
  creatorAvatarUrl?: string | null;
  iconUrl: string | null;
  /**
   * A semantic version string, not the integer skills and agents count up. A plugin's version is the
   * one its MCP server publishes, and the listing prints it as the developer wrote it.
   */
  version: string;
  installs: number;
  featured: boolean;
  updatedAt: string;
}

export interface MarketplacePluginDetail extends MarketplacePluginSummary {
  /** The listing address "Copy link" writes out, not the developer's own site. */
  shareUrl: string;
  prompts: MarketplacePluginPrompt[];
  apps: MarketplacePluginApp[];
  skills: MarketplacePluginSkill[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
}
