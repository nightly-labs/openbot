/**
 * Every read projection the sidebar renders and drags against: the props sorted, grouped
 * and indexed. Nothing here mutates and nothing here calls a prop callback, which is what makes it
 * safe for the drag engine to hold - it satisfies the engine's list model and can do nothing else.
 */

import {
  type ChannelSummary,
  SIDEBAR_FOLDER_LEVELS,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  sidebarFolderAncestors,
  sidebarFolderHeight,
  sidebarFolderParents,
} from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import type { AgentProfile } from "../../../data";
import { currentText } from "../../../text";
import { teamMemberName } from "../../team/TeamPersonAvatar";
import { sidebarSectionResolver, sortByLayoutOrder } from "../sidebar-agent-order";
import { sidebarPinnedItemKey } from "../sidebar-pins";
import type { ResolvedPinnedItem, SidebarChatItem, SidebarProps } from "../sidebar-types";

/** When a chat last had activity, in epoch milliseconds: the agent's last update, or the channel's last message. */
function sidebarChatActivity(at: string | null | undefined): number {
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

type PinnedItemSource = SidebarProps["agents"][number] | NonNullable<SidebarProps["channels"]>[number];

export function createSidebarDataStore(deps: {
  props: SidebarProps;
  /** True while a sidebar drag is in flight. */
  dragActive: () => boolean;
  /** True while a mouse or pen is over the list or over a menu that is open on it. */
  pointerInList: () => boolean;
}) {
  const { props } = deps;

  const directThreadByMember = createMemo(
    () => new Map(props.directThreads.map((thread) => [thread.otherMemberId, thread])),
  );
  const chatPinnedItems = createMemo(() =>
    props.pinnedItems.filter((item) => item.kind === "agent" || item.kind === "channel"),
  );
  const pinnedKeys = createMemo(() => new Set(chatPinnedItems().map(sidebarPinnedItemKey)));
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  /** When the user hid each agent, by agent id. An agent that is not in it is not hidden. */
  const userHiddenAt = createMemo(
    () => new Map((props.userHiddenAgents ?? []).map((entry) => [entry.agentId, entry.hiddenAt])),
  );
  const agentIsUserHidden = (agentId: string) => userHiddenAt().has(agentId);
  const personById = createMemo(() => new Map(props.people.map((member) => [member.id, member])));
  const channels = () => props.channels ?? [];
  const channelById = createMemo(() => new Map(channels().map((channel) => [channel.id, channel])));
  let pinnedItemCache = new Map<string, { source: PinnedItemSource; item: ResolvedPinnedItem }>();
  /** Both kinds of pinned chat, resolved against the chats the sidebar has: a pin that names none is
   * kept in storage and simply not drawn, because the chat can be absent for a passing reason.
   *
   * Keep a resolved wrapper while its source chat is the same store. Solid's `For` keys by object
   * identity, so rebuilding every wrapper for an unrelated profile update remounted all pinned
   * tiles and replayed the unread-badge entrance animation. */
  const resolvedPinnedItems = createMemo<ResolvedPinnedItem[]>(() => {
    const items: ResolvedPinnedItem[] = [];
    const nextCache = new Map<string, { source: PinnedItemSource; item: ResolvedPinnedItem }>();
    const resolve = (ref: ResolvedPinnedItem["ref"], source: PinnedItemSource, item: ResolvedPinnedItem) => {
      const key = sidebarPinnedItemKey(ref);
      const cached = pinnedItemCache.get(key);
      const resolved = cached?.source === source ? cached.item : item;
      nextCache.set(key, { source, item: resolved });
      return resolved;
    };
    for (const ref of chatPinnedItems()) {
      if (ref.kind === "agent") {
        const agent = agentById().get(ref.id);
        // A hidden agent keeps its pin, so a restore puts it back in the strip.
        if (agent && !agentIsUserHidden(agent.id))
          items.push(resolve(ref, agent, { ref, chat: { kind: "agent", id: agent.id, agent } }));
      }
      if (ref.kind === "channel") {
        const channel = channelById().get(ref.id);
        if (channel) items.push(resolve(ref, channel, { ref, chat: { kind: "channel", id: channel.id, channel } }));
      }
    }
    pinnedItemCache = nextCache;
    return items;
  });
  const listedAgents = createMemo(() =>
    props.agents.filter(
      (agent) =>
        !agentIsUserHidden(agent.id) && !pinnedKeys().has(sidebarPinnedItemKey({ kind: "agent", id: agent.id })),
    ),
  );
  /**
   * Agents and channels that wait for the user leave their section for the "Needs you" group, the
   * same way a pinned chat leaves it for the pinned strip. The layout keeps their place, so a chat
   * goes back to it when the wait ends. A pinned chat stays in its tile, which shows the same badge.
   *
   * The set is keyed by a string so that a badge change that keeps the same agents waiting stops
   * here. Without it, each new reply would rebuild the chat items and remount every row.
   *
   * The set holds still during a drag. The drag engine measures the rows when the drag starts, so a
   * row that moved to the group after that would make the drop land at an old position, and the
   * dragged row itself would leave the DOM.
   */
  let heldWaitingKey = "";
  const waitingKey = createMemo(() => {
    const next = [
      ...Object.keys(props.agentStates).filter((agentId) => props.agentStates[agentId]?.kind === "waiting"),
      ...Object.keys(props.channelWaits ?? {}),
    ]
      .sort()
      .join("\n");
    if (!deps.dragActive()) heldWaitingKey = next;
    return heldWaitingKey;
  });
  const waitingIds = createMemo(() => new Set(waitingKey() ? waitingKey().split("\n") : []));
  const chatWaits = (chatId: string) => waitingIds().has(chatId);
  /** A hidden agent at work that waits for the user. It shows in "Needs you", not in the "Hidden" group. */
  const hiddenAgentWaits = (agentId: string) =>
    props.userHiddenAgentsWork === true && agentIsUserHidden(agentId) && chatWaits(agentId);
  const chatOrder = () => props.chatOrder ?? "manual";
  const activeChatId = () => props.activeChannelId || props.activeAgentId || "";
  /**
   * A chat with unread messages of its own. An agent whose only unread messages are in side threads
   * has an unread mark with no number. Opening its chat does not clear that mark, and a routine thread
   * sets it again at each run, so the mark alone does not move the agent in an unread order.
   */
  const chatIsUnread = (chatId: string) => {
    const state = props.agentStates[chatId];
    return (state?.kind === "unread" && state.count > 0) || (channelById().get(chatId)?.unreadCount ?? 0) > 0;
  };
  /**
   * A muted agent keeps its place in its section in each order. The user muted it because its replies
   * are not important, so its unread replies show only as the badge on its row.
   */
  const chatMovesWhenUnread = (chatId: string) => !(props.mutedAgentIds?.has(chatId) ?? false);
  /**
   * The chats that an unread order puts first: the unread chats that are not muted, and the open chat
   * when it was in the set before and the pointer is over the list. The open chat keeps its place
   * while the pointer is there, so that a row does not move away under the pointer when the user reads
   * it. When the pointer leaves the list, the read chat goes back to its section. Without this, a chat
   * that the user reads and keeps open stays in the unread set until the user opens another chat. The
   * manual order has none.
   *
   * The key is a string and holds still during a drag, for the same reasons as `waitingKey`.
   */
  let heldUnreadKey = "";
  const unreadKey = createMemo(() => {
    if (chatOrder() === "manual") {
      heldUnreadKey = "";
      return "";
    }
    const previous = new Set(heldUnreadKey ? heldUnreadKey.split("\n") : []);
    const active = activeChatId();
    const next = [...props.agents.map((agent) => agent.id), ...channels().map((channel) => channel.id)]
      .filter(
        (chatId) =>
          chatMovesWhenUnread(chatId) &&
          (chatIsUnread(chatId) || (chatId === active && previous.has(chatId) && deps.pointerInList())),
      )
      .sort()
      .join("\n");
    if (!deps.dragActive()) heldUnreadKey = next;
    return heldUnreadKey;
  });
  const unreadIds = createMemo(() => new Set(unreadKey() ? unreadKey().split("\n") : []));
  /** The "Unread" group takes a chat out of its section, as "Needs you" does. A waiting chat stays in "Needs you". */
  const chatInUnreadGroup = (chatId: string) =>
    chatOrder() === "unread-group" && unreadIds().has(chatId) && !chatWaits(chatId);
  const filteredAgents = createMemo(() =>
    listedAgents().filter((agent) => !chatWaits(agent.id) && !chatInUnreadGroup(agent.id)),
  );
  /**
   * The hidden agents, pinned ones included, in their layout order. They are not drag sources. One
   * that waits for the user is in "Needs you" until the wait ends.
   */
  const userHiddenAgentList = createMemo(() =>
    sortByLayoutOrder(
      props.agents.filter((agent) => agentIsUserHidden(agent.id) && !hiddenAgentWaits(agent.id)),
      props.layout.agentOrder,
    ),
  );
  const listedChannels = createMemo(() =>
    channels().filter((channel) => !pinnedKeys().has(sidebarPinnedItemKey({ kind: "channel", id: channel.id }))),
  );
  const filteredChannels = createMemo(() =>
    listedChannels().filter((channel) => !chatWaits(channel.id) && !chatInUnreadGroup(channel.id)),
  );
  /**
   * Agents and channels as one ordered list, because the layout places them together: a channel is a
   * chat the user files and drags exactly like an agent. `agentOrder` is the persisted sequence and
   * keeps its released name; an id it does not carry yet falls in behind the ones it does, channels
   * first, which is where channels sat while they had a list of their own.
   */
  type ChatSource = AgentProfile | ChannelSummary;
  /**
   * Keep each wrapper while its chat is the same store, as `resolvedPinnedItems` does: a chat that
   * starts or stops waiting must not remount the rows of every other chat.
   */
  function createChatItems(
    sources: () => { channels: ChannelSummary[]; agents: AgentProfile[] },
    sort: (items: SidebarChatItem[]) => SidebarChatItem[] = (items) => items,
  ) {
    let cache = new Map<ChatSource, SidebarChatItem>();
    return createMemo<SidebarChatItem[]>(() => {
      const nextCache = new Map<ChatSource, SidebarChatItem>();
      const keep = (source: ChatSource, item: () => SidebarChatItem) => {
        const resolved = cache.get(source) ?? item();
        nextCache.set(source, resolved);
        return resolved;
      };
      const current = sources();
      const items = sort(
        sortByLayoutOrder<SidebarChatItem>(
          [
            ...current.channels.map((channel) => keep(channel, () => ({ kind: "channel", id: channel.id, channel }))),
            ...current.agents.map((agent) => keep(agent, () => ({ kind: "agent", id: agent.id, agent }))),
          ],
          props.layout.agentOrder,
        ),
      );
      cache = nextCache;
      return items;
    });
  }
  /**
   * The last activity of each chat, for the unread orders. The key holds still during a drag, for the
   * same reasons as `waitingKey`: a reply that arrives during a drag must not move the rows.
   */
  let heldActivityKey = "";
  const activityKey = createMemo(() => {
    if (chatOrder() === "manual") {
      heldActivityKey = "";
      return "";
    }
    const next = [
      ...props.agents.map((agent) => `${agent.id}\t${sidebarChatActivity(agent.updatedAt)}`),
      ...channels().map(
        (channel) => `${channel.id}\t${sidebarChatActivity(channel.lastMessage?.at ?? channel.createdAt)}`,
      ),
    ].join("\n");
    if (!deps.dragActive()) heldActivityKey = next;
    return heldActivityKey;
  });
  const activityById = createMemo(
    () =>
      new Map(
        (activityKey() ? activityKey().split("\n") : []).map((entry) => {
          const [chatId = "", time = "0"] = entry.split("\t");
          return [chatId, Number(time)] as const;
        }),
      ),
  );
  /** The most recent chat first. The sort is stable, so chats with the same time keep their layout order. */
  const byRecent = (items: SidebarChatItem[]) => {
    const activity = activityById();
    return [...items].sort((left, right) => (activity.get(right.id) ?? 0) - (activity.get(left.id) ?? 0));
  };
  /**
   * The chats in the sections. In the "unread first" order, each section shows its unread chats first
   * and then the others, both by their last activity. The saved `agentOrder` does not change.
   */
  const filteredChats = createChatItems(
    () => ({ channels: filteredChannels(), agents: filteredAgents() }),
    (items) => {
      if (chatOrder() !== "unread-first") return items;
      const recent = byRecent(items);
      return [
        ...recent.filter((item) => unreadIds().has(item.id)),
        ...recent.filter((item) => !unreadIds().has(item.id)),
      ];
    },
  );
  /** The "Needs you" group, in the order the chats have in the layout. */
  const waitingChats = createChatItems(() => ({
    channels: listedChannels().filter((channel) => chatWaits(channel.id)),
    agents: props.agents.filter((agent) =>
      agentIsUserHidden(agent.id)
        ? hiddenAgentWaits(agent.id)
        : chatWaits(agent.id) && !pinnedKeys().has(sidebarPinnedItemKey({ kind: "agent", id: agent.id })),
    ),
  }));
  /** The "Unread" group of the "unread in a group" order, by last activity. */
  const unreadChats = createChatItems(
    () => ({
      channels: listedChannels().filter((channel) => chatInUnreadGroup(channel.id)),
      agents: listedAgents().filter((agent) => chatInUnreadGroup(agent.id)),
    }),
    byRecent,
  );
  const orderedPeople = createMemo(() => {
    const natural = [...props.people].sort((left, right) => {
      const leftThread = directThreadByMember().get(left.id);
      const rightThread = directThreadByMember().get(right.id);
      if (leftThread || rightThread) {
        return (rightThread?.updatedAt ?? "").localeCompare(leftThread?.updatedAt ?? "");
      }
      if (left.online !== right.online) return left.online ? -1 : 1;
      return teamMemberName(left).localeCompare(teamMemberName(right));
    });
    const orderIndex = new Map(props.peopleOrder.map((memberId, index) => [memberId, index]));
    const naturalIndex = new Map(natural.map((member, index) => [member.id, index]));
    return natural.sort(
      (left, right) =>
        (orderIndex.get(left.id) ?? props.peopleOrder.length + (naturalIndex.get(left.id) ?? 0)) -
        (orderIndex.get(right.id) ?? props.peopleOrder.length + (naturalIndex.get(right.id) ?? 0)),
    );
  });
  const customSectionById = createMemo(() => new Map(props.layout.sections.map((section) => [section.id, section])));
  const collapsedSectionIds = createMemo(() => new Set(props.collapsedSectionIds));
  // A section has to be in `order` as well as in `sections` for its group to be drawn, because
  // `visibleSectionIds` walks `order`. An agent grouped under a section that `order` leaves out is on
  // no screen while its chat and every message in it are intact, which reads as history that
  // disappeared -- so it goes to the unassigned section, where the user can still open it and move it.
  // `isCompleteSectionOrder` rejects such a layout at the IPC boundary; this keeps the agent visible if
  // one ever reaches the sidebar another way. `sidebarSectionResolver` holds the rule.
  const filteredChatsBySection = createMemo(() => {
    const groups = new Map<string, SidebarChatItem[]>();
    const sectionOf = sidebarSectionResolver(props.layout);
    for (const item of filteredChats()) {
      const sectionId = sectionOf(item.id);
      groups.set(sectionId, [...(groups.get(sectionId) ?? []), item]);
    }
    return groups;
  });
  const visibleSectionIds = createMemo(() =>
    props.layout.order.filter((sectionId) => {
      if (sectionId === SIDEBAR_PEOPLE_SECTION_ID) return props.showPeople !== false && orderedPeople().length > 0;
      if (customSectionById().has(sectionId)) return true;
      if (sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID) return false;
      return (filteredChatsBySection().get(sectionId)?.length ?? 0) > 0;
    }),
  );

  /** The folder that holds each folder that has one. */
  const folderParents = createMemo(() => sidebarFolderParents(props.layout));
  /** The visible sections in each folder, and at the top (`null`), in the order of the layout. */
  const folderChildren = createMemo(() => {
    const children = new Map<string | null, string[]>();
    for (const sectionId of visibleSectionIds()) {
      const parentId = folderParents().get(sectionId) ?? null;
      children.set(parentId, [...(children.get(parentId) ?? []), sectionId]);
    }
    return children;
  });

  function sectionChildren(parentId: string | null): string[] {
    return folderChildren().get(parentId) ?? [];
  }

  function sectionParent(sectionId: string): string | null {
    return folderParents().get(sectionId) ?? null;
  }

  /** 0 for a folder at the top of the list. */
  function sectionDepth(sectionId: string): number {
    return sidebarFolderAncestors(folderParents(), sectionId).length;
  }

  /** True when `sectionId` is `ancestorId` or a folder in it, at any level. */
  function sectionIsInside(sectionId: string, ancestorId: string): boolean {
    return sectionId === ancestorId || sidebarFolderAncestors(folderParents(), sectionId).includes(ancestorId);
  }

  /**
   * Whether a folder can go into `parentId` (null: the top of the list): not into itself or a folder
   * in it, and three levels at most with the folders it holds.
   */
  function sectionCanNest(sectionId: string, parentId: string | null): boolean {
    if (!customSectionById().has(sectionId)) return parentId === null;
    if (parentId === null) return true;
    if (!customSectionById().has(parentId) || sectionIsInside(parentId, sectionId)) return false;
    return sectionDepth(parentId) + 1 + sidebarFolderHeight(folderParents(), sectionId) < SIDEBAR_FOLDER_LEVELS;
  }

  /** The chats in a folder and in the folders in it, for the count on a closed folder. */
  function sectionChatIdsDeep(sectionId: string): string[] {
    return [
      ...(filteredChatsBySection().get(sectionId) ?? []).map((item) => item.id),
      ...sectionChildren(sectionId).flatMap(sectionChatIdsDeep),
    ];
  }

  /** The unread messages in a folder and in the folders in it, for the badge on a closed folder. */
  function sectionUnreadCount(sectionId: string): number {
    let count = 0;
    for (const chatId of sectionChatIdsDeep(sectionId)) {
      const state = props.agentStates[chatId];
      if (state?.kind === "unread") count += state.count;
      count += channelById().get(chatId)?.unreadCount ?? 0;
    }
    return count;
  }

  function sectionIsCollapsed(sectionId: string): boolean {
    return collapsedSectionIds().has(sectionId);
  }

  function sectionPosition(sectionId: string): number {
    return visibleSectionIds().indexOf(sectionId);
  }

  function sectionAcceptsChat(sectionId: string): boolean {
    return sectionId === SIDEBAR_UNASSIGNED_SECTION_ID || customSectionById().has(sectionId);
  }

  /**
   * The section a dragged chat counts as leaving. Deliberately not the menu's `currentSectionId`,
   * which answers `null` for an unassigned chat because that is where its tick goes.
   */
  function assignedSectionId(chatId: string): string {
    const assigned = props.layout.agentAssignments[chatId];
    return assigned && customSectionById().has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
  }

  /** The name for an announcement, whichever kind of chat the id belongs to. */
  function chatName(chatId: string): string {
    return (
      agentById().get(chatId)?.name ??
      channelById().get(chatId)?.name ??
      currentText().t("sidebar.announce.chatFallback")
    );
  }

  /** Which kind of chat an id names, or null when the sidebar shows no chat under it. */
  function chatKind(chatId: string): "agent" | "channel" | null {
    if (agentById().has(chatId)) return "agent";
    return channelById().has(chatId) ? "channel" : null;
  }

  function sectionLabel(sectionId: string): string {
    const { t } = currentText();
    if (sectionId === SIDEBAR_PEOPLE_SECTION_ID) return t("sidebar.section.people");
    if (sectionId === SIDEBAR_UNASSIGNED_SECTION_ID) return t("sidebar.section.unassigned");
    const names = sidebarFolderAncestors(folderParents(), sectionId).flatMap((ancestorId) => {
      const name = customSectionById().get(ancestorId)?.name;
      return name === undefined ? [] : [name];
    });
    return [...names, customSectionById().get(sectionId)?.name ?? t("sidebar.section.fallback")].join(" / ");
  }

  function visiblePinnedKeys(): string[] {
    return resolvedPinnedItems().map((item) => sidebarPinnedItemKey(item.ref));
  }

  /** The ISO time when the user hid the agent, or undefined when the agent is not hidden. */
  function userHiddenSince(agentId: string): string | undefined {
    return userHiddenAt().get(agentId);
  }

  return {
    assignedSectionId,
    agentById,
    channelById,
    chatIsUnread,
    chatKind,
    chatName,
    chatPinnedItems,
    customSectionById,
    directThreadByMember,
    filteredAgents,
    filteredChannels,
    filteredChats,
    filteredChatsBySection,
    orderedPeople,
    personById,
    resolvedPinnedItems,
    sectionAcceptsChat,
    sectionCanNest,
    sectionChildren,
    sectionIsCollapsed,
    sectionIsInside,
    sectionParent,
    sectionLabel,
    sectionPosition,
    sectionUnreadCount,
    unreadChats,
    visiblePinnedKeys,
    userHiddenAgentList,
    userHiddenSince,
    visibleSectionIds,
    waitingChats,
  };
}
