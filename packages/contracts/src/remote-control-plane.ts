// What the account API's `/v2/remote/*` responses mean, for every client that connects through it.
//
// `apps/auth-api` serves them and two independent clients read them: `src/main/central-auth-manager.ts`
// on the desktop and `packages/team-client/src/remote-directory.ts` on mobile. Each carried its own
// copy of these shapes, including the Signal URL scheme check - a security rule that decides whether
// a ticket may be carried over an unencrypted socket, and the one thing two implementations of the
// same response must never disagree about.
//
// Decoding only. The request plumbing stays with each client because it genuinely differs: the
// desktop reads its session token per call, times out at ten seconds and raises an `AuthApiError`
// that carries the API's own error code to the renderer; the shared client holds a fixed bearer
// token and raises a `RemoteDirectoryError`. What they share is what the bytes mean.
//
// Guards rather than zod, like the rest of this package: it is in the graph of a Cloudflare Worker,
// an Expo app and an Electron renderer, and there is no runtime dependency to spend.

import { isMobileConnectDevelopmentHost } from "./mobile-connect";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "./runtime-values";

// The account-scoped session a client opens before it may ask for a ticket. `expiresAt` is
// milliseconds - the ticket's own `sessionExpiresAt` claim is the same instant in seconds.
export interface RemoteSession {
  sessionId: string;
  hostId: string;
  expiresAt: number;
}

// One ticket and where to spend it. The host half of the API answers the same shape from
// `/v2/remote/hosts/:hostId/ticket`, which is why this is not named for the session.
export interface RemoteSessionTicket {
  ticket: string;
  expiresAt: number;
  signalUrl: string;
}

export function decodeRemoteSession(value: unknown): RemoteSession {
  const record = asRecord(value, "remote session");
  return {
    sessionId: text(record.sessionId, "sessionId"),
    hostId: text(record.hostId, "hostId"),
    expiresAt: timestamp(record.expiresAt, "remote session expiration"),
  };
}

export function decodeRemoteSessionTicket(value: unknown): RemoteSessionTicket {
  const record = asRecord(value, "remote connection bootstrap");
  const signalUrl = text(record.signalUrl, "signalUrl");
  const signal = new URL(signalUrl);
  // `ws:` is allowed only against a development host, because the ticket is a bearer credential and
  // this is the last place that can refuse to put it on the wire in the clear.
  if (signal.protocol !== "wss:" && !(signal.protocol === "ws:" && isMobileConnectDevelopmentHost(signal.hostname))) {
    throw new Error("Invalid Remote Signal URL.");
  }
  return {
    ticket: text(record.ticket, "ticket"),
    expiresAt: timestamp(record.expiresAt, "remote ticket expiration"),
    signalUrl,
  };
}

function asRecord(value: unknown, label: string): DynamicRecord {
  if (!isDynamicRecord(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function text(value: unknown, field: string): string {
  if (!isString(value)) throw new Error(`Invalid ${field}.`);
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (!isNumber(value) || !Number.isSafeInteger(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
