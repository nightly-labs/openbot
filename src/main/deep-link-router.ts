import { parseAgentTemplateUrl } from "@openbot/contracts/agent-template-links";
import { type InviteLinkOptions, parseInviteUrl } from "@openbot/contracts/invite-links";
import { type MarketplaceListingLink, parseMarketplaceUrl } from "@openbot/contracts/marketplace-links";
import { parsePluginUrl } from "@openbot/contracts/plugin-links";

export type DeepLink =
  | { kind: "invite"; url: string }
  | { kind: "plugin"; slug: string }
  | { kind: "agent-template"; id: string }
  | { kind: "marketplace"; link: MarketplaceListingLink }
  | { kind: "mcp-auth"; state: string; code: string }
  | { kind: "slack-workspace"; nonce: string; grant: string }
  | { kind: "discord-guild"; nonce: string; grant: string }
  | { kind: "near-signature"; nonce: string; data: string };

export const MCP_OAUTH_REDIRECT_URL = "openbot://mcp-auth";

const MCP_OAUTH_HOST = "mcp-auth";
const SLACK_WORKSPACE_HOST = "slack-workspace";
const NEAR_SIGNATURE_HOST = "near-signature";
const DISCORD_GUILD_HOST = "discord-guild";

export function parseDeepLink(value: string, options: InviteLinkOptions = {}): DeepLink | null {
  try {
    parseInviteUrl(value, options);
    return { kind: "invite", url: value };
  } catch {}

  try {
    return { kind: "plugin", slug: parsePluginUrl(value) };
  } catch {}

  try {
    return { kind: "agent-template", id: parseAgentTemplateUrl(value) };
  } catch {}

  try {
    return { kind: "marketplace", link: parseMarketplaceUrl(value) };
  } catch {}

  return parseMcpAuthUrl(value) ?? parseSlackUrl(value);
}

function parseSlackUrl(value: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "openbot:") return null;
  if (url.hostname === SLACK_WORKSPACE_HOST) {
    const nonce = url.searchParams.get("nonce");
    const grant = url.searchParams.get("grant");
    return nonce && grant ? { kind: "slack-workspace", nonce, grant } : null;
  }
  if (url.hostname === DISCORD_GUILD_HOST) {
    const nonce = url.searchParams.get("nonce");
    const grant = url.searchParams.get("grant");
    return nonce && grant ? { kind: "discord-guild", nonce, grant } : null;
  }
  if (url.hostname === NEAR_SIGNATURE_HOST) {
    const nonce = url.searchParams.get("nonce");
    const data = url.searchParams.get("data");
    return nonce && data ? { kind: "near-signature", nonce, data } : null;
  }
  return null;
}

function parseMcpAuthUrl(value: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "openbot:" || url.hostname !== MCP_OAUTH_HOST) return null;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return null;
  return { kind: "mcp-auth", state, code };
}

export function findDeepLink(values: string[], options: InviteLinkOptions = {}): DeepLink | null {
  for (const value of values) {
    const link = parseDeepLink(value, options);
    if (link) return link;
  }
  return null;
}
