/**
 * How a plugin's app becomes a saved MCP server.
 *
 * The listings themselves are in `@openbot/contracts/plugin-catalog`, which the openbot.run Worker
 * reads to build `/plugins` and `/plugins/<slug>`. They are re-exported here so the tab keeps one
 * import, and so the fetch and the cache described in `docs/plugin-distribution.md` can replace
 * that module without this one changing.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { MarketplacePluginApp } from "./marketplace-plugins";

export { MARKETPLACE_PLUGINS } from "@openbot/contracts/plugin-catalog";

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
 *
 * This stays on this side of the boundary because nothing else builds one yet. It moves into
 * contracts the day the main process installs a plugin itself and would otherwise write a second
 * copy of these rules.
 */
export function createPluginAppConfig(app: MarketplacePluginApp): McpServerConfig {
  return {
    id: "",
    name: app.server.name,
    transport: app.server.transport,
    enabled: true,
    command: app.server.command ?? "",
    args: [...(app.server.args ?? [])],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.url,
    headers: [],
  };
}
