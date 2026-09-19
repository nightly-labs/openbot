/**
 * The plugins the marketplace offers today.
 *
 * `docs/plugin-distribution.md` describes where this list will come from: a static catalog on
 * openbot.run, fetched and cached by the main process. None of that exists yet, so the catalog is
 * a literal here - one listing, written from what the published server really answers, not from
 * what a layout needs. A literal keeps the Plugins tab honest: everything it shows installs, and
 * the fetch, the cache and the IPC channels arrive without changing what the tab renders.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { MarketplacePluginApp, MarketplacePluginDetail } from "./marketplace-plugins";
import { createPluginShareUrl } from "./marketplace-plugins";

/**
 * The configuration an app installs as. The catalog states the name and how the server is reached -
 * an address, or a command and its words; the rest of the record and `enabled` are made here rather
 * than stored as catalog data that could disagree with `normalizeMcpConfig`.
 *
 * A credential is never among them. What a server asks for is declared in `server.auth`, and the
 * value is typed by the user in the connect dialog, which hands back the configuration that
 * connected.
 *
 * The id is empty, which is what the store reads as "new". An id it does not hold is an edit of a
 * row that is gone, and the save is refused.
 */
export function createPluginAppConfig(app: MarketplacePluginApp): McpServerConfig {
  return {
    id: "",
    name: app.server.name,
    transport: app.server.transport,
    enabled: true,
    command: app.server.transport === "stdio" ? app.server.command : "",
    args: app.server.transport === "stdio" ? [...app.server.args] : [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.transport === "http" ? app.server.url : "",
    headers: [],
  };
}

/**
 * Aave, over the server the developer publishes at `mcp.aave.com`. It needs no credential, so the
 * whole listing installs with one save: the tools read live V3 and V4 markets and return every
 * state change unsigned, which is why an install can enable it without asking for a key first.
 */
const AAVE: MarketplacePluginDetail = {
  id: "plugin-aave",
  slug: "aave",
  name: "Aave",
  tagline: "Aave data and transactions",
  description:
    "Aave helps users explore live Aave V3 and V4 markets, review wallet positions and DAO governance, " +
    "simulate lending actions, and prepare non-custodial transactions. Every transaction is returned " +
    "unsigned: the plugin reads the markets and writes the call, and the wallet stays with the user.",
  category: "data-analytics",
  creatorName: "avara.xyz",
  creatorAvatarUrl: null,
  iconUrl: "https://aave.com/images/icon-aave.png",
  version: "1.0.0",
  installs: 0,
  featured: true,
  updatedAt: "2026-09-18T00:00:00.000Z",
  shareUrl: createPluginShareUrl("aave"),
  prompts: [
    { id: "prompt-stablecoin-yield", text: "Where can I earn the most on stablecoins across Aave right now?" },
    { id: "prompt-usdc-rates", text: "Which pays more for USDC right now, Aave V3 or V4 on Ethereum?" },
    {
      id: "prompt-health-factor",
      text: "What's the health factor of 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, and how far from liquidation?",
    },
  ],
  apps: [
    {
      id: "app-aave-mcp",
      name: "Aave",
      description:
        "Live V3 and V4 markets, wallet positions, DAO governance, and prepared transactions, over one MCP server.",
      iconUrl: "https://aave.com/images/icon-aave.png",
      server: { name: "aave", transport: "http", url: "https://mcp.aave.com/mcp" },
    },
  ],
  /* The developer's skills are not in the skills marketplace, and a skill installs by published
     version. Listing them here would offer an install that cannot finish. */
  skills: [],
  websiteUrl: "https://aave.com",
  privacyPolicyUrl: "https://aave.com/privacy",
  termsUrl: "https://aave.com/terms",
};

/**
 * Canva, over the remote server the developer publishes at `mcp.canva.com`. Every user signs in for
 * themselves: Canva holds designs, assets and permissions per account, so the tools an agent gets
 * are the ones the signed-in account can reach.
 *
 * It installs as a command rather than as an address, and the command is the reason: the server
 * answers 401 until a request carries a bearer token, and OpenBot's main process has no OAuth client
 * of its own yet. `mcp-remote` is the bridge that has one - it registers, opens the browser, holds
 * the token beside itself in `~/.mcp-auth`, and speaks plain MCP to OpenBot over stdio. The day the
 * main process signs in for itself, this listing becomes the http address above and the flow below
 * stays as it reads.
 *
 * The first connect is the slow one: `npx` fetches the bridge, and the browser waits for the user.
 * That is longer than a connect attempt waits, so the first attempt can report a timeout while the
 * sign-in is still open; the attempt after it connects with the token the bridge kept.
 */
const CANVA: MarketplacePluginDetail = {
  id: "plugin-canva",
  slug: "canva",
  name: "Canva",
  tagline: "Designs, assets and exports",
  description:
    "Canva lets users create and edit designs in words, search their own design library, upload and " +
    "organize assets, export in the format a channel needs, and leave comments where the work is. " +
    "Each user signs in to their own Canva account, and the agent can do what that account can do.",
  category: "design",
  creatorName: "canva.com",
  creatorAvatarUrl: null,
  iconUrl: "https://static.canva.com/static/images/favicon.ico",
  version: "1.0.0",
  installs: 0,
  featured: true,
  updatedAt: "2026-09-18T00:00:00.000Z",
  shareUrl: createPluginShareUrl("canva"),
  prompts: [
    { id: "prompt-recent-design", text: "Show me my most recently edited Canva design." },
    { id: "prompt-social-resize", text: "Resize my launch poster for Instagram and export both as PNG." },
    { id: "prompt-deck-from-notes", text: "Turn these release notes into a six-slide Canva presentation." },
  ],
  apps: [
    {
      id: "app-canva-mcp",
      name: "Canva",
      description:
        "Design creation and editing, library search, asset and brand management, exports, and comments, over one MCP server.",
      iconUrl: "https://static.canva.com/static/images/favicon.ico",
      server: {
        name: "canva",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-remote@latest", "https://mcp.canva.com/mcp"],
        auth: [{ id: "canva-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  /* As with Aave: the developer's skills are not in the skills marketplace, and a skill installs by
     published version, so listing one here would offer an install that cannot finish. */
  skills: [],
  websiteUrl: "https://www.canva.com",
  privacyPolicyUrl: "https://www.canva.com/policies/privacy-policy/",
  termsUrl: "https://www.canva.com/policies/terms-of-use/",
};

export const MARKETPLACE_PLUGINS: MarketplacePluginDetail[] = [AAVE, CANVA];
