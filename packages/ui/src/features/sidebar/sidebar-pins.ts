import { legacyAgentId } from "@openbot/contracts/validation";

export type SidebarPinnedItem = Readonly<{
  kind: "agent" | "channel" | "person";
  id: string;
}>;

export function sidebarPinnedItemKey(item: SidebarPinnedItem): string {
  return `${item.kind}:${item.id}`;
}

export function normalizeSidebarPinnedItems(value: readonly SidebarPinnedItem[]): SidebarPinnedItem[] {
  const seen = new Set<string>();
  const items: SidebarPinnedItem[] = [];
  for (const candidate of value) {
    // A channel is pinned like an agent; `person` is the one kind that was written here by a
    // released build and is no longer pinnable, so a stored person pin is dropped rather than shown.
    if (candidate.kind === "person") continue;
    const key = sidebarPinnedItemKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind: candidate.kind, id: candidate.id });
  }
  return items;
}

/**
 * Points pins a released build wrote at the agents that own them now. Migration v13 renamed agents inside
 * the host's database, but these pins live in browser storage it never touched, so every pinned agent
 * looks deleted after the upgrade -- it vanishes from the pinned group while remaining in saved pins.
 * An id still in the roster answers for itself: v13 declines to rename onto an id that is taken, so
 * `bot-<uuid>` can be sitting beside the `agent-<uuid>` it would have become. A pin that matches nobody is
 * left exactly as found, because an agent can be absent for reasons that have nothing to do with the
 * rename.
 */
export function reownSidebarPinnedItems(
  items: readonly SidebarPinnedItem[],
  agentIds: ReadonlySet<string>,
): SidebarPinnedItem[] {
  const renamedFrom = new Map<string, string>();
  for (const agentId of agentIds) {
    const legacyId = legacyAgentId(agentId);
    if (legacyId !== agentId) renamedFrom.set(legacyId, agentId);
  }
  // Reowning can land two pins on one agent -- a stale `bot-<uuid>` pin beside an `agent-<uuid>` one the
  // user made after the upgrade -- so the result goes back through the normalizer. A duplicate that
  // reached storage would show the agent twice and duplicate it in saved pins.
  return normalizeSidebarPinnedItems(
    items.map((item) => {
      if (item.kind !== "agent" || agentIds.has(item.id)) return item;
      const currentId = renamedFrom.get(item.id);
      return currentId === undefined ? item : { kind: item.kind, id: currentId };
    }),
  );
}
