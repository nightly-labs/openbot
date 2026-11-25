import { decodeRecord } from "./ipc-decoding";
import { isMobileConnectDevelopmentHost } from "./mobile-connect";
import { isNumber, isString } from "./runtime-values";

export interface RemoteSession {
  sessionId: string;
  hostId: string;
  expiresAt: number;
}

export interface RemoteSessionTicket {
  ticket: string;
  expiresAt: number;
  signalUrl: string;
}

export function decodeRemoteSession(value: unknown): RemoteSession {
  const record = decodeRecord(value, "remote session");
  return {
    sessionId: text(record.sessionId, "sessionId"),
    hostId: text(record.hostId, "hostId"),
    expiresAt: timestamp(record.expiresAt, "remote session expiration"),
  };
}

export function decodeRemoteSessionTicket(value: unknown): RemoteSessionTicket {
  const record = decodeRecord(value, "remote connection bootstrap");
  const signalUrl = text(record.signalUrl, "signalUrl");
  const signal = new URL(signalUrl);
  if (signal.protocol !== "wss:" && !(signal.protocol === "ws:" && isMobileConnectDevelopmentHost(signal.hostname))) {
    throw new Error("Invalid Remote Signal URL.");
  }
  return {
    ticket: text(record.ticket, "ticket"),
    expiresAt: timestamp(record.expiresAt, "remote ticket expiration"),
    signalUrl,
  };
}

function text(value: unknown, field: string): string {
  if (!isString(value)) throw new Error(`Invalid ${field}.`);
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (!isNumber(value) || !Number.isSafeInteger(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
