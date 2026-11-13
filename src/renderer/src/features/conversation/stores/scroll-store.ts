import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import type { AgentMessage } from "@openbot/ui/data";
import type { RoutineRunToggleMarkerModel } from "@openbot/ui/features/conversation/ChatActionMarker";
import {
  calculateChatScrollMargin,
  chatHistoryBoundaryReached,
  createChatVirtualizer,
} from "@openbot/ui/features/conversation/createChatVirtualizer";
import { scrollToLatestMessage } from "@openbot/ui/features/conversation/MessageNavigation";
import {
  anchorNewMessages,
  countableTimelineMessage,
  type NewMessageTally,
  silentAgentAnswer,
  tallyNewMessages,
} from "@openbot/ui/features/conversation/new-message-tally";
import {
  scrollToUnreadBoundary,
  unreadMessagesDividerIsVisible,
} from "@openbot/ui/features/conversation/UnreadMessages";
import { currentText } from "@openbot/ui/text";
import type { VirtualItem } from "@tanstack/virtual-core";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { formatMessageTime } from "../../../app-message-projection";
import { groupAgentMessageMarkers, markOpenAgentMessages, teammateUpdateAnswers } from "../agent-message-timeline";
import type { ConversationProps, ConversationTarget } from "../conversation-types";
import { summarizeHostedSiteMessages } from "../hosted-site-timeline";
import { narrationRows, placeTurnRowsByTime, placeUpdatesAfterSteers } from "../narration-rows";
import {
  expandRoutineRunGroups,
  groupRoutineRunMarkers,
  placeRoutineRunTurns,
  type RoutineRunOpenState,
  routineRunToggleKey,
  routineRunTurnMessages,
  summarizeRoutineRunMessages,
} from "../routine-run-timeline";
import { groupSkillInstallMarkers } from "../skill-install-timeline";
import { isTurnAnswer } from "../turn-steps";
import { conversationOwnerId } from "./composer-store";

interface ScrollElements {
  scrollElement: () => HTMLDivElement | undefined;
  virtualRoot: () => HTMLDivElement | undefined;
  unreadMessagesDivider: () => HTMLDivElement | undefined;
}

interface ScrollStickyState {
  getStickToLatest: () => boolean;
  setStickToLatest: (value: boolean) => void;
  getCurrentUnreadCount: () => number;
  /** Moves a following reader to the newest message. */
  followLatest: (element: HTMLDivElement) => void;
}

export interface ScrollStoreDeps {
  props: ConversationProps;
  markingRead: () => boolean;
  setMarkingRead: (reading: boolean) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  /** The user's messages the host has not drawn yet. They follow the transcript. */
  pendingMessages: () => AgentMessage[];
  /** The row key of each sent message whose pending row drew it first, by host message id. */
  handedOverRowKeys: () => ReadonlyMap<string, string>;
  elements: ScrollElements;
  sticky: ScrollStickyState;
}

export function createScrollStore(deps: ScrollStoreDeps) {
  const scrollFades = createScrollFades();
  const [virtualScrollMargin, setVirtualScrollMargin] = createSignal(0);
  const [showScrollToLatest, setShowScrollToLatest] = createSignal(false);
  const [atHistoryBoundary, setAtHistoryBoundary] = createSignal(false);
  const [unreadDividerVisible, setUnreadDividerVisible] = createSignal(false);
  const [newMessageCount, setNewMessageCount] = createSignal(0);
  let unreadVisibilityFrame: number | undefined;
  let firstRenderedIndex = 0;
  let newMessages: NewMessageTally = { count: 0, anchorId: undefined };
  let talliedConversationIdentity: string | undefined;

  const [openRoutineRuns, setOpenRoutineRuns] = createSignal<RoutineRunOpenState>(new Map());
  // The thinking and the memory changes of a turn show in the steps above its answer. A turn with
  // no answer shows its memory changes in a row of their own. A turn with no answer and no memory
  // changes, such as a stopped one, shows its thinking in that row. A running turn shows its steps
  // under the activity line, and a turn that ends with no text on purpose shows none.
  const answeredTurns = createMemo(
    () => new Set(deps.props.messages.flatMap((message) => (isTurnAnswer(message) ? [message.turnId] : []))),
  );
  const thinkingRowHiddenTurns = createMemo(
    () =>
      new Set([
        ...answeredTurns(),
        ...deps.props.messages.flatMap((message) =>
          message.kind === "memory-changes" || silentAgentAnswer(message) ? [message.turnId] : [],
        ),
        deps.props.activeTurnId ?? undefined,
        ...(deps.props.channel?.workingTurns() ?? []),
      ]),
  );
  // A channel folds the text that a member writes after its answer into the steps, such as a "Done."
  // (channel-service). It is not progress, so it stays in the steps. A file that the agent attaches
  // while it works has no text and does not end the turn.
  const channelAnswerTimes = createMemo(() => {
    const times = new Map<string, string>();
    if (!deps.props.channel) return times;
    for (const message of deps.props.messages)
      if (
        message.turnId &&
        message.createdAt &&
        message.body.trim() &&
        isTurnAnswer(message) &&
        !times.has(message.turnId)
      )
        times.set(message.turnId, message.createdAt);
    return times;
  });
  /*
   * In Natural, a member's progress notes show as its own messages, as in an agent chat: a member can
   * say "I'll check the shared folder first" and then answer. Each note waits until it is complete
   * (`held`), so it enters as one bubble and does not grow.
   */
  const progressRows = (thinking: AgentMessage): AgentMessage[] => {
    const channel = deps.props.channel;
    if (!channel) return narrationRows(thinking, deps.props.agent?.provider);
    // A channel row names its member, so the member's provider tells its narration from its thinking.
    const answeredAt = thinking.turnId ? channelAnswerTimes().get(thinking.turnId) : undefined;
    return narrationRows(thinking, channel.author(thinking).agent?.provider).filter(
      (row) => !answeredAt || !row.createdAt || row.createdAt <= answeredAt,
    );
  };
  /** The agents that write in the channel now. Their text that still arrives waits until it is complete. */
  const channelWriters = createMemo(() => new Set(deps.props.channel?.workers().map((worker) => worker.id) ?? []));
  /*
   * Only the text of a member that works waits. A view keeps the copy of an older message that it
   * loaded, so a copy loaded while it streamed can stay "streaming" after its task ends (#4846), and
   * it must not stay hidden.
   */
  const held = (message: AgentMessage): boolean =>
    heldWhileWritten(message) &&
    (!deps.props.channel || (message.senderAgentId !== undefined && channelWriters().has(message.senderAgentId)));
  /* The quiet answers of a teammate update show under its marker, so they have no row of their own. */
  const updateAnswers = createMemo(() => teammateUpdateAnswers(deps.props.messages));
  const foldedAnswerIds = createMemo(
    () => new Set([...updateAnswers().values()].flatMap((answers) => answers.map((answer) => answer.id))),
  );
  const shownMessages = createMemo(() => {
    const progressUpdates = deps.props.responseStyle === "natural";
    const turnRowsList: AgentMessage[][] = [];
    const listed = deps.props.messages.flatMap((message) => {
      if (message.kind === "thinking") {
        const rows = progressUpdates ? progressRows(message) : [];
        const showsSteps =
          message.turnId && !thinkingRowHiddenTurns().has(message.turnId) && message.items?.some((item) => item.trim());
        const turnRows = showsSteps ? [...rows, message] : rows;
        turnRowsList.push(turnRows);
        return deps.props.channel ? [] : turnRows;
      }
      if (message.kind === "memory-changes" && answeredTurns().has(message.turnId)) return [];
      return silentAgentAnswer(message) || foldedAnswerIds().has(message.id) ? [] : [message];
    });
    // Members of a channel work at the same time, so each update goes where its time puts it. An agent
    // chat keeps a turn's updates together, except those written after a steer.
    const shown = deps.props.channel
      ? placeTurnRowsByTime(listed, turnRowsList)
      : placeUpdatesAfterSteers(listed, turnRowsList);
    // Natural shows an agent's text once it is complete, as one bubble, while the activity line
    // names the step. A bubble that grows as the text arrives moves the chat at each line.
    const complete = progressUpdates ? shown.filter((message) => !held(message)) : shown;
    const questionTurnId = deps.props.channel ? undefined : deps.props.prompt?.turnId;
    return summarizeHostedSiteMessages(withQuestionContext(complete, deps.props.messages, questionTurnId));
  });
  const routineRunTurns = createMemo(() => routineRunTurnMessages(deps.props.messages, shownMessages()));
  /* The messages of a routine run follow its row and open and close with it. */
  const drawnMessages = createMemo(() => [
    ...placeRoutineRunTurns(summarizeRoutineRunMessages(shownMessages()), routineRunTurns(), openRoutineRuns()),
    ...deps.pendingMessages(),
  ]);
  function toggleRoutineRun(marker: RoutineRunToggleMarkerModel): void {
    const key = routineRunToggleKey(marker);
    setOpenRoutineRuns((open) => new Map(open).set(key, marker.expanded !== true));
  }
  /* The exchange ids of the agent messages whose text shows under their marker. */
  const [openAgentMessages, setOpenAgentMessages] = createSignal<ReadonlySet<string>>(new Set());
  function toggleAgentMessage(messageId: string): void {
    setOpenAgentMessages((open) => {
      const next = new Set(open);
      if (!next.delete(messageId)) next.add(messageId);
      return next;
    });
  }
  /*
   * An open chat marks its messages read at once, so read state loses the first unread message.
   * The visit keeps it until the reader opens another chat. A newer unread message replaces it.
   */
  const visitUnread = createMemo<{ identity: string; messageId: string | null }>((previous) => {
    const identity = `${deps.props.server?.id ?? "local"}:${conversationOwnerId(deps.props) ?? ""}`;
    const messageId = deps.props.firstUnreadMessageId;
    if (previous?.identity === identity && !messageId) return previous;
    return { identity, messageId };
  });
  /*
   * The unread divider sits on the first unread row the timeline draws. A silent answer has no row,
   * so the divider moves to the next row that has one; read state keeps the stored message. A
   * message that is not loaded keeps its id, so the jump can open its page.
   */
  const unreadBoundaryMessageId = createMemo(() => {
    const firstUnreadMessageId = visitUnread().messageId;
    const start = deps.props.messages.findIndex((message) => message.id === firstUnreadMessageId);
    if (start < 0) return firstUnreadMessageId;
    const drawn = new Set(drawnMessages().map((message) => message.id));
    return deps.props.messages.slice(start).find((message) => drawn.has(message.id))?.id ?? null;
  });
  /* A group of agent messages, routine runs or skill installs stops at the unread divider, so the divider keeps its row. */
  const timelineMessages = createMemo(() => {
    const group = (messages: readonly AgentMessage[]) =>
      groupSkillInstallMarkers(
        groupRoutineRunMarkers(
          groupAgentMessageMarkers(messages, unreadBoundaryMessageId()),
          unreadBoundaryMessageId(),
        ),
        unreadBoundaryMessageId(),
      );
    const state = deps.props.contextState;
    const startedAt =
      state?.agentId === deps.props.agent?.id && state?.threadId === deps.props.agent?.threadId
        ? state?.compaction?.startedAt
        : undefined;
    const messages = markOpenAgentMessages(drawnMessages(), openAgentMessages(), updateAnswers());
    const boundary =
      startedAt === undefined
        ? -1
        : messages.findIndex((message) => message.createdAt && Date.parse(message.createdAt) > startedAt);
    const rows =
      boundary < 0 ? group(messages) : [...group(messages.slice(0, boundary)), ...group(messages.slice(boundary))];
    return expandRoutineRunGroups(rows, messages, routineRunTurns(), openRoutineRuns());
  });
  /*
   * A sent message keeps the row of its pending copy. A new row would mount empty at an estimated
   * height and load its images again, and the chat would jump and blink.
   */
  const rowKey = (message: AgentMessage): string => deps.handedOverRowKeys().get(message.id) ?? message.id;
  /*
   * A row finds its message by its key, and other callers by the message id. The virtualizer gives a
   * row its new index one tick after the list changes, so a lookup by index draws the neighbouring
   * message in the row for that tick.
   */
  const timelineIndexById = createMemo(() => {
    const indexes = new Map<VirtualItem["key"], number>();
    timelineMessages().forEach((message, index) => {
      indexes.set(message.id, index);
      indexes.set(rowKey(message), index);
    });
    return indexes;
  });
  /* Every row anchors the count, but only some rows add to it. */
  const timelineRows = createMemo(() =>
    deps.props.messages.map((message) => ({ id: message.id, countable: countableTimelineMessage(message) })),
  );

  function clearNewMessages(): void {
    newMessages = anchorNewMessages(timelineRows());
    setNewMessageCount(0);
  }

  /*
   * The count owns its identity guard instead of leaning on the effect that follows the bottom:
   * that one is created later, so on a thread switch this would run first and carry the count of
   * the thread the reader left into the thread they opened.
   */
  createEffect(
    () => {
      const rows = timelineRows();
      return {
        identity: `${deps.props.server?.id ?? "local"}:${conversationOwnerId(deps.props) ?? ""}`,
        rows,
        length: rows.length,
        lastId: rows.at(-1)?.id,
      };
    },
    ({ identity, rows }) => {
      if (identity !== talliedConversationIdentity) {
        talliedConversationIdentity = identity;
        newMessages = anchorNewMessages(rows);
        setNewMessageCount(0);
        return;
      }
      newMessages = tallyNewMessages(newMessages, rows, deps.sticky.getStickToLatest());
      setNewMessageCount(newMessages.count);
    },
  );

  createEffect(
    () =>
      deps.props.loaded &&
      (timelineMessages().length === 0 || atHistoryBoundary()) &&
      deps.props.hasOlder &&
      !deps.props.loadingOlder &&
      !deps.props.olderError,
    (needsOlderPage) => {
      if (needsOlderPage) deps.props.onLoadOlder?.();
    },
  );

  // A channel row is mostly a short message under an author; an agent row is often a longer answer.
  const rowEstimate = untrack(() => deps.props.channel) ? 84 : 128;
  const messageVirtualizer = createChatVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: () => timelineMessages().length,
    getScrollElement: () => deps.elements.scrollElement() ?? null,
    estimateSize: () => rowEstimate,
    getItemKey: (index) => {
      const message = timelineMessages()[index];
      return message ? rowKey(message) : index;
    },
    keyVersion: () => {
      const messages = timelineMessages();
      const first = messages[0];
      const last = messages.at(-1);
      return `${first ? rowKey(first) : ""}:${last ? rowKey(last) : ""}`;
    },
    scrollMargin: virtualScrollMargin,
    stickToLatest: deps.sticky.getStickToLatest,
    followLatest: deps.sticky.followLatest,
    onChange: (instance) => {
      const first = instance.getVirtualItems()[0];
      if (!first) return;
      firstRenderedIndex = first.index;
      updateHistoryBoundary();
    },
  });

  /* One writer for the boundary: the row the virtualizer renders first, read where the reader is. */
  function updateHistoryBoundary(element = deps.elements.scrollElement()): void {
    setAtHistoryBoundary(chatHistoryBoundaryReached(element, firstRenderedIndex));
  }

  function updateScrollFade(element = deps.elements.scrollElement()) {
    if (!element) return;
    scrollFades.measure();
    updateHistoryBoundary(element);
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    // A chat that follows the latest message is on its way down: a new row is taller than 80px for
    // the frames before the follow lands, and the button must not flash over it.
    setShowScrollToLatest(remaining > 80 && !deps.sticky.getStickToLatest());
    if (remaining <= 80) clearNewMessages();
  }

  function updateVirtualScrollMargin(): void {
    setVirtualScrollMargin(calculateChatScrollMargin(deps.elements.scrollElement(), deps.elements.virtualRoot()));
  }

  function updateUnreadDividerVisibility(): void {
    const scrollElement = deps.elements.scrollElement();
    const unreadMessagesDivider = deps.elements.unreadMessagesDivider();
    setUnreadDividerVisible(
      Boolean(
        deps.sticky.getCurrentUnreadCount() > 0 &&
          scrollElement &&
          unreadMessagesDivider &&
          unreadMessagesDividerIsVisible(scrollElement, unreadMessagesDivider),
      ),
    );
  }

  function scheduleUnreadDividerVisibilityUpdate(): void {
    if (unreadVisibilityFrame !== undefined) cancelAnimationFrame(unreadVisibilityFrame);
    unreadVisibilityFrame = requestAnimationFrame(() => {
      unreadVisibilityFrame = undefined;
      updateUnreadDividerVisibility();
    });
  }

  onCleanup(() => {
    if (unreadVisibilityFrame !== undefined) cancelAnimationFrame(unreadVisibilityFrame);
    unreadVisibilityFrame = undefined;
  });

  async function markUnreadMessages(): Promise<void> {
    if (deps.markingRead()) return;
    const agentId = conversationOwnerId(deps.props);
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    deps.setMarkingRead(true);
    deps.setComposerError(null, target);
    try {
      await deps.props.onMarkRead();
    } catch (error) {
      deps.setComposerError(currentText().errorMessage(error, currentText().t("chat.unread.markReadFailed")), target);
    } finally {
      deps.setMarkingRead(false);
    }
  }

  async function jumpToUnreadMessages(): Promise<void> {
    const scrollElement = deps.elements.scrollElement();
    const unreadMessagesDivider = deps.elements.unreadMessagesDivider();
    if (!scrollElement) return;
    const unreadBoundary = unreadBoundaryMessageId();
    if (!unreadBoundary) {
      // Every unread row is a silent answer: there is no row to scroll to, only read state to move.
      if (deps.props.firstUnreadMessageId) await markUnreadMessages();
      return;
    }
    if (!unreadMessagesDivider && deps.props.onOpenSearchMessage) {
      await deps.props.onOpenSearchMessage(unreadBoundary);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!unreadMessagesDivider) return;
    const divider = unreadMessagesDivider;
    const firstUnreadMessage = divider.nextElementSibling instanceof HTMLElement ? divider.nextElementSibling : divider;
    deps.sticky.setStickToLatest(false);
    scrollToUnreadBoundary(scrollElement, firstUnreadMessage);
    await markUnreadMessages();
    requestAnimationFrame(() => {
      if (!scrollElement) return;
      const settledBoundary = divider.isConnected ? divider : firstUnreadMessage;
      if (settledBoundary.isConnected) {
        scrollToUnreadBoundary(scrollElement, settledBoundary);
      }
    });
  }

  async function jumpToLatestMessage(): Promise<void> {
    const scrollElement = deps.elements.scrollElement();
    if (!scrollElement) return;
    deps.sticky.setStickToLatest(true);
    // A smooth scroll fires no scroll event in a test environment, so the count clears here too.
    clearNewMessages();
    if (deps.props.discontinuous) {
      await deps.props.onLoadLatest?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    scrollToLatestMessage(scrollElement);
  }

  return {
    scrollFades,
    virtualScrollMargin,
    showScrollToLatest,
    setShowScrollToLatest,
    unreadDividerVisible,
    setUnreadDividerVisible,
    newMessageCount,
    clearNewMessages,
    messageVirtualizer,
    timelineMessages,
    toggleRoutineRun,
    toggleAgentMessage,
    updateAnswers,
    timelineIndexById,
    unreadBoundaryMessageId,
    updateScrollFade,
    updateVirtualScrollMargin,
    updateUnreadDividerVisibility,
    scheduleUnreadDividerVisibilityUpdate,
    markUnreadMessages,
    jumpToUnreadMessages,
    jumpToLatestMessage,
  };
}

/** Agent text that the host still writes. A plan, the subagents, a card and an image show while they run. */
function heldWhileWritten(message: AgentMessage): boolean {
  return (
    message.author === "agent" &&
    message.streaming === true &&
    message.kind === "text" &&
    !message.imageGeneration &&
    !message.videoGeneration
  );
}

/** The ids Claude and the ACP agents give a turn's thinking, beside its narration, as `REASONING_ID` in the backend. */
const THINKING_ITEM_ID = /:(?:reasoning|thought(?::\d+)?)$/u;

/**
 * The rows, with the agent's last words before the question that waits as a message at the end of
 * its turn. Those words are narration, which the steps hold, but the question is often about them,
 * such as a draft to approve (#4897). After the answer they are only in the steps again.
 */
function withQuestionContext(
  shown: AgentMessage[],
  messages: readonly AgentMessage[],
  turnId: string | undefined,
): AgentMessage[] {
  if (!turnId) return shown;
  const thinking = messages.find((message) => message.kind === "thinking" && message.turnId === turnId);
  const context = thinking ? lastNarration(thinking) : null;
  // With progress updates on, the narration is already a row of its own.
  if (!context || shown.some((message) => message.id === context.id)) return shown;
  const turnEnd = shown.findLastIndex((message) => message.turnId === turnId) + 1;
  const at = turnEnd > 0 ? turnEnd : shown.length;
  return [...shown.slice(0, at), context, ...shown.slice(at)];
}

function lastNarration(thinking: AgentMessage): AgentMessage | null {
  const items = thinking.items ?? [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const id = thinking.itemIds?.[index];
    const body = items[index] ?? "";
    if (!id || !body.trim() || THINKING_ITEM_ID.test(id)) continue;
    const createdAt = thinking.itemCreatedAt?.[index];
    return {
      id,
      ...(thinking.turnId === undefined ? {} : { turnId: thinking.turnId }),
      author: "agent",
      body,
      time: createdAt ? formatMessageTime(createdAt) : thinking.time,
      ...(createdAt ? { createdAt } : {}),
      // Still a step of the turn: the timeline gives it no stored-message actions.
      itemType: "commentary",
      kind: "text",
    };
  }
  return null;
}
