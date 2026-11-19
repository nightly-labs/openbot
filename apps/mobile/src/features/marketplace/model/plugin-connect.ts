import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isListingUrl, type McpAuthValues, mcpFlowFields } from "@openbot/contracts/mcp-connect-flows";
import type {
  MobilePlugin,
  MobilePluginApp,
  MobilePluginAuthField,
  MobilePluginAuthFlow,
} from "./plugin-catalog.generated";

export type PluginConnectMethod =
  | { kind: "none" }
  | { kind: "key"; flow: Extract<MobilePluginAuthFlow, { kind: "key" }> }
  | { kind: "link"; flow: Extract<MobilePluginAuthFlow, { kind: "link" }> }
  | { kind: "local" }
  | { kind: "relayUnsupported" };

export function pluginConnectMethod(app: MobilePluginApp, canRelaySignIn: boolean): PluginConnectMethod {
  const flows = app.server.auth ?? [];
  const flow = flows[0];
  if (!flow) return { kind: "none" };
  if (flow.kind === "local") return { kind: "local" };
  if (flow.kind === "link") {
    if (canRelaySignIn) return { kind: "link", flow };
    const key = flows.find((other): other is Extract<MobilePluginAuthFlow, { kind: "key" }> => other.kind === "key");
    return key ? { kind: "key", flow: key } : { kind: "relayUnsupported" };
  }
  return { kind: "key", flow };
}

export function pluginAppConfig(app: MobilePluginApp): McpServerConfig {
  return {
    id: "",
    name: app.server.name,
    transport: app.server.transport,
    enabled: true,
    command: app.server.transport === "stdio" ? app.server.command : "",
    args: app.server.transport === "stdio" ? [...app.server.args] : [],
    env:
      app.server.transport === "stdio"
        ? Object.entries(app.server.env ?? {}).map(([key, value]) => ({ key, value }))
        : [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.transport === "http" ? app.server.url : "",
    headers: [],
  };
}

export function pluginKeyLinkError(
  config: McpServerConfig,
  flow: MobilePluginAuthFlow,
  values: McpAuthValues,
): MobilePluginAuthField | null {
  for (const field of mcpFlowFields(flow)) {
    const value = (values[field.id] ?? "").trim();
    if (field.url && value && !isListingUrl(value, config.url)) return field;
  }
  return null;
}

function isPluginAppConfig(config: McpServerConfig, app: MobilePluginApp): boolean {
  const server = app.server;
  if (config.name !== server.name || config.transport !== server.transport) return false;
  if (server.transport === "http") {
    if (config.url === server.url) return true;
    const userLink = (server.auth ?? []).some((flow) => flow.kind === "key" && flow.fields.some((field) => field.url));
    if (userLink && isListingUrl(config.url, server.url)) return true;
    return (server.earlierUrls ?? []).some((earlier) => isListingUrl(config.url, earlier));
  }
  return (
    config.command === server.command &&
    config.args.length === server.args.length &&
    config.args.every((arg, index) => arg === server.args[index])
  );
}

export function pluginServerId(plugin: MobilePlugin, servers: readonly McpServerConfig[]): string | null {
  const app = plugin.apps[0];
  return (app && servers.find((config) => isPluginAppConfig(config, app))?.id) || null;
}

export function claimedByPlugin(config: McpServerConfig, plugin: MobilePlugin): boolean {
  return plugin.apps.some((app) => isPluginAppConfig(config, app));
}

export function pluginInstalled(plugin: MobilePlugin, servers: readonly McpServerConfig[]): boolean {
  return plugin.apps.every((app) => servers.some((config) => isPluginAppConfig(config, app)));
}
