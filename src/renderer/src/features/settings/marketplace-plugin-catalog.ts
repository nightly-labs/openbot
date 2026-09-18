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
 * The configuration an app installs as. The catalog states the address and the name; the empty
 * stdio fields and `enabled` belong to the record, so they are made here rather than stored as
 * catalog data that could disagree with `normalizeMcpConfig`.
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
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.url,
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

export const MARKETPLACE_PLUGINS: MarketplacePluginDetail[] = [AAVE];
