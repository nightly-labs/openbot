import {
  isMobileConnectDevelopmentHost,
  type MobileConnectHostBinding,
  parseMobileConnectUrl,
} from "@openbot/contracts/mobile-connect";

type Listener = () => void;

let pendingLink: string | null = null;
const listeners = new Set<Listener>();

function isMobileConnectLink(value: string): boolean {
  return /^openbot:\/\/mobile-connect(?:[/?#]|$)/iu.test(value.trim());
}

function readDevelopmentConnectLink(value: string, development: boolean): string | null {
  if (!development || !isMobileConnectLink(value)) return null;
  const link = value.trim();
  const payload = parseMobileConnectUrl(link);
  if (!payload?.host) return null;
  const api = new URL(payload.apiUrl);
  return api.protocol === "http:" && isMobileConnectDevelopmentHost(api.hostname) ? link : null;
}

export function acceptDevelopmentConnectLink(value: string, development: boolean): boolean {
  const link = readDevelopmentConnectLink(value, development);
  if (!link) return false;
  pendingLink = link;
  for (const listener of listeners) listener();
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
  session: { apiUrl: string; host?: MobileConnectHostBinding },
  link: string,
): boolean {
  const payload = parseMobileConnectUrl(link);
  return payload?.apiUrl === session.apiUrl && payload.host?.hostId === session.host?.hostId;
}
