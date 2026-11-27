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
  | { kind: "unread"; id: string; count: number }
  | {
      kind: "section";
      id: string;
      name: string;
      title: string;
      parentName: string | null;
      ancestorIds: readonly string[];
      custom: boolean;
      empty: boolean;
    }
  | { kind: "agent"; id: string; agent: MobileAgent }
  | { kind: "channel"; id: string; channel: ChannelSummary };

type MobileChatItem = Extract<MobileSidebarItem, { kind: "agent" | "channel" }>;

export type MobileChatOrder = "manual" | "recent" | "unread-group" | "unread-first";

export const MOBILE_CHAT_ORDERS = [
  "manual",
  "recent",
  "unread-group",
  "unread-first",
] as const satisfies readonly MobileChatOrder[];

export function mobileChatOrderSortsSections(order: MobileChatOrder): boolean {
  return order === "recent" || order === "unread-first";
}

function chatActivity(chat: MobileChatItem): number {
  const at = chat.kind === "agent" ? chat.agent.updatedAt : (chat.channel.lastMessage?.at ?? chat.channel.createdAt);
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

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

export function mobileSidebarItems(
  layout: SidebarLayoutSnapshot | null,
  agents: MobileAgent[],
  channels: ChannelSummary[],
  collapsedSectionIds: ReadonlySet<string> = new Set(),
  t: MobileTranslate = currentText().t,
  order: { recent?: boolean; unreadFirst?: ReadonlySet<string> | null; aside?: ReadonlySet<string> | null } = {},
): MobileSidebarItem[] {
  const { recent, unreadFirst, aside } = order;
  const sorted = chatItems(layout, agents, channels);
  const chats = unreadFirst
    ? [
        ...byRecent(sorted.filter((chat) => unreadFirst.has(chat.id))),
        ...byRecent(sorted.filter((chat) => !unreadFirst.has(chat.id))),
      ]
    : recent
      ? byRecent(sorted)
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
        empty: all.length === 0 && ![...parents.values()].includes(id),
      },
      ...(collapsedSectionIds.has(id) ? [] : group),
    ];
  });
}

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

export function mobileUnreadItems(
  layout: SidebarLayoutSnapshot | null,
  agents: MobileAgent[],
  channels: ChannelSummary[],
): MobileSidebarItem[] {
  const chats = byRecent(chatItems(layout, agents, channels));
  if (chats.length === 0) return [];
  return [{ kind: "unread", id: "unread", count: chats.length }, ...chats];
}

export function moveSidebarChat(
  layout: SidebarLayoutSnapshot,
  action: Extract<SidebarLayoutAction, { type: "move-agent" | "assign" }>,
): SidebarLayoutSnapshot {
  const agentAssignments = { ...layout.agentAssignments };
  if (action.sectionId === null) delete agentAssignments[action.agentId];
  else agentAssignments[action.agentId] = action.sectionId;
  if (action.type === "assign") return { ...layout, agentAssignments };
  const agentOrder = layout.agentOrder.filter((id) => id !== action.agentId);
  const index = action.beforeAgentId === null ? -1 : agentOrder.indexOf(action.beforeAgentId);
  agentOrder.splice(index < 0 ? agentOrder.length : index, 0, action.agentId);
  return { ...layout, agentAssignments, agentOrder };
}
