/**
 * The order in which the sidebar draws chats, for the places that list agents outside the sidebar.
 * Global search (⌘K) uses it, so that dragging an agent in the sidebar also moves its result and its
 * ⌘1-9 number.
 */

import { SIDEBAR_UNASSIGNED_SECTION_ID, type SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import type { SidebarPinnedItem } from "./sidebar-pins";

/**
 * Sorts chats by the persisted `agentOrder`. An id that the layout does not carry yet keeps its place in
 * `items` behind the ones it does carry.
 */
export function sortByLayoutOrder<T extends { id: string }>(items: readonly T[], agentOrder: readonly string[]): T[] {
  const orderIndex = new Map(agentOrder.map((chatId, index) => [chatId, index]));
  const naturalIndex = new Map(items.map((item, index) => [item.id, index]));
  const position = (item: T) => orderIndex.get(item.id) ?? agentOrder.length + (naturalIndex.get(item.id) ?? 0);
  return [...items].sort((left, right) => position(left) - position(right));
}

/**
 * Gives the section that the sidebar draws a chat in. A chat assigned to a section that the layout does
 * not draw goes to the unassigned section, where the user can still open it and move it.
 */
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

/**
 * Agents in the order the sidebar shows them: the pinned strip, then each section from top to bottom,
 * then the hidden group. The "Needs you" group is left out on purpose. It changes each time an agent
 * starts or stops waiting, and a list that follows it would move its ⌘1-9 numbers under the user.
 */
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
    // A hidden agent keeps its pin but is drawn in the hidden group. A repeated pin adds no second row.
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
  // A layout always names the unassigned section, but search must not lose an agent if one does not.
  const sectionIds = [...new Set([...view.layout.order, ...bySection.keys()])];
  return [...pinned, ...sectionIds.flatMap((sectionId) => bySection.get(sectionId) ?? []), ...hidden];
}
