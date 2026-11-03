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
 *
 * A server with `sidebar-pins-v1` keeps the pins of the user for all of their devices (`sync`). Then
 * `localStorage` is the copy of this computer: `syncActiveServerPins` reads the server list on each
 * connect, and each change here is sent to the server. A change that did not reach the server stays
 * pending and is sent on the next connect. The first connect saves the pins of this computer on the
 * server once, when the user has no list there yet.
 */
export function createSidebarPreferences(options: { scope: () => string; sync?: SidebarPinSync }) {
  /**
   * The pins as they are now. A Solid 2 signal shows a write only after the next flush, and a pin
   * change reads the new list at once to send it to the server.
   */
  let pinsByServer = readSidebarPins();
  const [sidebarPinsByServer, setSidebarPinsByServer] = createSignal<SidebarPinsByServer>(pinsByServer);
  const [sidebarCollapsedByServer, setSidebarCollapsedByServer] = createSignal<SidebarCollapsedByServer>(
    readSidebarCollapsed(),
  );
  const pendingScopes = readPendingSidebarPinScopes();
  /** The count of local pin changes in each scope, so a slow server answer cannot undo a newer change. */
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

  /** Collapses one section of the active scope, such as the Integrations section OpenBot just made. */
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

  /** Shows the list that the server keeps, unless a change from this computer has not reached it yet. */
  function applyServerPins(scope: string, snapshot: SidebarPinsSnapshot, change = localChanges.get(scope) ?? 0): void {
    if ((localChanges.get(scope) ?? 0) !== change) return;
    setPending(scope, false);
    storeScopePins(scope, normalizeSidebarPinnedItems(snapshot.items));
  }

  /** Sends the pins of `scope` to its server. A failed send stays pending for the next connect. */
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

  /**
   * Brings the pins of the active scope in line with its server, after each connect. A pending change
   * from this computer goes first. With no list on the server, the pins of this computer become the list.
   */
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

  /** A change from another device of the user, as the server sent it. */
  function receiveServerPins(scope: string, snapshot: SidebarPinsSnapshot): void {
    if (!pendingScopes.has(scope)) applyServerPins(scope, snapshot);
  }

  function updateActiveServerPins(update: (items: SidebarPinnedItem[]) => SidebarPinnedItem[]): void {
    const serverId = options.scope();
    storeScopePins(serverId, normalizeSidebarPinnedItems(update(pinsByServer[serverId] ?? [])));
    pushScopePins(serverId);
  }

  /**
   * Brings this scope's pins up to date with the roster it just sent. Nothing else rewrites them: the
   * pins are in browser storage, and the id migration ran inside the host's database. A server that
   * keeps the pins gets the new ids with the next change or the first seed, and does not lose a newer
   * list from another device to this rename.
   */
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

/** How the pins of a scope reach the server that keeps them for all devices of the user. */
export interface SidebarPinSync {
  /**
   * True when the server of `scope` keeps the pins (`sidebar-pins-v1`), also while it is away: a send
   * that fails then stays pending.
   */
  supports(scope: string): boolean;
  read(scope: string): Promise<SidebarPinsSnapshot>;
  set(scope: string, items: SidebarPin[]): Promise<SidebarPinsSnapshot>;
  seed(scope: string, items: SidebarPin[]): Promise<SidebarPinsSnapshot>;
}

/** The pins that a server keeps. A person pin of a released build is not one of them. */
function syncedPins(items: readonly SidebarPinnedItem[]): SidebarPin[] {
  return items.flatMap((item) => (item.kind === "person" ? [] : [{ kind: item.kind, id: item.id }]));
}
