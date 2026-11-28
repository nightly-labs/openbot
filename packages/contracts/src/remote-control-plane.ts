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

export const INGRESS_TICKET_ROUTES = ["slack", "discord", "telegram", "webhook"] as const;

export type IngressTicketRoute = (typeof INGRESS_TICKET_ROUTES)[number];

export function parseIngressTicketRoutes(value: unknown): ReadonlySet<IngressTicketRoute> | null {
  if (!Array.isArray(value) || value.length > INGRESS_TICKET_ROUTES.length) return null;
  const wanted = new Set<IngressTicketRoute>();
  for (const entry of value) {
    const route = INGRESS_TICKET_ROUTES.find((known) => known === entry);
    if (!route) return null;
    wanted.add(route);
  }
  return wanted;
}

export interface IngressRouteTicket {
  ticket: string;
  ids: readonly string[] | null;
}

export interface IngressRouteFailure {
  error: string;
}

export type IngressRouteResult = IngressRouteTicket | IngressRouteFailure;

export interface IngressTickets extends RemoteSessionTicket {
  routes: Partial<Record<IngressTicketRoute, IngressRouteResult>>;
}

const INGRESS_ROUTE_ID_FIELDS: Record<IngressTicketRoute, string | null> = {
  slack: "teams",
  discord: null,
  telegram: "chats",
  webhook: "routes",
};

export function decodeIngressTickets(value: unknown, wanted: readonly IngressTicketRoute[]): IngressTickets {
  const bootstrap = decodeRemoteSessionTicket(value);
  const record = decodeRecord(value, "ingress tickets");
  const routes = decodeRecord(record.routes, "ingress routes");
  const decoded: Partial<Record<IngressTicketRoute, IngressRouteResult>> = {};
  for (const route of wanted) decoded[route] = ingressRouteResult(routes[route], route);
  return { ...bootstrap, routes: decoded };
}

function ingressRouteResult(value: unknown, route: IngressTicketRoute): IngressRouteResult {
  const record = decodeRecord(value, `${route} route`);
  if (isString(record.error)) return { error: record.error };
  const field = INGRESS_ROUTE_ID_FIELDS[route];
  const ids = field === null ? undefined : record[field];
  return {
    ticket: text(record.ticket, `${route} route ticket`),
    ids: Array.isArray(ids) && ids.every(isString) ? ids : null,
  };
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
