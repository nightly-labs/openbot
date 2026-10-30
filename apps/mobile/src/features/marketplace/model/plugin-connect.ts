import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isListingUrl, type McpAuthValues, mcpFlowFields } from "@openbot/contracts/mcp-connect-flows";
import type {
  MobilePlugin,
  MobilePluginApp,
  MobilePluginAuthField,
  MobilePluginAuthFlow,
} from "./plugin-catalog.generated";

/*
 * How the phone connects a plugin app. The configuration a flow connects with comes from the shared
 * contract (`@openbot/contracts/mcp-connect-flows`), so the phone saves what the desktop and web save.
 */

/**
 * How the phone connects an app, or why it cannot. The phone is always a remote client, so it follows
 * the joined-host rules of the desktop: a local server answers only on the computer that runs it, and
 * a browser sign-in needs a host that relays its sign-ins (`sign-in-relay-v1`).
 */
export type PluginConnectMethod =
  | { kind: "none" }
  | { kind: "key"; flow: Extract<MobilePluginAuthFlow, { kind: "key" }> }
  | { kind: "link"; flow: Extract<MobilePluginAuthFlow, { kind: "link" }> }
  | { kind: "local" }
  | { kind: "relayUnsupported" };

/** The flow the connect step opens on is the first the listing declares, as on the desktop. */
export function pluginConnectMethod(app: MobilePluginApp, canRelaySignIn: boolean): PluginConnectMethod {
  const flow = app.server.auth?.[0];
  if (!flow) return { kind: "none" };
  if (flow.kind === "local") return { kind: "local" };
  if (flow.kind === "link") return canRelaySignIn ? { kind: "link", flow } : { kind: "relayUnsupported" };
  return { kind: "key", flow };
}

/**
 * The configuration an app installs as. The id is empty, which the host's store reads as "new". A
 * credential is never part of it: the user types it, and `applyMcpFlow` adds it.
 */
export function pluginAppConfig(app: MobilePluginApp): McpServerConfig {
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

/** The first typed link that leaves the listing's host, or null. The desktop dialog shows the same check. */
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

/**
 * Whether a row the host holds is the one this app installs. The name and the address (or the command
 * and its words) are compared, not the headers: the saved row carries the credential the user typed.
 */
function isPluginAppConfig(config: McpServerConfig, app: MobilePluginApp): boolean {
  const server = app.server;
  if (config.name !== server.name || config.transport !== server.transport) return false;
  if (server.transport === "http") {
    // A listing that asks for the user's own link cannot know the address, only its host.
    const userLink = (server.auth ?? []).some((flow) => flow.kind === "key" && flow.fields.some((field) => field.url));
    return userLink ? isListingUrl(config.url, server.url) : config.url === server.url;
  }
  return (
    config.command === server.command &&
    config.args.length === server.args.length &&
    config.args.every((arg, index) => arg === server.args[index])
  );
}

/** The id of the host's row that this plugin's app installed as, for its own MCP page, or null. */
export function pluginServerId(plugin: MobilePlugin, servers: readonly McpServerConfig[]): string | null {
  const app = plugin.apps[0];
  return (app && servers.find((config) => isPluginAppConfig(config, app))?.id) || null;
}

/** Every app of the plugin is a server on the host. */
export function pluginInstalled(plugin: MobilePlugin, servers: readonly McpServerConfig[]): boolean {
  return plugin.apps.every((app) => servers.some((config) => isPluginAppConfig(config, app)));
}
