import { isString } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/** The tools of the drawer that the user can move and unpin. Server settings stays last and always shows. */
/** `remoteDesktop` shows only for a host that shares its screen, and `library` for a host with `storage-v1`. */
const DRAWER_TOOL_IDS = [
  "tasks",
  "routines",
  "workflows",
  "marketplace",
  "usage",
  "library",
  "remoteDesktop",
  "members",
] as const;

export type DrawerToolId = (typeof DRAWER_TOOL_IDS)[number];

interface DrawerToolLayout {
  /** All tools, in the order that the user gave them. */
  order: DrawerToolId[];
  /** The tools that the user unpinned: the drawer shows them only in edit mode. */
  hidden: DrawerToolId[];
}

const key = "openbot.mobile.drawer-tools.v1";

export function isDrawerToolId(value: unknown): value is DrawerToolId {
  return DRAWER_TOOL_IDS.some((id) => id === value);
}

function toolIds(value: unknown): DrawerToolId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isString).filter(isDrawerToolId))] : [];
}

/** A tool that a later version adds, and is not in the saved order, goes to its default place. */
function completeOrder(saved: readonly DrawerToolId[]): DrawerToolId[] {
  const order = [...saved];
  DRAWER_TOOL_IDS.forEach((id, index) => {
    if (!order.includes(id)) order.splice(Math.min(index, order.length), 0, id);
  });
  return order;
}

function decode(stored: string | null): DrawerToolLayout {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    value = null;
  }
  const fields = new Map<string, unknown>(typeof value === "object" && value !== null ? Object.entries(value) : []);
  return { order: completeOrder(toolIds(fields.get("order"))), hidden: toolIds(fields.get("hidden")) };
}

function read(): DrawerToolLayout {
  try {
    return decode(SecureStore.getItem(key));
  } catch {
    return decode(null);
  }
}

export const useDrawerToolLayout = create<DrawerToolLayout>(read);

/** Keeps the layout for the next start. A failed write keeps the change for this run. */
function save(change: Partial<DrawerToolLayout>): void {
  useDrawerToolLayout.setState(change);
  const { order, hidden } = useDrawerToolLayout.getState();
  SecureStore.setItemAsync(key, JSON.stringify({ order, hidden })).catch(() => undefined);
}

/**
 * Saves the new order of the tools that the drawer shows. A tool that this server does not have keeps
 * its place among the others.
 */
export function reorderDrawerTools(shown: readonly DrawerToolId[]): void {
  const { order } = useDrawerToolLayout.getState();
  const queue = [...shown];
  save({ order: order.map((id) => (shown.includes(id) ? (queue.shift() ?? id) : id)) });
}

export function setDrawerToolPinned(id: DrawerToolId, pinned: boolean): void {
  const { hidden } = useDrawerToolLayout.getState();
  save({ hidden: pinned ? hidden.filter((candidate) => candidate !== id) : [...new Set([...hidden, id])] });
}
