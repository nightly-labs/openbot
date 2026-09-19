/**
 * What a marketplace plugin looks like, to every side that reads one.
 *
 * A plugin is one developer's bundle: the MCP server it publishes, shown as an **app**, the skills
 * that drive that server, and the listing text. These shapes live here because the catalog now
 * crosses an application boundary - the desktop renderer draws the Plugins tab from it, and the
 * openbot.run Worker draws `/plugins` and `/plugins/<slug>` from the same entries. A listing that
 * said one thing in the app and another on the page would be two catalogs.
 *
 * The listing *data* is in `./plugin-catalog`, deliberately not here: these are shapes, and the
 * entries are content. Keeping them apart means the static-catalog work in
 * `docs/plugin-distribution.md` replaces one module and leaves every type and every importer alone.
 *
 * The behaviour that reads these shapes is not here either. Building an `McpServerConfig` from an
 * app, and the connect dialog's form state, stay in `src/renderer/src/features/settings/`, which
 * re-exports these types.
 */

import type { McpTransport } from "./ipc-mcp-servers";
import type { SkillCategory } from "./ipc-skills";

/** One credential the user pastes. */
export interface McpAuthField {
  id: string;
  /** What the input is called on screen, as the server's own documentation calls it. */
  label: string;
  /** The http header the value is sent in. */
  header?: string;
  /** The environment variable the value is set as, for a stdio server. */
  env?: string;
  /**
   * Written in front of the typed value, so the user pastes the token the server gave them and not
   * the scheme word in front of it. `"Bearer "` is the usual one; the space is part of the string.
   */
  prefix?: string;
  placeholder?: string;
  /** Where this value is found, in the user's own account. */
  hint?: string;
}

interface McpConnectFlowBase {
  id: string;
  /** What this way in is called where the ways are listed side by side. */
  label: string;
}

/** Sign-in in the browser. The exchange happens in the main process; no secret reaches this side. */
export interface McpLinkFlow extends McpConnectFlowBase {
  kind: "link";
}

/** A credential the user pastes, or two. */
export interface McpKeyFlow extends McpConnectFlowBase {
  kind: "key";
  fields: McpAuthField[];
  /** The page the key is created on. Opened externally; never fetched here. */
  docsUrl?: string | null;
  docsLabel?: string;
}

export type McpConnectFlow = McpLinkFlow | McpKeyFlow;

/** Every way into one server. The first is the one the dialog opens on. Empty is a server that
 *  asks for nothing, which still connects: a server that is down is found before an agent has it. */
export type McpAuth = McpConnectFlow[];

/** One of the example questions a plugin listing opens with. */
export interface MarketplacePluginPrompt {
  id: string;
  text: string;
}

/**
 * The server an app installs as: the name the record takes and the address it answers on. It is the
 * shape of the MCP server, never a stored configuration - no id, no credential. A listing that
 * needed a key declares which key, and the user types it, so nothing secret is catalog data.
 */
export interface MarketplacePluginServer {
  /** The name the MCP record takes on this computer, and what an installed check matches on. */
  name: string;
  transport: McpTransport;
  /** The address an http server answers on. Empty for an app that runs a command. */
  url: string;
  /**
   * The command a stdio app launches, and the words it is launched with. An app runs a command when
   * its server is not reachable over http alone - a bridge that signs in for the user, or a server
   * that is published as a package. Both are ignored for an http app, as `normalizeMcpConfig` clears
   * them there.
   */
  command?: string;
  args?: string[];
  /**
   * How the user proves who they are, when the server asks: a sign-in, a key, or both. The
   * declaration names the way in and where a key goes; the value is only ever typed by the user or
   * granted in the browser, so nothing secret is catalog data.
   */
  auth?: McpAuth | null;
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
