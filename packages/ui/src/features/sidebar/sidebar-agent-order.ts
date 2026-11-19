import { SIDEBAR_UNASSIGNED_SECTION_ID, type SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import type { SidebarPinnedItem } from "./sidebar-pins";

export function sortByLayoutOrder<T extends { id: string }>(items: readonly T[], agentOrder: readonly string[]): T[] {
  const orderIndex = new Map(agentOrder.map((chatId, index) => [chatId, index]));
  const naturalIndex = new Map(items.map((item, index) => [item.id, index]));
  const position = (item: T) => orderIndex.get(item.id) ?? agentOrder.length + (naturalIndex.get(item.id) ?? 0);
  return [...items].sort((left, right) => position(left) - position(right));
}

export function sidebarSectionResolver(layout: SidebarLayoutSnapshot): (chatId: string) => string {
  const sectionIds = new Set(layout.sections.map((section) => section.id));
  const orderedSectionIds = new Set(layout.order);
  return (chatId) => {
    const assigned = layout.agentAssignments[chatId];
    return assigned && sectionIds.has(assigned) && orderedSectionIds.has(assigned)
      ? assigned
      : SIDEBAR_UNASSIGNED_SECTION_ID;
  };
}

export function sidebarAgentOrder<T extends { id: string }>(
  agents: readonly T[],
  view: {
    layout: SidebarLayoutSnapshot;
    pinnedItems: readonly SidebarPinnedItem[];
    hiddenAgentIds: ReadonlySet<string>;
  },
): T[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const pinned: T[] = [];
  const pinnedIds = new Set<string>();
  for (const ref of view.pinnedItems) {
    const agent = ref.kind === "agent" ? byId.get(ref.id) : undefined;
    if (!agent || view.hiddenAgentIds.has(agent.id) || pinnedIds.has(agent.id)) continue;
    pinned.push(agent);
    pinnedIds.add(agent.id);
  }
  const listed = sortByLayoutOrder(
    agents.filter((agent) => !view.hiddenAgentIds.has(agent.id) && !pinnedIds.has(agent.id)),
    view.layout.agentOrder,
  );
  const sectionOf = sidebarSectionResolver(view.layout);
  const bySection = new Map<string, T[]>();
  for (const agent of listed) {
    const sectionId = sectionOf(agent.id);
    const group = bySection.get(sectionId);
    if (group) group.push(agent);
    else bySection.set(sectionId, [agent]);
  }
  const hidden = sortByLayoutOrder(
    agents.filter((agent) => view.hiddenAgentIds.has(agent.id)),
    view.layout.agentOrder,
  );
  const sectionIds = [...new Set([...view.layout.order, ...bySection.keys()])];
  return [...pinned, ...sectionIds.flatMap((sectionId) => bySection.get(sectionId) ?? []), ...hidden];
}
