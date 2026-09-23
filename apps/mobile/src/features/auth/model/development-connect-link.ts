import {
  isMobileConnectDevelopmentHost,
  type MobileConnectHostBinding,
  parseMobileConnectUrl,
} from "@openbot/contracts/mobile-connect";

// `bun run dev:mobile` pairs a simulator, which has no camera, by opening the
// Mobile Connect QR link with `simctl openurl`. Any app or web page on a device
// can open the same scheme, and a redeemed ticket becomes a session that never
// expires, so only a development build accepts the link, and only when it names
// a loopback or private-network account service.

type Listener = () => void;

let pendingLink: string | null = null;
const listeners = new Set<Listener>();

function isMobileConnectLink(value: string): boolean {
  return /^openbot:\/\/mobile-connect(?:[/?#]|$)/iu.test(value.trim());
}

export function readDevelopmentConnectLink(value: string, development: boolean): string | null {
  if (!development || !isMobileConnectLink(value)) return null;
  const link = value.trim();
  const payload = parseMobileConnectUrl(link);
  if (!payload?.host) return null;
  const api = new URL(payload.apiUrl);
  return api.protocol === "http:" && isMobileConnectDevelopmentHost(api.hostname) ? link : null;
}

// Returns true when the link is a Mobile Connect link, accepted or not, so the
// router never tries to open it as a screen.
export function receiveMobileConnectLink(value: string, development: boolean): boolean {
  if (!isMobileConnectLink(value)) return false;
  const link = readDevelopmentConnectLink(value, development);
  if (link) {
    pendingLink = link;
    for (const listener of listeners) listener();
  }
  return true;
}

export function peekMobileConnectLink(): string | null {
  return pendingLink;
}

export function takeMobileConnectLink(): string | null {
  const link = pendingLink;
  pendingLink = null;
  return link;
}

export function subscribeMobileConnectLink(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSameMobileConnectTarget(
  session: { apiUrl: string; host: MobileConnectHostBinding },
  link: string,
): boolean {
  const payload = parseMobileConnectUrl(link);
  return payload?.apiUrl === session.apiUrl && payload.host?.hostId === session.host.hostId;
}
