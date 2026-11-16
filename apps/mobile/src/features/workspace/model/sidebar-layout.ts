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
  /** The heading of the "Unread" group of the `unread-group` order. */
  | { kind: "unread"; id: string; count: number }
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

type MobileChatItem = Extract<MobileSidebarItem, { kind: "agent" | "channel" }>;

/**
 * How the list orders the chats in the sections, as on the desktop. Pins and "Needs you" come first in
 * each order, and none of them changes the saved `agentOrder`. The phone keeps the choice; it is not
 * synced.
 * - `manual`: the saved order of the layout.
 * - `unread-group`: unread chats leave their section for an "Unread" group under "Needs you", and go
 *   back to their place when they are read.
 * - `unread-first`: each section shows its unread chats first, then the others, both by last
 *   activity. Chats do not move in the list by drag in this order, because the order is not manual.
 */
export type MobileChatOrder = "manual" | "unread-group" | "unread-first";

export const MOBILE_CHAT_ORDERS = [
  "manual",
  "unread-group",
  "unread-first",
] as const satisfies readonly MobileChatOrder[];

/** When a chat last had activity, in epoch milliseconds: the agent's last update, or the channel's last message. */
function chatActivity(chat: MobileChatItem): number {
  const at = chat.kind === "agent" ? chat.agent.updatedAt : (chat.channel.lastMessage?.at ?? chat.channel.createdAt);
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

/** The most recent chat first. The sort is stable, so chats with the same time keep their order. */
function byRecent<Item extends MobileChatItem>(chats: readonly Item[]): Item[] {
  return [...chats].sort((a, b) => chatActivity(b) - chatActivity(a));
}

function chatItems(layout: SidebarLayoutSnapshot | null, agents: MobileAgent[], channels: ChannelSummary[]) {
  const chats: MobileChatItem[] = [
    ...channels.map((channel) => ({ kind: "channel" as const, id: channel.id, channel })),
    ...agents.map((agent) => ({ kind: "agent" as const, id: agent.id, agent })),
  ];
  if (!layout) return chats;
  const positions = new Map(layout.agentOrder.map((id, index) => [id, index]));
  return chats.sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size));
}

/**
 * `order.unreadFirst`: the unread chats, for the `unread-first` order. Each section then shows them
 * first and then the other chats, both by last activity. Null keeps the saved order.
 * `order.aside`: the chats that show in another group, such as "Unread". A folder leaves them out,
 * but a folder that holds only such chats is not empty.
 */
export function mobileSidebarItems(
  layout: SidebarLayoutSnapshot | null,
  agents: MobileAgent[],
  channels: ChannelSummary[],
  collapsedSectionIds: ReadonlySet<string> = new Set(),
  t: MobileTranslate = currentText().t,
  order: { unreadFirst?: ReadonlySet<string> | null; aside?: ReadonlySet<string> | null } = {},
): MobileSidebarItem[] {
  const { unreadFirst, aside } = order;
  const sorted = chatItems(layout, agents, channels);
  const chats = unreadFirst
    ? [
        ...byRecent(sorted.filter((chat) => unreadFirst.has(chat.id))),
        ...byRecent(sorted.filter((chat) => !unreadFirst.has(chat.id))),
      ]
    : sorted;
  if (!layout) return aside ? chats.filter((chat) => !aside.has(chat.id)) : chats;
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
    const all = groups.get(id) ?? [];
    const group = aside ? all.filter((chat) => !aside.has(chat.id)) : all;
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
        empty: all.length === 0 && ![...parents.values()].includes(id),
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

/** The "Unread" group of the `unread-group` order, above the sections, by last activity. */
export function mobileUnreadItems(
  layout: SidebarLayoutSnapshot | null,
  agents: MobileAgent[],
  channels: ChannelSummary[],
): MobileSidebarItem[] {
  const chats = byRecent(chatItems(layout, agents, channels));
  if (chats.length === 0) return [];
  return [{ kind: "unread", id: "unread", count: chats.length }, ...chats];
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
