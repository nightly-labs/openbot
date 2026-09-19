/**
 * What a marketplace plugin looks like to the renderer.
 *
 * The shapes themselves are in `@openbot/contracts/ipc`, because the catalog is read by two
 * applications now: this tab, and the openbot.run Worker that serves `/plugins/<slug>`. A listing
 * that described one thing here and another on the page would be two catalogs, so the description
 * lives in one place and both sides re-export it.
 *
 * What stays on this side is the behaviour that reads those shapes: `createPluginAppConfig` in
 * `marketplace-plugin-catalog.ts`, and the connect dialog's form state in `mcp-connect-auth.ts`.
 * This file is the renderer's view of the contract, in the way that
 * `src/renderer/src/features/servers/mcp-servers.ts` is for MCP servers.
 */

export type {
  MarketplacePluginApp,
  MarketplacePluginDetail,
  MarketplacePluginPrompt,
  MarketplacePluginServer,
  MarketplacePluginSkill,
  MarketplacePluginSummary,
} from "@openbot/contracts/ipc";
export { createPluginShareUrl } from "@openbot/contracts/plugin-links";
