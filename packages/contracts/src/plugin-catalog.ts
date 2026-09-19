/**
 * The plugins the marketplace offers today.
 *
 * `docs/plugin-distribution.md` describes where this list will come from: a static catalog on
 * openbot.run, fetched and cached by the main process. None of that exists yet, so the catalog is
 * a literal here - written from what the published servers really answer, not from what a layout
 * needs. A literal keeps both readers honest: everything the Plugins tab shows installs, everything
 * the `/plugins` pages describe is the thing that installs, and the fetch, the cache and the IPC
 * channels arrive without changing either.
 *
 * This is content, and it sits apart from the shapes in `./ipc-plugin-catalog` for that reason. The
 * static-catalog work replaces this one module and leaves every type alone.
 */

import type { MarketplacePluginDetail } from "./ipc-plugin-catalog";
import { createPluginShareUrl } from "./plugin-links";

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
  iconUrl: "https://static.canva.com/static/images/apple-touch-icon-180x180.png",
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
      iconUrl: "https://static.canva.com/static/images/apple-touch-icon-180x180.png",
      server: {
        name: "canva",
        transport: "stdio",
        url: "",
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

/** One listing by slug, for a route that was given one. */
export function findMarketplacePlugin(slug: string): MarketplacePluginDetail | null {
  return MARKETPLACE_PLUGINS.find((plugin) => plugin.slug === slug) ?? null;
}
