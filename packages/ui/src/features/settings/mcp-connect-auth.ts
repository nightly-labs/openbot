import type { McpServerConfig } from "@openbot/contracts/ipc";
import {
  isListingUrl,
  type McpAuthValues,
  type McpConnectFlow,
  mcpFlowFields,
} from "@openbot/contracts/mcp-connect-flows";
import type { AppTranslate } from "@openbot/i18n";

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
