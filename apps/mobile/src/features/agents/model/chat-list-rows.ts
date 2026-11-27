import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";

export type ChatListItem =
  | { kind: "waiting" | "unread"; id: string; count: number }
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
  | { kind: "agent"; id: string; agent: object }
  | { kind: "channel"; id: string; channel: { unreadCount: number } };

export interface ChatListRow<Item extends ChatListItem = ChatListItem> {
  key: string;
  item: Item;
  hidden: boolean;
  folderCollapsed: boolean;
  unread: number;
  first: boolean;
}

export interface ChatListRowsInput<Item extends ChatListItem> {
  items: readonly Item[];
  collapsedSectionIds: ReadonlySet<string>;
  unreadAgentIds: readonly string[];
  unreadCounts: Readonly<Record<string, number>>;
}

export function chatListRowKey(item: ChatListItem): string {
  return `${item.kind}:${item.id}`;
}

function hiddenRowIds(items: readonly ChatListItem[], collapsedSectionIds: ReadonlySet<string>) {
  const ids = new Set<string>();
  if (collapsedSectionIds.size === 0) return ids;
  let sectionCollapsed = false;
  for (const item of items) {
    if (item.kind === "waiting" || item.kind === "unread") sectionCollapsed = false;
    else if (item.kind === "section") {
      const hidden = item.ancestorIds.some((ancestorId) => collapsedSectionIds.has(ancestorId));
      if (hidden) ids.add(item.id);
      sectionCollapsed = hidden || collapsedSectionIds.has(item.id);
    } else if (sectionCollapsed) ids.add(item.id);
  }
  return ids;
}

function folderUnreadCounts({
  items,
  collapsedSectionIds,
  unreadAgentIds,
  unreadCounts,
}: ChatListRowsInput<ChatListItem>) {
  const counts = new Map<string, number>();
  if (collapsedSectionIds.size === 0) return counts;
  const unread = new Set(unreadAgentIds);
  let folderIds: readonly string[] = [];
  for (const item of items) {
    if (item.kind === "waiting" || item.kind === "unread") folderIds = [];
    else if (item.kind === "section")
      folderIds = [...item.ancestorIds, item.id].filter((id) => collapsedSectionIds.has(id));
    else {
      const count =
        item.kind === "channel"
          ? item.channel.unreadCount
          : unread.has(item.id)
            ? Math.max(1, unreadCounts[item.id] ?? 1)
            : 0;
      if (count > 0) for (const folderId of folderIds) counts.set(folderId, (counts.get(folderId) ?? 0) + count);
    }
  }
  return counts;
}

function sameItem(previous: ChatListItem, next: ChatListItem): boolean {
  if (previous === next) return true;
  switch (next.kind) {
    case "waiting":
    case "unread":
      return (
        (previous.kind === "waiting" || previous.kind === "unread") &&
        previous.kind === next.kind &&
        previous.count === next.count
      );
    case "agent":
      return previous.kind === "agent" && previous.agent === next.agent;
    case "channel":
      return previous.kind === "channel" && previous.channel === next.channel;
    case "section":
      return (
        previous.kind === "section" &&
        previous.name === next.name &&
        previous.title === next.title &&
        previous.parentName === next.parentName &&
        previous.custom === next.custom &&
        previous.empty === next.empty &&
        previous.ancestorIds.length === next.ancestorIds.length &&
        previous.ancestorIds.every((id, index) => id === next.ancestorIds[index])
      );
  }
}

function sameRow<Item extends ChatListItem>(
  previous: ChatListRow<Item>,
  next: Omit<ChatListRow<Item>, "key">,
): boolean {
  return (
    previous.hidden === next.hidden &&
    previous.folderCollapsed === next.folderCollapsed &&
    previous.unread === next.unread &&
    previous.first === next.first &&
    sameItem(previous.item, next.item)
  );
}

export function chatListRows<Item extends ChatListItem>(
  input: ChatListRowsInput<Item>,
  previous: readonly ChatListRow<Item>[],
): readonly ChatListRow<Item>[] {
  const hidden = hiddenRowIds(input.items, input.collapsedSectionIds);
  const folderUnread = folderUnreadCounts(input);
  const kept = new Map(previous.map((row) => [row.key, row]));
  let changed = previous.length !== input.items.length;
  const rows = input.items.map((item, index): ChatListRow<Item> => {
    const key = chatListRowKey(item);
    const next = {
      item,
      hidden: hidden.has(item.id),
      folderCollapsed: item.kind === "section" && input.collapsedSectionIds.has(item.id),
      unread: item.kind === "section" ? (folderUnread.get(item.id) ?? 0) : 0,
      first: index === 0,
    };
    const old = kept.get(key);
    if (old && sameRow(old, next)) {
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return { key, ...next };
  });
  return changed ? rows : previous;
}

export function chatListSectionIds(
  rows: readonly ChatListRow<ChatListItem>[],
  previous: readonly string[],
): readonly string[] {
  const ids = rows.flatMap((row) => (row.item.kind === "section" ? [row.item.id] : []));
  return ids.length === previous.length && ids.every((id, index) => id === previous[index]) ? previous : ids;
}

export interface ChannelFace {
  id: string;
  serverId: string;
  name: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor: AvatarColor | null;
  avatarUrl?: string | null;
}

function sameChannelFace(previous: ChannelFace | undefined, next: ChannelFace): boolean {
  return (
    previous !== undefined &&
    previous.name === next.name &&
    previous.avatarSeed === next.avatarSeed &&
    previous.avatarHue === next.avatarHue &&
    previous.avatarColor === next.avatarColor &&
    previous.avatarUrl === next.avatarUrl
  );
}

export function channelAgentLookup<Agent extends ChannelFace>(
  previous: ReadonlyMap<string, Agent> | null,
  agents: readonly Agent[],
  serverId: string,
): ReadonlyMap<string, Agent> {
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  if (
    previous &&
    previous.size === serverAgents.length &&
    serverAgents.every((agent) => sameChannelFace(previous.get(agent.id), agent))
  )
    return previous;
  return new Map(serverAgents.map((agent) => [agent.id, agent]));
}
