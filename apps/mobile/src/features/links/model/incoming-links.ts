import { parseInviteUrl } from "@openbot/contracts/invite-links";
import { parseMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { createPluginShareUrl, parsePluginUrl } from "@openbot/contracts/plugin-links";

export type IncomingLink =
  | { kind: "invite"; url: string }
  | { kind: "pairing"; url: string }
  | { kind: "plugin"; url: string }
  | { kind: "invalid" };

export function parseIncomingLink(value: string): IncomingLink {
  try {
    parseInviteUrl(value);
    return { kind: "invite", url: value };
  } catch {
    // The other link kinds have separate parsers and cannot weaken invitation validation.
  }
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

// Bearer tokens never enter navigation params, persisted state, or analytics.
// The bounded memory store also keeps an invitation through the QR sign-in flow.
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

export function pendingInvitationId(): string | undefined {
  return [...requests].reverse().find(([, link]) => link.kind === "invite")?.[0];
}

export function redirectIncomingLink(path: string): string {
  if (path === "openbot://" || path === "openbot:///" || path === "openbot:") return "/";
  // Expo Go and ordinary internal routes retain Expo Router's normal behavior.
  if (/^exps?:\/\//u.test(path)) return path;
  if (path.startsWith("/") && !path.startsWith("//")) {
    const url = new URL(path, "https://openbot.run");
    if (url.pathname !== "/join" && !url.pathname.startsWith("/plugins/")) return path;
    path = url.toString();
  }
  return `/incoming-link?request=${rememberIncomingLink(parseIncomingLink(path))}`;
}
