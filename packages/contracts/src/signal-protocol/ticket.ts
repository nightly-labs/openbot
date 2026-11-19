import { isDynamicRecord, isString } from "../runtime-values";

export const REMOTE_TICKET_AUDIENCE = "openbot-remote";

export const REMOTE_TICKET_PROTOCOL_VERSION = 2;

export type RemoteRole = "host" | "owner" | "admin" | "member";

export type RemoteMemberRole = Exclude<RemoteRole, "host">;

export interface RemoteTicketClaims {
  aud: typeof REMOTE_TICKET_AUDIENCE;
  jti: string;
  sessionId: string;
  hostId: string;
  userId: string;
  membershipId: string;
  role: RemoteRole;
  authEpoch: number;
  protocolMinimum: number;
  protocolMaximum: number;
  sessionExpiresAt: number;
  clientPublicKey?: string;
  signal?: string;
  iat: number;
  exp: number;
}

export function ticketNamesSignalHome(ticket: string): boolean {
  return ticketSignalHome(ticket) !== null;
}

export function ticketSignalHome(ticket: string): string | null {
  const payload = ticket.split(".")[1];
  if (!payload) return null;
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const claims = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)));
    return isDynamicRecord(claims) && isString(claims.signal) ? claims.signal : null;
  } catch {
    return null;
  }
}
