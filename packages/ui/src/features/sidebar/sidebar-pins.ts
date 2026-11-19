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
    if (candidate.kind === "person") continue;
    const key = sidebarPinnedItemKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind: candidate.kind, id: candidate.id });
  }
  return items;
}

export function reownSidebarPinnedItems(
  items: readonly SidebarPinnedItem[],
  agentIds: ReadonlySet<string>,
): SidebarPinnedItem[] {
  const renamedFrom = new Map<string, string>();
  for (const agentId of agentIds) {
    const legacyId = legacyAgentId(agentId);
    if (legacyId !== agentId) renamedFrom.set(legacyId, agentId);
  }
  return normalizeSidebarPinnedItems(
    items.map((item) => {
      if (item.kind !== "agent" || agentIds.has(item.id)) return item;
      const currentId = renamedFrom.get(item.id);
      return currentId === undefined ? item : { kind: item.kind, id: currentId };
    }),
  );
}
