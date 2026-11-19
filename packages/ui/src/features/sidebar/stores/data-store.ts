import {
  type ChannelSummary,
  SIDEBAR_FOLDER_LEVELS,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  sidebarFolderAncestors,
  sidebarFolderHeight,
  sidebarFolderParents,
} from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
import type { AgentProfile } from "../../../data";
import { currentText } from "../../../text";
import { teamMemberName } from "../../team/TeamPersonAvatar";
import { sidebarSectionResolver, sortByLayoutOrder } from "../sidebar-agent-order";
import {
  SIDEBAR_NO_LIST_FILTER,
  type SidebarChatFacts,
  type SidebarFolderNode,
  type SidebarListFilter,
  sidebarChatMatchesFilter,
  sidebarListFilterIsSet,
} from "../sidebar-list-filter";
import { sidebarPinnedItemKey } from "../sidebar-pins";
import type { ResolvedPinnedItem, SidebarChatItem, SidebarProps } from "../sidebar-types";

function sidebarChatActivity(at: string | null | undefined): number {
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

type PinnedItemSource = SidebarProps["agents"][number] | NonNullable<SidebarProps["channels"]>[number];

export function createSidebarDataStore(deps: {
  props: SidebarProps;
  dragActive: () => boolean;
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
  const userHiddenAt = createMemo(
    () => new Map((props.userHiddenAgents ?? []).map((entry) => [entry.agentId, entry.hiddenAt])),
  );
  const agentIsUserHidden = (agentId: string) => userHiddenAt().has(agentId);
  const personById = createMemo(() => new Map(props.people.map((member) => [member.id, member])));
  const channels = () => props.channels ?? [];
  const channelById = createMemo(() => new Map(channels().map((channel) => [channel.id, channel])));
  const [chosenListFilter, setListFilter] = createSignal<SidebarListFilter>(SIDEBAR_NO_LIST_FILTER);
  const listFilter = createMemo((): SidebarListFilter => {
    const filter = chosenListFilter();
    if (filter.folders.length === 0) return filter;
    const known = new Set(props.layout.sections.map((section) => section.id));
    const folders =
      known.size === 0 ? [] : filter.folders.filter((id) => id === SIDEBAR_UNASSIGNED_SECTION_ID || known.has(id));
    return folders.length === filter.folders.length ? filter : { ...filter, folders };
  });
  const listFiltered = createMemo(() => sidebarListFilterIsSet(listFilter()));
  let pinnedItemCache = new Map<string, { source: PinnedItemSource; item: ResolvedPinnedItem }>();
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
  const hiddenAgentWaits = (agentId: string) =>
    props.userHiddenAgentsWork === true && agentIsUserHidden(agentId) && chatWaits(agentId);
  const chatOrder = () => {
    const order = props.chatOrder ?? "manual";
    return order === "unread-group" && listFilter().folders.length > 0 ? "unread-first" : order;
  };
  const activeChatId = () => props.activeChannelId || props.activeAgentId || "";
  const sectionOfChat = createMemo(() => sidebarSectionResolver(props.layout));
  const filterFacts = createMemo(
    (): SidebarChatFacts[] => {
      const sectionOf = sectionOfChat();
      return [
        ...props.agents.map(
          (agent): SidebarChatFacts => ({
            id: agent.id,
            kind: "agent",
            folder: sectionOf(agent.id),
            unread: chatIsUnread(agent.id),
            working: agentWorks(agent.id),
          }),
        ),
        ...channels().map(
          (channel): SidebarChatFacts => ({
            id: channel.id,
            kind: "channel",
            folder: sectionOf(channel.id),
            unread: chatIsUnread(channel.id),
            working: false,
          }),
        ),
      ];
    },
    { lazy: true },
  );
  const agentWorks = (agentId: string) => {
    const state = props.agentStates[agentId];
    return state?.kind === "working" || (state?.kind === "routine" && state.phase === "running");
  };
  let heldShownKey = "";
  let heldShownFilter = SIDEBAR_NO_LIST_FILTER;
  const shownKey = createMemo(() => {
    const filter = listFilter();
    if (!listFiltered()) {
      heldShownKey = "";
      heldShownFilter = filter;
      return "";
    }
    const previous = new Set(heldShownFilter === filter && heldShownKey ? heldShownKey.split("\n") : []);
    const active = activeChatId();
    heldShownFilter = filter;
    heldShownKey = filterFacts()
      .filter(
        (chat) =>
          sidebarChatMatchesFilter(chat, filter) ||
          (chat.id === active && previous.has(chat.id) && deps.pointerInList()),
      )
      .map((chat) => chat.id)
      .sort()
      .join("\n");
    return heldShownKey;
  });
  const shownIds = createMemo(() => new Set(shownKey() ? shownKey().split("\n") : []));
  const chatShown = (chatId: string) => !listFiltered() || shownIds().has(chatId);
  const chatIsUnread = (chatId: string) => {
    const state = props.agentStates[chatId];
    return (state?.kind === "unread" && state.count > 0) || (channelById().get(chatId)?.unreadCount ?? 0) > 0;
  };
  const chatMovesWhenUnread = (chatId: string) => !(props.mutedAgentIds?.has(chatId) ?? false);
  let heldUnreadKey = "";
  const unreadKey = createMemo(() => {
    if (chatOrder() === "manual" || chatOrder() === "recent") {
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
  const chatInUnreadGroup = (chatId: string) =>
    chatOrder() === "unread-group" && unreadIds().has(chatId) && !chatWaits(chatId);
  const filteredAgents = createMemo(() =>
    listedAgents().filter((agent) => !chatWaits(agent.id) && !chatInUnreadGroup(agent.id) && chatShown(agent.id)),
  );
  const userHiddenAgentList = createMemo(() =>
    listFiltered()
      ? []
      : sortByLayoutOrder(
          props.agents.filter((agent) => agentIsUserHidden(agent.id) && !hiddenAgentWaits(agent.id)),
          props.layout.agentOrder,
        ),
  );
  const listedChannels = createMemo(() =>
    channels().filter((channel) => !pinnedKeys().has(sidebarPinnedItemKey({ kind: "channel", id: channel.id }))),
  );
  const filteredChannels = createMemo(() =>
    listedChannels().filter(
      (channel) => !chatWaits(channel.id) && !chatInUnreadGroup(channel.id) && chatShown(channel.id),
    ),
  );
  type ChatSource = AgentProfile | ChannelSummary;
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
  const byRecent = (items: SidebarChatItem[]) => {
    const activity = activityById();
    return [...items].sort((left, right) => (activity.get(right.id) ?? 0) - (activity.get(left.id) ?? 0));
  };
  const filteredChats = createChatItems(
    () => ({ channels: filteredChannels(), agents: filteredAgents() }),
    (items) => {
      if (chatOrder() === "recent") return byRecent(items);
      if (chatOrder() !== "unread-first") return items;
      const recent = byRecent(items);
      return [
        ...recent.filter((item) => unreadIds().has(item.id)),
        ...recent.filter((item) => !unreadIds().has(item.id)),
      ];
    },
  );
  const waitingChats = createChatItems(() => ({
    channels: listedChannels().filter((channel) => chatWaits(channel.id) && chatShown(channel.id)),
    agents: props.agents.filter(
      (agent) =>
        chatShown(agent.id) &&
        (agentIsUserHidden(agent.id)
          ? hiddenAgentWaits(agent.id)
          : chatWaits(agent.id) && !pinnedKeys().has(sidebarPinnedItemKey({ kind: "agent", id: agent.id }))),
    ),
  }));
  const unreadChats = createChatItems(
    () => ({
      channels: listedChannels().filter((channel) => chatInUnreadGroup(channel.id) && chatShown(channel.id)),
      agents: listedAgents().filter((agent) => chatInUnreadGroup(agent.id) && chatShown(agent.id)),
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
  let heldPeopleIds = new Set<string>();
  const shownPeople = createMemo(() => {
    const filter = listFilter();
    if (!listFiltered()) {
      heldPeopleIds = new Set();
      return orderedPeople();
    }
    const people =
      filter.show !== "all" || filter.folders.length > 0 || !filter.unread
        ? []
        : orderedPeople().filter(
            (member) =>
              (directThreadByMember().get(member.id)?.unreadCount ?? 0) > 0 ||
              (member.id === props.activeDirectMemberId && heldPeopleIds.has(member.id) && deps.pointerInList()),
          );
    heldPeopleIds = new Set(people.map((member) => member.id));
    return people;
  });
  const customSectionById = createMemo(() => new Map(props.layout.sections.map((section) => [section.id, section])));
  const collapsedSectionIds = createMemo(() => new Set(props.collapsedSectionIds));
  const filteredChatsBySection = createMemo(() => {
    const groups = new Map<string, SidebarChatItem[]>();
    const sectionOf = sectionOfChat();
    for (const item of filteredChats()) {
      const sectionId = sectionOf(item.id);
      groups.set(sectionId, [...(groups.get(sectionId) ?? []), item]);
    }
    return groups;
  });
  const folderParents = createMemo(() => sidebarFolderParents(props.layout));
  const foldersWithShownChats = createMemo(() => {
    if (!listFiltered()) return null;
    const folders = new Set<string>();
    for (const [sectionId, items] of filteredChatsBySection()) {
      if (items.length === 0) continue;
      folders.add(sectionId);
      for (const ancestorId of sidebarFolderAncestors(folderParents(), sectionId)) folders.add(ancestorId);
    }
    return folders;
  });
  const visibleSectionIds = createMemo(() =>
    props.layout.order.filter((sectionId) => {
      if (sectionId === SIDEBAR_PEOPLE_SECTION_ID) {
        return props.showPeople !== false && shownPeople().length > 0;
      }
      if (customSectionById().has(sectionId)) return foldersWithShownChats()?.has(sectionId) ?? true;
      if (sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID) return false;
      return (filteredChatsBySection().get(sectionId)?.length ?? 0) > 0;
    }),
  );
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

  function sectionDepth(sectionId: string): number {
    return sidebarFolderAncestors(folderParents(), sectionId).length;
  }

  function sectionIsInside(sectionId: string, ancestorId: string): boolean {
    return sectionId === ancestorId || sidebarFolderAncestors(folderParents(), sectionId).includes(ancestorId);
  }

  function sectionCanNest(sectionId: string, parentId: string | null): boolean {
    if (!customSectionById().has(sectionId)) return parentId === null;
    if (parentId === null) return true;
    if (!customSectionById().has(parentId) || sectionIsInside(parentId, sectionId)) return false;
    return sectionDepth(parentId) + 1 + sidebarFolderHeight(folderParents(), sectionId) < SIDEBAR_FOLDER_LEVELS;
  }

  function sectionChatIdsDeep(sectionId: string): string[] {
    return [
      ...(filteredChatsBySection().get(sectionId) ?? []).map((item) => item.id),
      ...sectionChildren(sectionId).flatMap(sectionChatIdsDeep),
    ];
  }

  function sectionChatCount(sectionId: string): number {
    return sectionChatIdsDeep(sectionId).length;
  }

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

  function assignedSectionId(chatId: string): string {
    const assigned = props.layout.agentAssignments[chatId];
    return assigned && customSectionById().has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
  }

  function chatName(chatId: string): string {
    return (
      agentById().get(chatId)?.name ??
      channelById().get(chatId)?.name ??
      currentText().t("sidebar.announce.chatFallback")
    );
  }

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

  const shownPinnedItems = createMemo(() =>
    listFiltered() ? resolvedPinnedItems().filter((item) => chatShown(item.chat.id)) : resolvedPinnedItems(),
  );

  function visiblePinnedKeys(): string[] {
    return shownPinnedItems().map((item) => sidebarPinnedItemKey(item.ref));
  }

  const filterFolders = createMemo(
    (): SidebarFolderNode[] => {
      if (props.layout.sections.length === 0) return [];
      const parents = folderParents();
      const build = (parentId: string | null): SidebarFolderNode[] =>
        props.layout.order
          .filter((sectionId) => customSectionById().has(sectionId) && (parents.get(sectionId) ?? null) === parentId)
          .map((sectionId) => ({
            id: sectionId,
            name: customSectionById().get(sectionId)?.name ?? "",
            children: build(sectionId),
          }));
      return [...build(null), { id: SIDEBAR_UNASSIGNED_SECTION_ID, name: null, children: [] }];
    },
    { lazy: true },
  );

  function listFilterCount(patch: Partial<SidebarListFilter>) {
    const filter = { ...listFilter(), ...patch };
    let count = 0;
    for (const chat of filterFacts()) {
      if (chat.kind === "agent" && agentIsUserHidden(chat.id) && !hiddenAgentWaits(chat.id)) continue;
      if (sidebarChatMatchesFilter(chat, filter)) count += 1;
    }
    if (props.showPeople !== false && filter.show === "all" && filter.folders.length === 0) {
      for (const member of props.people) {
        const unread = (directThreadByMember().get(member.id)?.unreadCount ?? 0) > 0;
        if (filter.unread ? unread : !filter.working) count += 1;
      }
    }
    return count;
  }

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
    filterFolders,
    filteredAgents,
    filteredChannels,
    filteredChats,
    filteredChatsBySection,
    listFilter,
    listFilterCount,
    listFiltered,
    orderedPeople,
    personById,
    resolvedPinnedItems: shownPinnedItems,
    sectionAcceptsChat,
    sectionCanNest,
    sectionChatCount,
    sectionChildren,
    sectionIsCollapsed,
    sectionIsInside,
    sectionParent,
    sectionLabel,
    sectionPosition,
    sectionUnreadCount,
    setListFilter,
    shownPeople,
    unreadChats,
    visiblePinnedKeys,
    userHiddenAgentList,
    userHiddenSince,
    visibleSectionIds,
    waitingChats,
  };
}
