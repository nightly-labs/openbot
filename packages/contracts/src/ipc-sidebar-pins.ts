import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isString } from "./runtime-values";

/** The kinds of chat that a user pins. A workflow pin stays on each phone. */
export const SIDEBAR_PIN_KINDS = ["agent", "channel"] as const;
export type SidebarPinKind = (typeof SIDEBAR_PIN_KINDS)[number];

/** One pinned chat. */
export interface SidebarPin {
  kind: SidebarPinKind;
  id: string;
}

/** The most pins in one list, as `sidebar-pins-v1` permits. */
export const SIDEBAR_PIN_LIMIT = 1000;

/**
 * The chats that the signed-in user pinned on one server, in their order. The host keeps the list for
 * each member, so the desktop app, the web client and the phones of that member show the same pins.
 */
export interface SidebarPinsSnapshot {
  items: SidebarPin[];
  /** ISO 8601 time of the last change, or `null` when the member never saved a list on this server. */
  updatedAt: string | null;
}

export interface SetSidebarPinsInput {
  items: SidebarPin[];
}

export function isSidebarPinKind(value: unknown): value is SidebarPinKind {
  return SIDEBAR_PIN_KINDS.some((kind) => kind === value);
}

export function isSidebarPin(value: unknown): value is SidebarPin {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "kind" || key === "id") &&
    isSidebarPinKind(value.kind) &&
    isIdentifier(value.id)
  );
}

export function sidebarPinKey(pin: SidebarPin): string {
  return `${pin.kind}:${pin.id}`;
}

function isSidebarPinList(value: unknown): value is SidebarPin[] {
  return (
    Array.isArray(value) &&
    value.length <= SIDEBAR_PIN_LIMIT &&
    value.every(isSidebarPin) &&
    new Set(value.map(sidebarPinKey)).size === value.length
  );
}

function isUpdatedAt(value: unknown): value is string | null {
  return (
    value === null || (isString(value) && value.length > 0 && value.length <= 64 && !Number.isNaN(Date.parse(value)))
  );
}

export function isSidebarPinsSnapshot(value: unknown): value is SidebarPinsSnapshot {
  return isDynamicRecord(value) && isSidebarPinList(value.items) && isUpdatedAt(value.updatedAt);
}

export function parseSetSidebarPinsInput(value: unknown): SetSidebarPinsInput {
  if (!isDynamicRecord(value) || Object.keys(value).some((key) => key !== "items") || !isSidebarPinList(value.items))
    throw new Error("Invalid pinned chats request.");
  return { items: value.items.map((pin) => ({ kind: pin.kind, id: pin.id })) };
}
