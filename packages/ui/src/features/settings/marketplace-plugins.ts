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

import type { McpServerConfig, McpTransport, SkillCategory } from "@openbot/contracts/ipc";
import { isListingUrl, type McpAuth, mcpFlowFields } from "./mcp-connect-auth";

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
 * The server an app installs as: the name the record takes and how it is reached. It is the shape of
 * the MCP server, never a stored configuration - no id, no credential.
 *
 * How it is reached goes with the transport rather than beside it, so a listing cannot state an
 * address for a server that runs a command, or a command for one that answers on an address. Each
 * transport carries exactly the fields `normalizeMcpConfig` keeps for it.
 */
export type MarketplacePluginServer = MarketplacePluginServerBase &
  (
    | { transport: Extract<McpTransport, "http">; url: string }
    | {
        transport: Extract<McpTransport, "stdio">;
        /**
         * The command the app launches, and the words it is launched with. An app runs a command
         * when its server is not reachable over http alone - a bridge that signs in for the user,
         * or a server that is published as a package.
         */
        command: string;
        args: string[];
      }
  );

interface MarketplacePluginServerBase {
  /** The name the MCP record takes on this computer, and what an installed check matches on. */
  name: string;
  /**
   * How the user proves who they are, when the server asks: a sign-in, a key, or both. The
   * declaration names the way in and where a key goes; the value is only ever typed by the user or
   * granted in the browser, so nothing secret is catalog data.
   */
  auth?: McpAuth | null;
}

/**
 * Whether a row the host holds is the one this app installs.
 *
 * The name alone cannot say so. `McpServerStore` keeps names unique, so a server the user wrote by
 * hand can own a catalog name while pointing somewhere else entirely; treating that row as the
 * plugin's would delete the user's own configuration on uninstall and forget the sign-in kept for
 * it. The address - or the command and its words - is compared as well, and nothing else: the
 * connect step adds the credential the user typed to the row that is saved, so headers, environment
 * and enabled state all differ legitimately from what the listing states.
 */
export function isPluginAppConfig(config: McpServerConfig, app: MarketplacePluginApp): boolean {
  const server = app.server;
  if (config.name !== server.name || config.transport !== server.transport) return false;
  if (server.transport === "http") {
    // A listing that asks for the user's own link cannot know the address, only its host.
    const userLink = (server.auth ?? []).some((flow) => mcpFlowFields(flow).some((field) => field.url));
    return userLink ? isListingUrl(config.url, server.url) : config.url === server.url;
  }
  return (
    config.command === server.command &&
    config.args.length === server.args.length &&
    config.args.every((arg, index) => arg === server.args[index])
  );
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
