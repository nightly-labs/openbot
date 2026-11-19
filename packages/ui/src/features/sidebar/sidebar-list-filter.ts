import type { AppTextKey } from "@openbot/i18n";

export type SidebarListShow = "all" | "agents" | "channels";

export const SIDEBAR_LIST_SHOW_OPTIONS = ["all", "agents", "channels"] as const satisfies readonly SidebarListShow[];

export const SIDEBAR_LIST_SHOW_LABEL = {
  all: "sidebar.filter.allChats",
  agents: "sidebar.filter.agents",
  channels: "sidebar.filter.channels",
} as const satisfies Record<SidebarListShow, AppTextKey>;

export interface SidebarListFilter {
  show: SidebarListShow;
  unread: boolean;
  working: boolean;
  folders: readonly string[];
}

export const SIDEBAR_NO_LIST_FILTER: SidebarListFilter = { show: "all", unread: false, working: false, folders: [] };

export interface SidebarChatFacts {
  id: string;
  kind: "agent" | "channel";
  folder: string;
  unread: boolean;
  working: boolean;
}

export interface SidebarFolderNode {
  id: string;
  name: string | null;
  children: readonly SidebarFolderNode[];
}

export function sidebarListFilterIsSet(filter: SidebarListFilter): boolean {
  return filter.show !== "all" || filter.unread || filter.working || filter.folders.length > 0;
}

export function sidebarListFilterParts(filter: SidebarListFilter): number {
  return Number(filter.show !== "all") + Number(filter.unread || filter.working) + Number(filter.folders.length > 0);
}

export function sidebarChatMatchesFilter(chat: SidebarChatFacts, filter: SidebarListFilter): boolean {
  if (filter.show === "agents" && chat.kind !== "agent") return false;
  if (filter.show === "channels" && chat.kind !== "channel") return false;
  if ((filter.unread || filter.working) && !((filter.unread && chat.unread) || (filter.working && chat.working))) {
    return false;
  }
  return filter.folders.length === 0 || filter.folders.includes(chat.folder);
}

export function sidebarFolderTreeIds(node: SidebarFolderNode): string[] {
  return [node.id, ...node.children.flatMap(sidebarFolderTreeIds)];
}

export type SidebarFolderMark = "on" | "off" | "mixed";

export function sidebarFolderMark(node: SidebarFolderNode, selected: readonly string[]): SidebarFolderMark {
  const ids = sidebarFolderTreeIds(node);
  const count = ids.filter((id) => selected.includes(id)).length;
  if (count === 0) return "off";
  return count === ids.length ? "on" : "mixed";
}

export function sidebarToggleFolder(
  node: SidebarFolderNode,
  roots: readonly SidebarFolderNode[],
  selected: readonly string[],
): string[] {
  const allIds = roots.flatMap(sidebarFolderTreeIds);
  const next = new Set(selected);
  const on = sidebarFolderMark(node, selected) === "on";
  for (const id of sidebarFolderTreeIds(node)) {
    if (on) next.delete(id);
    else next.add(id);
  }
  const ordered = allIds.filter((id) => next.has(id));
  return ordered.length === allIds.length ? [] : ordered;
}

export function sidebarSelectedFolders(
  nodes: readonly SidebarFolderNode[],
  selected: readonly string[],
): SidebarFolderNode[] {
  return nodes.flatMap((node) => {
    const mark = sidebarFolderMark(node, selected);
    if (mark === "on") return [node];
    if (mark === "off") return [];
    return [...(selected.includes(node.id) ? [node] : []), ...sidebarSelectedFolders(node.children, selected)];
  });
}
