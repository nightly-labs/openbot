/**
 * The filter of the chat list: by kind, by state and by folder. It is a view of the list only. It
 * does not change the layout, and the list keeps it for as long as the sidebar is open.
 */

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
  /** With `working`: a chat shows when it has either state. */
  unread: boolean;
  working: boolean;
  /** The folders to show, in sidebar order. None: every folder. */
  folders: readonly string[];
}

export const SIDEBAR_NO_LIST_FILTER: SidebarListFilter = { show: "all", unread: false, working: false, folders: [] };

/** What the filter knows of a chat. */
export interface SidebarChatFacts {
  id: string;
  kind: "agent" | "channel";
  /** The section that holds the chat. */
  folder: string;
  unread: boolean;
  working: boolean;
}

/** A folder and the folders in it. The unassigned section has no name. */
export interface SidebarFolderNode {
  id: string;
  name: string | null;
  children: readonly SidebarFolderNode[];
}

export function sidebarListFilterIsSet(filter: SidebarListFilter): boolean {
  return filter.show !== "all" || filter.unread || filter.working || filter.folders.length > 0;
}

/** How many parts of the filter are set: the kind, the state and the folders count once each. */
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

/** The folder and each folder in it, in sidebar order. */
export function sidebarFolderTreeIds(node: SidebarFolderNode): string[] {
  return [node.id, ...node.children.flatMap(sidebarFolderTreeIds)];
}

export type SidebarFolderMark = "on" | "off" | "mixed";

/** On when the folder and all folders in it are selected, mixed when only some are. */
export function sidebarFolderMark(node: SidebarFolderNode, selected: readonly string[]): SidebarFolderMark {
  const ids = sidebarFolderTreeIds(node);
  const count = ids.filter((id) => selected.includes(id)).length;
  if (count === 0) return "off";
  return count === ids.length ? "on" : "mixed";
}

/**
 * Selects or clears a folder with the folders in it. All folders selected is the same as none. A
 * folder that no longer exists drops out of the selection here.
 */
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

/** The highest folders that are fully selected, and the folders with only their own chats selected. */
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
