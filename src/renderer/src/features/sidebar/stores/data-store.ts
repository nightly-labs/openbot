/**
 * Every read projection the sidebar renders and drags against: the props filtered, sorted, grouped
 * and indexed. Nothing here mutates and nothing here calls a prop callback, which is what makes it
 * safe for the drag engine to hold - it satisfies the engine's list model and can do nothing else.
 */

import { SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import { teamMemberName } from "../../team/TeamPersonAvatar";
import { agentMatchesQuery, channelMatchesQuery, personMatchesQuery } from "../sidebar-filtering";
import { sidebarPinnedItemKey } from "../sidebar-pins";
import type { ResolvedPinnedItem, SidebarChatItem, SidebarProps } from "../sidebar-types";

export function createSidebarDataStore(deps: { normalizedQuery: () => string; props: SidebarProps }) {
  const { normalizedQuery, props } = deps;

  const directThreadByMember = createMemo(
    () => new Map(props.directThreads.map((thread) => [thread.otherMemberId, thread])),
  );
  const chatPinnedItems = createMemo(() =>
    props.pinnedItems.filter((item) => item.kind === "agent" || item.kind === "channel"),
  );
  const pinnedKeys = createMemo(() => new Set(chatPinnedItems().map(sidebarPinnedItemKey)));
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const personById = createMemo(() => new Map(props.people.map((member) => [member.id, member])));
  const matchingChannels = createMemo(() =>
    (props.channels ?? []).filter((channel) => channelMatchesQuery(channel, normalizedQuery())),
  );
  const channelById = createMemo(() => new Map(matchingChannels().map((channel) => [channel.id, channel])));
  /** Both kinds of pinned chat, resolved against the chats the sidebar has: a pin that names none is
   * kept in storage and simply not drawn, because the chat can be absent for a passing reason. */
  const resolvedPinnedItems = createMemo<ResolvedPinnedItem[]>(() => {
    const items: ResolvedPinnedItem[] = [];
    for (const ref of chatPinnedItems()) {
      if (ref.kind === "agent") {
        const agent = agentById().get(ref.id);
        if (agent && agentMatchesQuery(agent, normalizedQuery())) {
          items.push({ ref, chat: { kind: "agent", id: agent.id, agent } });
        }
      }
      if (ref.kind === "channel") {
        const channel = channelById().get(ref.id);
        if (channel) items.push({ ref, chat: { kind: "channel", id: channel.id, channel } });
      }
    }
    return items;
  });
  const filteredAgents = createMemo(() =>
    props.agents.filter(
      (agent) =>
        !pinnedKeys().has(sidebarPinnedItemKey({ kind: "agent", id: agent.id })) &&
        agentMatchesQuery(agent, normalizedQuery()),
    ),
  );
  const filteredChannels = createMemo(() =>
    matchingChannels().filter(
      (channel) => !pinnedKeys().has(sidebarPinnedItemKey({ kind: "channel", id: channel.id })),
    ),
  );
  /**
   * Agents and channels as one ordered list, because the layout places them together: a channel is a
   * chat the user files and drags exactly like an agent. `agentOrder` is the persisted sequence and
   * keeps its released name; an id it does not carry yet falls in behind the ones it does, channels
   * first, which is where channels sat while they had a list of their own.
   */
  const filteredChats = createMemo<SidebarChatItem[]>(() => {
    const items: SidebarChatItem[] = [
      ...filteredChannels().map((channel) => ({ kind: "channel", id: channel.id, channel }) as const),
      ...filteredAgents().map((agent) => ({ kind: "agent", id: agent.id, agent }) as const),
    ];
    const orderIndex = new Map(props.layout.agentOrder.map((chatId, index) => [chatId, index]));
    const naturalIndex = new Map(items.map((item, index) => [item.id, index]));
    return items.sort(
      (left, right) =>
        (orderIndex.get(left.id) ?? props.layout.agentOrder.length + (naturalIndex.get(left.id) ?? 0)) -
        (orderIndex.get(right.id) ?? props.layout.agentOrder.length + (naturalIndex.get(right.id) ?? 0)),
    );
  });
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
  const filteredPeople = createMemo(() =>
    orderedPeople().filter((member) => {
      const thread = directThreadByMember().get(member.id);
      return personMatchesQuery(member, thread, normalizedQuery());
    }),
  );
  const customSectionById = createMemo(() => new Map(props.layout.sections.map((section) => [section.id, section])));
  const collapsedSectionIds = createMemo(() => new Set(props.collapsedSectionIds));
  const orderedSectionIds = createMemo(() => new Set(props.layout.order));
  // A section has to be in `order` as well as in `sections` for its group to be drawn, because
  // `visibleSectionIds` walks `order`. An agent grouped under a section that `order` leaves out is on
  // no screen while its chat and every message in it are intact, which reads as history that
  // disappeared -- so it goes to the unassigned section, where the user can still open it and move it.
  // `isCompleteSectionOrder` rejects such a layout at the IPC boundary; this keeps the agent visible if
  // one ever reaches the sidebar another way.
  const filteredChatsBySection = createMemo(() => {
    const groups = new Map<string, SidebarChatItem[]>();
    for (const item of filteredChats()) {
      const assigned = props.layout.agentAssignments[item.id];
      const sectionId =
        assigned && customSectionById().has(assigned) && orderedSectionIds().has(assigned)
          ? assigned
          : SIDEBAR_UNASSIGNED_SECTION_ID;
      groups.set(sectionId, [...(groups.get(sectionId) ?? []), item]);
    }
    return groups;
  });
  const visibleSectionIds = createMemo(() =>
    props.layout.order.filter((sectionId) => {
      if (sectionId === SIDEBAR_PEOPLE_SECTION_ID) return props.showPeople !== false && filteredPeople().length > 0;
      if (customSectionById().has(sectionId)) {
        return !normalizedQuery() || (filteredChatsBySection().get(sectionId)?.length ?? 0) > 0;
      }
      if (sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID) return false;
      return (filteredChatsBySection().get(sectionId)?.length ?? 0) > 0;
    }),
  );

  function sectionIsCollapsed(sectionId: string): boolean {
    return !normalizedQuery() && collapsedSectionIds().has(sectionId);
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
    return agentById().get(chatId)?.name ?? channelById().get(chatId)?.name ?? "chat";
  }

  /** Which kind of chat an id names, or null when the sidebar shows no chat under it. */
  function chatKind(chatId: string): "agent" | "channel" | null {
    if (agentById().has(chatId)) return "agent";
    return channelById().has(chatId) ? "channel" : null;
  }

  function sectionLabel(sectionId: string): string {
    if (sectionId === SIDEBAR_PEOPLE_SECTION_ID) return "People";
    if (sectionId === SIDEBAR_UNASSIGNED_SECTION_ID) return "Unassigned";
    return customSectionById().get(sectionId)?.name ?? "Section";
  }

  function visiblePinnedKeys(): string[] {
    return resolvedPinnedItems().map((item) => sidebarPinnedItemKey(item.ref));
  }

  return {
    assignedSectionId,
    agentById,
    channelById,
    chatKind,
    chatName,
    chatPinnedItems,
    customSectionById,
    directThreadByMember,
    filteredAgents,
    filteredChannels,
    filteredChats,
    filteredChatsBySection,
    filteredPeople,
    orderedPeople,
    personById,
    resolvedPinnedItems,
    sectionAcceptsChat,
    sectionIsCollapsed,
    sectionLabel,
    sectionPosition,
    visiblePinnedKeys,
    visibleSectionIds,
  };
}
