import type { ChannelSummary, SidebarLayoutAction, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import {
  SIDEBAR_UNASSIGNED_SECTION_ID,
  sidebarFolderAncestors,
  sidebarFolderParents,
  sidebarFolderPath,
} from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { currentText } from "@/shared/lib/text";
import type { MobileAgent } from "./workspace-types";

export type MobileSidebarItem =
  | { kind: "waiting"; id: string; count: number }
  | {
      kind: "section";
      id: string;
      /** The path, such as "Acme / Engineering", for menus and accessibility. */
      name: string;
      /** The own name of the folder, which the header shows after `parentName`. */
      title: string;
      /** The name of the folder that holds this one, or null at the top of the list. */
      parentName: string | null;
      /** The folders that hold this one, from the top folder down. */
      ancestorIds: readonly string[];
      /** A folder of the user, not the "Agents" group of the chats in no folder. */
      custom: boolean;
      empty: boolean;
    }
  | { kind: "agent"; id: string; agent: MobileAgent }
  | { kind: "channel"; id: string; channel: ChannelSummary };

export function mobileSidebarItems(
  layout: SidebarLayoutSnapshot | null,
  agents: MobileAgent[],
  channels: ChannelSummary[],
  collapsedSectionIds: ReadonlySet<string> = new Set(),
  t: MobileTranslate = currentText().t,
): MobileSidebarItem[] {
  const chats: MobileSidebarItem[] = [
    ...channels.map((channel) => ({ kind: "channel" as const, id: channel.id, channel })),
    ...agents.map((agent) => ({ kind: "agent" as const, id: agent.id, agent })),
  ];
  if (!layout) return chats;
  const positions = new Map(layout.agentOrder.map((id, index) => [id, index]));
  chats.sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size));
  const names = new Map(layout.sections.map((section) => [section.id, section.name]));
  const groups = new Map<string, MobileSidebarItem[]>();
  for (const chat of chats) {
    const assigned = layout.agentAssignments[chat.id];
    const sectionId = assigned && names.has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
    const group = groups.get(sectionId) ?? [];
    group.push(chat);
    groups.set(sectionId, group);
  }
  // As on the desktop, folders do not indent: a folder in a folder shows "Parent / Name", and a closed
  // folder hides the folders in it too.
  const parents = sidebarFolderParents(layout);
  return layout.order.flatMap((id) => {
    const ancestorIds = sidebarFolderAncestors(parents, id);
    if (ancestorIds.some((ancestorId) => collapsedSectionIds.has(ancestorId))) return [];
    const group = groups.get(id) ?? [];
    const custom = names.has(id);
    const title = custom
      ? names.get(id)
      : id === SIDEBAR_UNASSIGNED_SECTION_ID
        ? t("mobile.workspace.section.agents")
        : undefined;
    if (title === undefined || (id === SIDEBAR_UNASSIGNED_SECTION_ID && group.length === 0)) return [];
    const parentId = parents.get(id);
    return [
      {
        kind: "section" as const,
        id,
        name: custom ? sidebarFolderPath(layout, parents, id).join(" / ") : title,
        title,
        parentName: (parentId && names.get(parentId)) ?? null,
        ancestorIds,
        custom,
        // An open folder with only folders in it is not empty.
        empty: group.length === 0 && ![...parents.values()].includes(id),
      },
      ...(collapsedSectionIds.has(id) ? [] : group),
    ];
  });
}

/**
 * "Needs you": the agents that wait for the user, above the sections, in layout order. As on the
 * desktop, the group is not a section of the layout. The layout keeps each agent's place, so an
 * agent returns to its section when the wait ends.
 */
export function mobileWaitingItems(layout: SidebarLayoutSnapshot | null, agents: MobileAgent[]): MobileSidebarItem[] {
  if (agents.length === 0) return [];
  const positions = new Map(layout?.agentOrder.map((id, index) => [id, index]));
  const sorted = [...agents].sort(
    (a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size),
  );
  return [
    { kind: "waiting", id: "needs-you", count: sorted.length },
    ...sorted.map((agent) => ({ kind: "agent" as const, id: agent.id, agent })),
  ];
}

/**
 * The layout after a `move-agent` action, as the host applies it. The phone shows the move before the
 * host answers; the answer of the host then replaces this layout.
 */
export function moveSidebarChat(
  layout: SidebarLayoutSnapshot,
  action: Extract<SidebarLayoutAction, { type: "move-agent" }>,
): SidebarLayoutSnapshot {
  const agentOrder = layout.agentOrder.filter((id) => id !== action.agentId);
  const index = action.beforeAgentId === null ? -1 : agentOrder.indexOf(action.beforeAgentId);
  agentOrder.splice(index < 0 ? agentOrder.length : index, 0, action.agentId);
  const agentAssignments = { ...layout.agentAssignments };
  if (action.sectionId === null) delete agentAssignments[action.agentId];
  else agentAssignments[action.agentId] = action.sectionId;
  return { ...layout, agentAssignments, agentOrder };
}
