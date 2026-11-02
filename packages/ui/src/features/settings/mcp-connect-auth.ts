/**
 * The words the connect dialog shows for a flow. The flows themselves, and the configuration each
 * connects with, are the contract in `@openbot/contracts/mcp-connect-flows`.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import {
  isListingUrl,
  type McpAuthValues,
  type McpConnectFlow,
  mcpFlowFields,
} from "@openbot/contracts/mcp-connect-flows";
import type { AppTranslate } from "@openbot/i18n";

/**
 * What is wrong with a typed link, in the words the dialog shows, or null.
 *
 * The host is held to the listing's so that a plugin row stays recognizable as the plugin's:
 * `isPluginAppConfig` matches a user's link by host, not by the exact address.
 */
export function mcpFlowError(
  config: McpServerConfig,
  flow: McpConnectFlow | null | undefined,
  values: McpAuthValues,
  t: AppTranslate,
): string | null {
  for (const field of mcpFlowFields(flow)) {
    const value = (values[field.id] ?? "").trim();
    if (field.url && value && !isListingUrl(value, config.url)) {
      return t("mcp.connect.httpsLinkRequired", { hostname: new URL(config.url).hostname });
    }
  }
  return null;
}
