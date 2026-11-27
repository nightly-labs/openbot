import type { MacAutomationTarget, McpServerConfig, McpTransport, SkillCategory } from "@openbot/contracts/ipc";
import { mcpAccountFragment, withoutMcpAccountFragment } from "@openbot/contracts/mcp-accounts";
import { isListingUrl, type McpAuth, mcpFlowFields } from "@openbot/contracts/mcp-connect-flows";

export interface MarketplacePluginPrompt {
  id: string;
  text: string;
}

export type MarketplacePluginServer = MarketplacePluginServerBase &
  (
    | {
        transport: Extract<McpTransport, "http">;
        url: string;
        earlierUrls?: readonly string[];
      }
    | {
        transport: Extract<McpTransport, "stdio">;
        command: string;
        args: string[];
        env?: Readonly<Record<string, string>>;
      }
  );

interface MarketplacePluginServerBase {
  name: string;
  auth?: McpAuth | null;
}

export function isPluginAppConfig(config: McpServerConfig, app: MarketplacePluginApp): boolean {
  const server = app.server;
  if (config.transport !== server.transport) return false;
  if (server.transport === "http") {
    if (mcpAccountFragment(config.url) === null && config.name !== server.name) return false;
    const url = withoutMcpAccountFragment(config.url);
    if (url === server.url) return true;
    const userLink = (server.auth ?? []).some((flow) => mcpFlowFields(flow).some((field) => field.url));
    if (userLink && isListingUrl(url, server.url)) return true;
    return (server.earlierUrls ?? []).some((earlier) => isListingUrl(url, earlier));
  }
  if (config.name !== server.name) return false;
  return (
    config.command === server.command &&
    config.args.length === server.args.length &&
    config.args.every((arg, index) => arg === server.args[index])
  );
}

export function currentPluginAppConfig(config: McpServerConfig, app: MarketplacePluginApp): McpServerConfig {
  const server = app.server;
  if (server.transport === "stdio" && config.transport === "stdio") {
    const added = Object.entries(server.env ?? {})
      .filter(([key]) => !config.env.some((held) => held.key === key))
      .map(([key, value]) => ({ key, value }));
    return added.length > 0 ? { ...config, env: [...config.env, ...added] } : config;
  }
  if (server.transport !== "http" || config.transport !== "http") return config;
  const url = withoutMcpAccountFragment(config.url);
  if (url === server.url || isListingUrl(url, server.url)) return config;
  if (!(server.earlierUrls ?? []).some((earlier) => isListingUrl(url, earlier))) return config;
  return { ...config, url: `${server.url}${mcpAccountFragment(config.url) ?? ""}`, headers: [] };
}

export interface MarketplacePluginApp {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  server: MarketplacePluginServer;
  macAutomation?: readonly MacAutomationTarget[];
}

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
  tagline: string;
  description: string;
  category: SkillCategory;
  creatorName: string;
  creatorAvatarUrl?: string | null;
  iconUrl: string | null;
  version: string;
  installs: number;
  featured: boolean;
  updatedAt: string;
}

export interface MarketplacePluginDetail extends MarketplacePluginSummary {
  shareUrl: string;
  prompts: MarketplacePluginPrompt[];
  apps: MarketplacePluginApp[];
  skills: MarketplacePluginSkill[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
}
