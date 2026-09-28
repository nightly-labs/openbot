import {
  normalizeSidebarPinnedItems,
  reownSidebarPinnedItems,
  type SidebarPinnedItem,
  sidebarPinnedItemKey,
} from "@openbot/ui/features/sidebar/sidebar-pins";
import { createMemo, createSignal } from "solid-js";
import { readSidebarPins, type SidebarPinsByServer, writeSidebarPins } from "./sidebar-pins-storage";
import { readSidebarCollapsed, type SidebarCollapsedByServer, writeSidebarCollapsed } from "./sidebar-sections-storage";

/**
 * The pinned items and collapsed sections that this computer remembers for each scope. The desktop
 * scope is the server id; the browser client's is the account and host, because one browser can
 * sign in to more than one account.
 *
 * Both are read under `scope()`, so they are *not* torn down on a switch: `localStorage` holds every
 * scope's arrangement at once and switching back has to restore it.
 *
 * `removePinnedSidebarItemEverywhere` is the one write that ignores the scope. A deleted agent has to
 * lose its pin in every scope that pinned it, because nothing will ever re-render that entry into a
 * valid state again.
 */
export function createSidebarPreferences(options: { scope: () => string }) {
  const [sidebarPinsByServer, setSidebarPinsByServer] = createSignal<SidebarPinsByServer>(readSidebarPins());
  const [sidebarCollapsedByServer, setSidebarCollapsedByServer] = createSignal<SidebarCollapsedByServer>(
    readSidebarCollapsed(),
  );

  const pinnedSidebarItems = createMemo(() => sidebarPinsByServer()[options.scope()] ?? []);
  const collapsedSidebarSectionIds = createMemo(() => sidebarCollapsedByServer()[options.scope()] ?? []);

  function toggleSidebarSection(sectionId: string): void {
    const serverId = options.scope();
    setSidebarCollapsedByServer((current) => {
      const values = new Set(current[serverId] ?? []);
      if (values.has(sectionId)) values.delete(sectionId);
      else values.add(sectionId);
      const next = { ...current };
      if (values.size > 0) next[serverId] = [...values];
      else delete next[serverId];
      writeSidebarCollapsed(next);
      return next;
    });
  }

  function updateActiveServerPins(update: (items: SidebarPinnedItem[]) => SidebarPinnedItem[]): void {
    const serverId = options.scope();
    setSidebarPinsByServer((current) => {
      const items = normalizeSidebarPinnedItems(update(current[serverId] ?? []));
      const next = { ...current };
      if (items.length > 0) next[serverId] = items;
      else delete next[serverId];
      writeSidebarPins(next);
      return next;
    });
  }

  /**
   * Brings this scope's pins up to date with the roster it just sent. Nothing else rewrites them: the
   * pins are in browser storage, and the id migration ran inside the host's database.
   */
  function reconcileActiveServerPins(agentIds: readonly string[]): void {
    const roster = new Set(agentIds);
    const serverId = options.scope();
    setSidebarPinsByServer((current) => {
      const items = current[serverId];
      if (!items) return current;
      const reowned = reownSidebarPinnedItems(items, roster);
      if (reowned.length === items.length && reowned.every((item, index) => item.id === items[index]?.id))
        return current;
      const next = { ...current };
      if (reowned.length > 0) next[serverId] = reowned;
      else delete next[serverId];
      writeSidebarPins(next);
      return next;
    });
  }

  function pinSidebarItem(item: SidebarPinnedItem): void {
    updateActiveServerPins((items) =>
      items.some((candidate) => sidebarPinnedItemKey(candidate) === sidebarPinnedItemKey(item))
        ? items
        : [...items, item],
    );
  }

  function unpinSidebarItem(item: SidebarPinnedItem): void {
    const key = sidebarPinnedItemKey(item);
    updateActiveServerPins((items) => items.filter((candidate) => sidebarPinnedItemKey(candidate) !== key));
  }

  function reorderPinnedSidebarItems(items: SidebarPinnedItem[]): void {
    updateActiveServerPins(() => items);
  }

  function removePinnedSidebarItemEverywhere(item: SidebarPinnedItem): void {
    const key = sidebarPinnedItemKey(item);
    setSidebarPinsByServer((current) => {
      const next = Object.fromEntries(
        Object.entries(current).flatMap(([serverId, items]) => {
          const filtered = items.filter((candidate) => sidebarPinnedItemKey(candidate) !== key);
          return filtered.length > 0 ? [[serverId, filtered]] : [];
        }),
      );
      writeSidebarPins(next);
      return next;
    });
  }

  return {
    collapsedSidebarSectionIds,
    toggleSidebarSection,
    pinnedSidebarItems,
    reconcileActiveServerPins,
    pinSidebarItem,
    unpinSidebarItem,
    reorderPinnedSidebarItems,
    removePinnedSidebarItemEverywhere,
  };
}
