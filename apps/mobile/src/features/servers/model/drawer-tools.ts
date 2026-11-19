import { isString } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const DRAWER_TOOL_IDS = [
  "tasks",
  "routines",
  "workflows",
  "marketplace",
  "usage",
  "library",
  "providers",
  "remoteDesktop",
  "members",
] as const;

export type DrawerToolId = (typeof DRAWER_TOOL_IDS)[number];

const DEFAULT_UNPINNED: readonly DrawerToolId[] = ["providers"];

interface DrawerToolLayout {
  order: DrawerToolId[];
  hidden: DrawerToolId[];
}

const key = "openbot.mobile.drawer-tools.v1";

export function isDrawerToolId(value: unknown): value is DrawerToolId {
  return DRAWER_TOOL_IDS.some((id) => id === value);
}

function toolIds(value: unknown): DrawerToolId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isString).filter(isDrawerToolId))] : [];
}

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
  const saved = toolIds(fields.get("order"));
  const added = DEFAULT_UNPINNED.filter((id) => !saved.includes(id));
  return { order: completeOrder(saved), hidden: [...new Set([...toolIds(fields.get("hidden")), ...added])] };
}

function read(): DrawerToolLayout {
  try {
    return decode(SecureStore.getItem(key));
  } catch {
    return decode(null);
  }
}

export const useDrawerToolLayout = create<DrawerToolLayout>(read);

function save(change: Partial<DrawerToolLayout>): void {
  useDrawerToolLayout.setState(change);
  const { order, hidden } = useDrawerToolLayout.getState();
  SecureStore.setItemAsync(key, JSON.stringify({ order, hidden })).catch(() => undefined);
}

export function reorderDrawerTools(shown: readonly DrawerToolId[]): void {
  const { order } = useDrawerToolLayout.getState();
  const queue = [...shown];
  save({ order: order.map((id) => (shown.includes(id) ? (queue.shift() ?? id) : id)) });
}

export function setDrawerToolPinned(id: DrawerToolId, pinned: boolean): void {
  const { hidden } = useDrawerToolLayout.getState();
  save({ hidden: pinned ? hidden.filter((candidate) => candidate !== id) : [...new Set([...hidden, id])] });
}
