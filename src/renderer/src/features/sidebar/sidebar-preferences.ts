import type { SidebarPin, SidebarPinsSnapshot } from "@openbot/contracts/ipc";
import {
  normalizeSidebarPinnedItems,
  reownSidebarPinnedItems,
  type SidebarPinnedItem,
  sidebarPinnedItemKey,
} from "@openbot/ui/features/sidebar/sidebar-pins";
import { createMemo, createSignal } from "solid-js";
import {
  readPendingSidebarPinScopes,
  readSidebarPins,
  type SidebarPinsByServer,
  writePendingSidebarPinScopes,
  writeSidebarPins,
} from "./sidebar-pins-storage";
import { readSidebarCollapsed, type SidebarCollapsedByServer, writeSidebarCollapsed } from "./sidebar-sections-storage";

export function createSidebarPreferences(options: { scope: () => string; sync?: SidebarPinSync }) {
  let pinsByServer = readSidebarPins();
  const [sidebarPinsByServer, setSidebarPinsByServer] = createSignal<SidebarPinsByServer>(pinsByServer);
  const [sidebarCollapsedByServer, setSidebarCollapsedByServer] = createSignal<SidebarCollapsedByServer>(
    readSidebarCollapsed(),
  );
  const pendingScopes = readPendingSidebarPinScopes();
  const localChanges = new Map<string, number>();

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

  function collapseSidebarSection(sectionId: string): void {
    if (collapsedSidebarSectionIds().includes(sectionId)) return;
    toggleSidebarSection(sectionId);
  }

  function savePins(next: SidebarPinsByServer): void {
    pinsByServer = next;
    writeSidebarPins(next);
    setSidebarPinsByServer(next);
  }

  function storeScopePins(scope: string, items: readonly SidebarPinnedItem[]): void {
    const next = { ...pinsByServer };
    if (items.length > 0) next[scope] = [...items];
    else delete next[scope];
    savePins(next);
  }

  function setPending(scope: string, pending: boolean): void {
    if (pendingScopes.has(scope) === pending) return;
    if (pending) pendingScopes.add(scope);
    else pendingScopes.delete(scope);
    writePendingSidebarPinScopes(pendingScopes);
  }

  function applyServerPins(scope: string, snapshot: SidebarPinsSnapshot, change = localChanges.get(scope) ?? 0): void {
    if ((localChanges.get(scope) ?? 0) !== change) return;
    setPending(scope, false);
    storeScopePins(scope, normalizeSidebarPinnedItems(snapshot.items));
  }

  function pushScopePins(scope: string): void {
    const sync = options.sync;
    if (!sync?.supports(scope)) return;
    const change = (localChanges.get(scope) ?? 0) + 1;
    localChanges.set(scope, change);
    setPending(scope, true);
    sync
      .set(scope, syncedPins(pinsByServer[scope] ?? []))
      .then((snapshot) => applyServerPins(scope, snapshot, change))
      .catch(() => undefined);
  }

  async function syncActiveServerPins(): Promise<void> {
    const sync = options.sync;
    const scope = options.scope();
    if (!sync?.supports(scope)) return;
    const local = syncedPins(pinsByServer[scope] ?? []);
    if (pendingScopes.has(scope)) {
      pushScopePins(scope);
      return;
    }
    const change = localChanges.get(scope) ?? 0;
    const snapshot = await sync.read(scope);
    if (snapshot.updatedAt === null && local.length > 0) applyServerPins(scope, await sync.seed(scope, local), change);
    else if (snapshot.updatedAt !== null) applyServerPins(scope, snapshot, change);
  }

  function receiveServerPins(scope: string, snapshot: SidebarPinsSnapshot): void {
    if (!pendingScopes.has(scope)) applyServerPins(scope, snapshot);
  }

  function updateActiveServerPins(update: (items: SidebarPinnedItem[]) => SidebarPinnedItem[]): void {
    const serverId = options.scope();
    storeScopePins(serverId, normalizeSidebarPinnedItems(update(pinsByServer[serverId] ?? [])));
    pushScopePins(serverId);
  }

  function reconcileActiveServerPins(agentIds: readonly string[]): void {
    const roster = new Set(agentIds);
    const serverId = options.scope();
    const items = pinsByServer[serverId];
    if (!items) return;
    const reowned = reownSidebarPinnedItems(items, roster);
    if (reowned.length === items.length && reowned.every((item, index) => item.id === items[index]?.id)) return;
    storeScopePins(serverId, reowned);
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
    const current = pinsByServer;
    const changed = Object.keys(current).filter((serverId) =>
      current[serverId]?.some((candidate) => sidebarPinnedItemKey(candidate) === key),
    );
    const next = Object.fromEntries(
      Object.entries(current).flatMap(([serverId, items]) => {
        const filtered = items.filter((candidate) => sidebarPinnedItemKey(candidate) !== key);
        return filtered.length > 0 ? [[serverId, filtered]] : [];
      }),
    );
    savePins(next);
    for (const serverId of changed) pushScopePins(serverId);
  }

  return {
    collapsedSidebarSectionIds,
    toggleSidebarSection,
    collapseSidebarSection,
    pinnedSidebarItems,
    reconcileActiveServerPins,
    pinSidebarItem,
    unpinSidebarItem,
    reorderPinnedSidebarItems,
    removePinnedSidebarItemEverywhere,
    syncActiveServerPins,
    receiveServerPins,
  };
}

export interface SidebarPinSync {
  supports(scope: string): boolean;
  read(scope: string): Promise<SidebarPinsSnapshot>;
  set(scope: string, items: SidebarPin[]): Promise<SidebarPinsSnapshot>;
  seed(scope: string, items: SidebarPin[]): Promise<SidebarPinsSnapshot>;
}

function syncedPins(items: readonly SidebarPinnedItem[]): SidebarPin[] {
  return items.flatMap((item) => (item.kind === "person" ? [] : [{ kind: item.kind, id: item.id }]));
}
