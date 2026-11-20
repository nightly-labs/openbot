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
import { groupAgentMessageMarkers, markOpenAgentMessages, teammateTurnAnswers } from "../agent-message-timeline";
import type { ConversationProps, ConversationTarget } from "../conversation-types";
import { summarizeHostedSiteMessages } from "../hosted-site-timeline";
import { narrationRows, placeTurnRowsByTime, placeUpdatesAfterSteers } from "../narration-rows";
import {
  expandRoutineRunGroups,
  groupRoutineRunMarkers,
  placeRoutineRunTurns,
  quietRunStepsRow,
  type RoutineRunOpenState,
  routineRunToggleKey,
  routineRunTurnMessages,
  summarizeRoutineRunMessages,
} from "../routine-run-timeline";
import { groupSkillInstallMarkers } from "../skill-install-timeline";
import { isTurnAnswer } from "../turn-steps";
import { conversationOwnerId } from "./composer-store";

const PROMPT_SEND_HOLD_MS = 2000;

interface ScrollElements {
  scrollElement: () => HTMLDivElement | undefined;
  virtualRoot: () => HTMLDivElement | undefined;
  unreadMessagesDivider: () => HTMLDivElement | undefined;
}

interface ScrollStickyState {
  getStickToLatest: () => boolean;
  setStickToLatest: (value: boolean) => void;
  getCurrentUnreadCount: () => number;
  followLatest: (element: HTMLDivElement) => void;
}

export interface ScrollStoreDeps {
  props: ConversationProps;
  markingRead: () => boolean;
  setMarkingRead: (reading: boolean) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  pendingMessages: () => AgentMessage[];
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
  const [usedPageIds, setUsedPageIds] = createSignal<ReadonlySet<string>>(new Set());
  let unreadVisibilityFrame: number | undefined;
  let firstRenderedIndex = 0;
  let newMessages: NewMessageTally = { count: 0, anchorId: undefined };
  let talliedConversationIdentity: string | undefined;

  const [openRoutineRuns, setOpenRoutineRuns] = createSignal<RoutineRunOpenState>(new Map());
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
  const progressRows = (thinking: AgentMessage): AgentMessage[] => {
    const channel = deps.props.channel;
    if (!channel) return narrationRows(thinking, deps.props.agent?.provider);
    const answeredAt = thinking.turnId ? channelAnswerTimes().get(thinking.turnId) : undefined;
    return narrationRows(thinking, channel.author(thinking).agent?.provider).filter(
      (row) => !answeredAt || !row.createdAt || row.createdAt <= answeredAt,
    );
  };
  const channelWriters = createMemo(() => new Set(deps.props.channel?.workers().map((worker) => worker.id) ?? []));
  const [endingTurnIds, setEndingTurnIds] = createSignal<ReadonlySet<string>>(new Set<string>());
  const endingTimers = new Set<ReturnType<typeof setTimeout>>();
  let lastTurnId = untrack(() => deps.props.activeTurnId) ?? undefined;
  createEffect(
    () => deps.props.activeTurnId,
    (turnId) => {
      const ended = lastTurnId;
      lastTurnId = turnId ?? undefined;
      if (!ended || ended === turnId) return;
      setEndingTurnIds((ids) => new Set(ids).add(ended));
      const timer = setTimeout(() => {
        endingTimers.delete(timer);
        setEndingTurnIds((ids) => new Set([...ids].filter((id) => id !== ended)));
      }, STALE_STREAM_MS);
      endingTimers.add(timer);
    },
  );
  onCleanup(() => {
    for (const timer of endingTimers) clearTimeout(timer);
  });
  const held = (message: AgentMessage): boolean =>
    heldWhileWritten(message) &&
    (deps.props.channel
      ? message.senderAgentId !== undefined && channelWriters().has(message.senderAgentId)
      : message.turnId === undefined
        ? Boolean(deps.props.activeTurnId) || endingTurnIds().size > 0
        : message.turnId === deps.props.activeTurnId || endingTurnIds().has(message.turnId));
  const updateAnswers = createMemo(() => teammateTurnAnswers(deps.props.messages));
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
          message.turnId &&
          !thinkingRowHiddenTurns().has(message.turnId) &&
          (message.items?.some((item) => item.trim()) || quietRunStepsRow(message));
        const turnRows = showsSteps ? [...rows, message] : rows;
        turnRowsList.push(turnRows);
        return deps.props.channel ? [] : turnRows;
      }
      if (message.kind === "memory-changes" && answeredTurns().has(message.turnId)) return [];
      return silentAgentAnswer(message) || foldedAnswerIds().has(message.id) ? [] : [message];
    });
    const shown = deps.props.channel
      ? placeTurnRowsByTime(listed, turnRowsList)
      : placeUpdatesAfterSteers(listed, turnRowsList);
    const complete = progressUpdates ? shown.filter((message) => !held(message)) : shown;
    const questionTurnId = deps.props.channel ? undefined : deps.props.prompt?.turnId;
    return summarizeHostedSiteMessages(withQuestionContext(complete, deps.props.messages, questionTurnId));
  });
  const routineRunTurns = createMemo(() => routineRunTurnMessages(deps.props.messages, shownMessages()));
  const userRowSeenAt = new Map<string, number>();
  let waitingQuestion:
    | { key: string; owner: string; turnId: string; requestId: string; at: number; closedAt: number | undefined }
    | undefined;
  const [promptHoldClock, setPromptHoldClock] = createSignal(0);
  const promptHold = createMemo(() => {
    promptHoldClock();
    const held = new Set<string>();
    let revealAt: number | undefined;
    const now = Date.now();
    const owner = `${deps.props.server?.id ?? "local"}:${conversationOwnerId(deps.props) ?? ""}`;
    const prompt = deps.props.channel ? undefined : deps.props.prompt;
    const closesForMessage = prompt !== undefined && !prompt.detached && prompt.turnId === deps.props.activeTurnId;
    if (waitingQuestion?.owner !== owner) waitingQuestion = undefined;
    if (prompt && closesForMessage) {
      const key = JSON.stringify([prompt.turnId, String(prompt.requestId)]);
      if (waitingQuestion?.key !== key)
        waitingQuestion = {
          key,
          owner,
          turnId: prompt.turnId,
          requestId: String(prompt.requestId),
          at: now,
          closedAt: undefined,
        };
    } else if (prompt) waitingQuestion = undefined;
    else if (waitingQuestion) waitingQuestion.closedAt ??= now;
    const waiting = waitingQuestion;
    if (!waiting) {
      userRowSeenAt.clear();
      return { held, revealAt };
    }
    const question = deps.props.messages.find(
      (message) => message.turnId === waiting.turnId && String(message.questionPrompt?.requestId) === waiting.requestId,
    );
    const rowDone = Boolean(question?.questionPrompt?.resolution);
    const closedLongAgo = waiting.closedAt !== undefined && now - waiting.closedAt >= PROMPT_SEND_HOLD_MS;
    if (!prompt && (rowDone || closedLongAgo)) {
      waitingQuestion = undefined;
      userRowSeenAt.clear();
      return { held, revealAt };
    }
    const rows = [...shownMessages(), ...deps.pendingMessages()].filter((message) => message.author === "you");
    for (const message of rows) {
      if (!userRowSeenAt.has(message.id)) userRowSeenAt.set(message.id, now);
      const seenAt = userRowSeenAt.get(message.id) ?? now;
      const until = seenAt + PROMPT_SEND_HOLD_MS;
      const beforeQuestion =
        question?.createdAt !== undefined && message.createdAt !== undefined && message.createdAt <= question.createdAt;
      if (beforeQuestion || seenAt <= waiting.at || until <= now) continue;
      held.add(message.id);
      revealAt = Math.min(revealAt ?? until, until);
    }
    return { held, revealAt };
  });
  createEffect(
    () => promptHold().revealAt,
    (revealAt) => {
      if (revealAt === undefined) return;
      const timer = setTimeout(() => setPromptHoldClock((tick) => tick + 1), Math.max(0, revealAt - Date.now()));
      return () => clearTimeout(timer);
    },
  );
  const drawnMessages = createMemo(() => {
    const { held } = promptHold();
    const drawn = [
      ...placeRoutineRunTurns(summarizeRoutineRunMessages(shownMessages()), routineRunTurns(), openRoutineRuns()),
      ...deps.pendingMessages(),
    ];
    return held.size === 0 ? drawn : drawn.filter((message) => !held.has(message.id));
  });
  function toggleRoutineRun(marker: RoutineRunToggleMarkerModel): void {
    const key = routineRunToggleKey(marker);
    setOpenRoutineRuns((open) => new Map(open).set(key, marker.expanded !== true));
  }
  const [openAgentMessages, setOpenAgentMessages] = createSignal<ReadonlySet<string>>(new Set());
  function toggleAgentMessage(messageId: string): void {
    setOpenAgentMessages((open) => {
      const next = new Set(open);
      if (!next.delete(messageId)) next.add(messageId);
      return next;
    });
  }
  const visitUnread = createMemo<{ identity: string; messageId: string | null }>((previous) => {
    const identity = `${deps.props.server?.id ?? "local"}:${conversationOwnerId(deps.props) ?? ""}`;
    const messageId = deps.props.firstUnreadMessageId;
    if (previous?.identity === identity && !messageId) return previous;
    return { identity, messageId };
  });
  const unreadBoundaryMessageId = createMemo(() => {
    const firstUnreadMessageId = visitUnread().messageId;
    const start = deps.props.messages.findIndex((message) => message.id === firstUnreadMessageId);
    if (start < 0) return firstUnreadMessageId;
    const drawn = new Set(drawnMessages().map((message) => message.id));
    return deps.props.messages.slice(start).find((message) => drawn.has(message.id))?.id ?? null;
  });
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
  const rowKey = (message: AgentMessage): string => deps.handedOverRowKeys().get(message.id) ?? message.id;
  const timelineIndexById = createMemo(() => {
    const indexes = new Map<VirtualItem["key"], number>();
    timelineMessages().forEach((message, index) => {
      indexes.set(message.id, index);
      indexes.set(rowKey(message), index);
    });
    return indexes;
  });
  const timelineRows = createMemo(() =>
    deps.props.messages.map((message) => ({ id: message.id, countable: countableTimelineMessage(message) })),
  );

  function clearNewMessages(): void {
    newMessages = anchorNewMessages(timelineRows());
    setNewMessageCount(0);
  }

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
        setUsedPageIds(new Set<string>());
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
      if (!needsOlderPage) return;
      if (untrack(() => timelineMessages().length) > 0 && !updateHistoryBoundary()) return;
      deps.props.onLoadOlder?.();
    },
  );

  function keepPageDrawn(messageId: string): void {
    if (untrack(usedPageIds).has(messageId)) return;
    setUsedPageIds((ids) => new Set([...ids, messageId]));
  }
  const usedPageIndexes = createMemo(
    () => {
      const indexes = timelineIndexById();
      return [...usedPageIds()].flatMap((id) => indexes.get(id) ?? []);
    },
    { equals: (left, right) => left.length === right.length && left.every((index, at) => index === right[at]) },
  );

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
    keptIndexes: usedPageIndexes,
    stickToLatest: deps.sticky.getStickToLatest,
    followLatest: deps.sticky.followLatest,
    onChange: (instance) => {
      const first = instance.getVirtualItems()[0];
      if (!first) return;
      firstRenderedIndex = first.index;
      updateHistoryBoundary();
    },
  });

  function updateHistoryBoundary(element = deps.elements.scrollElement()): boolean {
    const followsLatest = deps.sticky.getStickToLatest();
    const reached =
      chatHistoryBoundaryReached(element, firstRenderedIndex, followsLatest) &&
      (!followsLatest || currentRowsRendered(element));
    setAtHistoryBoundary(reached);
    return reached;
  }

  function currentRowsRendered(element: HTMLElement | undefined): boolean {
    const messages = untrack(timelineMessages);
    if (!element || messages.length === 0) return true;
    const marks = element.querySelectorAll("[data-chat-search-message]");
    const lastId = marks[marks.length - 1]?.getAttribute("data-chat-search-message");
    if (!lastId) return element.querySelector(".virtual-chat-row") !== null;
    return messages.findLastIndex((message) => message.id === lastId) !== -1;
  }

  function updateScrollFade(element = deps.elements.scrollElement()) {
    if (!element) return;
    scrollFades.measure();
    updateHistoryBoundary(element);
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
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
    clearNewMessages();
    if (deps.props.discontinuous) {
      await deps.props.onLoadLatest?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    scrollToLatestMessage(scrollElement);
  }

  return {
    scrollFades,
    shownMessages,
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
    keepPageDrawn,
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

const STALE_STREAM_MS = 3_000;

function heldWhileWritten(message: AgentMessage): boolean {
  return (
    message.author === "agent" &&
    message.streaming === true &&
    message.kind === "text" &&
    !message.imageGeneration &&
    !message.videoGeneration
  );
}

const THINKING_ITEM_ID = /:(?:reasoning|thought(?::\d+)?)$/u;

export function withQuestionContext(
  shown: AgentMessage[],
  messages: readonly AgentMessage[],
  turnId: string | undefined,
): AgentMessage[] {
  if (!turnId) return shown;
  const thinking = messages.find((message) => message.kind === "thinking" && message.turnId === turnId);
  const context = thinking ? lastNarration(thinking) : null;
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
      itemType: "commentary",
      kind: "text",
    };
  }
  return null;
}
