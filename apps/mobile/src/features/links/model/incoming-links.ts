import {
  createAgentTemplateShareUrl,
  OPENBOT_AGENT_TEMPLATE_PATH_PREFIX,
  parseAgentTemplateUrl,
} from "@openbot/contracts/agent-template-links";
import { parseInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import { parseMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { createPluginShareUrl, parsePluginUrl } from "@openbot/contracts/plugin-links";

export type IncomingLink =
  | { kind: "invite"; url: string }
  | { kind: "pairing"; url: string }
  | { kind: "plugin"; url: string }
  | { kind: "template"; url: string; templateId: string }
  | { kind: "invalid" };

function parseIncomingLink(value: string): IncomingLink {
  if (isInviteLink(value)) return { kind: "invite", url: value };
  try {
    const templateId = parseAgentTemplateUrl(value);
    return { kind: "template", url: createAgentTemplateShareUrl(templateId), templateId };
  } catch {}
  try {
    const url = new URL(value);
    const pairing = parseMobileConnectUrl(value);
    if (pairing && url.username === "" && url.password === "" && url.port === "") {
      return { kind: "pairing", url: value };
    }
    return { kind: "plugin", url: createPluginShareUrl(parsePluginUrl(value)) };
  } catch {
    return { kind: "invalid" };
  }
}

function isInviteLink(value: string): boolean {
  try {
    parseInviteUrl(value);
    return true;
  } catch {}
  try {
    const url = new URL(value);
    if (url.protocol !== "openbot:") return false;
    parseInviteUrl(value, { selfHostedApiOrigin: selfHostedApiOrigin(url.searchParams.get("api") ?? undefined) });
    return true;
  } catch {
    return false;
  }
}

const requests = new Map<string, IncomingLink>();
let sequence = 0;
export function rememberIncomingLink(link: IncomingLink): string {
  if (link.kind !== "invalid") {
    for (const [id, pending] of requests) {
      if (pending.kind === link.kind && pending.url === link.url) return id;
    }
  }
  const id = String(++sequence);
  requests.set(id, link);
  if (requests.size > 8) {
    const oldest = requests.keys().next().value;
    if (oldest) requests.delete(oldest);
  }
  return id;
}

export function readIncomingLink(id: string | undefined): IncomingLink {
  return (id && requests.get(id)) || { kind: "invalid" };
}

export function forgetIncomingLink(id: string | undefined): void {
  if (id) requests.delete(id);
}

export function pendingSignInLinkId(): string | undefined {
  return [...requests].reverse().find(([, link]) => link.kind === "invite" || link.kind === "template")?.[0];
}

export function redirectIncomingLink(path: string, initial: boolean): string | null {
  if (path === "openbot://" || path === "openbot:///" || path === "openbot:") return initial ? "/" : null;
  if (/^exps?:\/\//u.test(path)) return path;
  if (path.startsWith("/") && !path.startsWith("//")) {
    const url = new URL(path, "https://openbot.run");
    if (
      url.pathname !== "/join" &&
      !url.pathname.startsWith("/plugins/") &&
      !url.pathname.startsWith(OPENBOT_AGENT_TEMPLATE_PATH_PREFIX)
    )
      return path;
    path = url.toString();
  }
  return `/incoming-link?request=${rememberIncomingLink(parseIncomingLink(path))}`;
}
