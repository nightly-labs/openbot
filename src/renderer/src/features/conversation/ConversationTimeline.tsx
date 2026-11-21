import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { AgentApproval, ConversationMessageSender, MessageReaction } from "@openbot/contracts/ipc";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";
import { FEEDBACK_WITHDRAW_CAPABILITY } from "@openbot/contracts/team-protocol/feedback-withdraw-v1";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import { feedbackApproval } from "@openbot/team-client/feedback-approval";
import { Button } from "@openbot/ui";
import type { AgentMessage, ChatActionMarkerModel, MessageKind } from "@openbot/ui/data";
import { ChannelActivityIndicator, type ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { AgentActivityIndicator, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import { AgentChatEmptyState } from "@openbot/ui/features/conversation/AgentChatEmptyState";
import {
  type AgentStep,
  AgentStepsDisclosure,
  type AgentStepsTrace,
} from "@openbot/ui/features/conversation/AgentSteps";
import { AttachmentCards } from "@openbot/ui/features/conversation/AttachmentCards";
import { agentActivityExitDelay, agentActivityExitDuration } from "@openbot/ui/features/conversation/activity-timing";
import { UsageLimitAskCard } from "@openbot/ui/features/conversation/BackupModels";
import { branchPointIds } from "@openbot/ui/features/conversation/branch-points";
import { ChatActionMarker } from "@openbot/ui/features/conversation/ChatActionMarker";
import { type ChatMessageAuthor, ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ChatRowBoundary } from "@openbot/ui/features/conversation/ChatRowBoundary";
import { ChatScrollRail, createChatScrollRail } from "@openbot/ui/features/conversation/ChatScrollRail";
import { ChatSearch } from "@openbot/ui/features/conversation/ChatSearch";
import { ContextCompactionMarker, type ContextCompactionView } from "@openbot/ui/features/conversation/ContextUsage";
import { dayMarkerLabel } from "@openbot/ui/features/conversation/chat-day-markers";
import { CHAT_TIME_GAP_MS, continuesSenderRun } from "@openbot/ui/features/conversation/chat-grouping";
import { markdownPlainText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { ReplyReturnButton, ScrollToLatestButton } from "@openbot/ui/features/conversation/MessageNavigation";
import {
  DeleteMessageDialog,
  MessageActions,
  MessageMenu,
  MessageMenuItems,
  type MessageMenuItemsProps,
} from "@openbot/ui/features/conversation/MessageRendering";
import { countableTimelineMessage } from "@openbot/ui/features/conversation/new-message-tally";
import { ownMessageAuthor } from "@openbot/ui/features/conversation/own-bubble";
import { PendingSendStatus } from "@openbot/ui/features/conversation/PendingSendStatus";
import { SubagentDock, SubagentGroup } from "@openbot/ui/features/conversation/Subagents";
import { TaskList } from "@openbot/ui/features/conversation/TaskList";
import { MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { UnreadMessagesBanner, UnreadMessagesDivider } from "@openbot/ui/features/conversation/UnreadMessages";
import { VoicePlayer } from "@openbot/ui/features/conversation/VoicePlayer";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, Loading, onSettled, Show, untrack } from "solid-js";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { planItems, planTitle, replacedPlanIds } from "../../app-message-projection";
import { useChatBubbleStyle } from "../../chat-bubble-style-preference";
import { useCompactMessageActions } from "../../compact-message-actions-preference";
import {
  remoteRoutineRecovery,
  serverRoleCanAdminister,
  serverSupportsCapability,
} from "../servers/server-capabilities";
import { speechModelReady } from "../speech/speech-model";
import { recordingGone, speechReading, spokenReply } from "../speech/speech-playback";
import {
  recordingWaveform,
  seekRecording,
  seekSpokenReply,
  toggleReadAloud,
  toggleRecording,
  toggleSpokenReply,
} from "../speech/speech-replies";
import { cycleSpeechSpeed, speechSpeed } from "../speech/speech-speed";
import { groupedMessageIds } from "./agent-message-timeline";
import { ChatVisualReply, shownVisualReply } from "./ChatVisualReply";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { chatSearchCanOpen, chatSearchOpensMessage } from "./chat-search";
import { ApprovalCard, preloadConversationCards, QuestionPromptBubble, UiBlockPrompt } from "./conversation-cards";
import { useConversationController } from "./conversation-controller-context";
import { conversationPort } from "./conversation-port";
import { isIncomingAgentMessage } from "./conversation-read-state";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import { MarketplaceSuggestionChatCard, marketplaceSuggestionKnown } from "./MarketplaceSuggestionChatCard";
import { McpSignInChatCard } from "./McpSignInChatCard";
import { useMessageBackdropAction, watchAgentBackdrops } from "./message-backdrop";
import { createMessageImageFiles } from "./message-image-files";
import { RoutineChatCard } from "./RoutineChatCard";
import { createChatWebhookRoutines, RoutineWebhookChatCard } from "./RoutineWebhookChatCard";
import { createRoutineRunFailures, type RoutineRunFailureSource } from "./routine-run-failures";
import { desktopChatEventRoutinesApi } from "./routine-webhooks-api";
import { ServerInstallChatCard } from "./ServerInstallChatCard";
import { SettingLinkChatCard } from "./SettingLinkChatCard";
import { SkillSuggestionChatCard, skillSuggestionOutcome } from "./SkillSuggestionChatCard";
import { PENDING_SEND_ID_PREFIX, pendingSendRetrySafe } from "./stores/pending-send-store";
import { createSubagentDock } from "./subagent-dock";
import { createTurnSteps, SUBAGENT_SPAN_PREFIX } from "./turn-steps";
import { useTurnTrace } from "./turn-trace";

function markerOnlyMessage(message: AgentMessage): boolean {
  return Boolean(message.actionMarker);
}

function frozenUiBlock(message: AgentMessage | undefined): ConversationUiBlock | undefined {
  const block = message?.uiBlock;
  return block && block.state.status !== "pending" ? block : undefined;
}

function rowDrawsTime(message: AgentMessage): boolean {
  return (
    !markerOnlyMessage(message) &&
    !message.questionPrompt &&
    message.kind !== "plan" &&
    message.kind !== "subagents" &&
    message.kind !== "memory-changes" &&
    message.kind !== "thinking" &&
    chatVisualReply(message) === null
  );
}

function markerRowEndsWithMarker(message: AgentMessage): boolean {
  if (!markerOnlyMessage(message)) return false;
  return !(message.exchange?.direction === "incoming" && (message.attachments?.length ?? 0) > 0);
}

function routineMarkerAvailable(
  marker: ChatActionMarkerModel,
  availableRoutineIds: readonly string[] | undefined,
): boolean {
  if (!("routineId" in marker)) return true;
  if (marker.kind === "routine-lifecycle" && marker.action === "deleted") return false;
  return availableRoutineIds?.includes(marker.routineId) === true;
}

const REPLY_KINDS: ReadonlySet<MessageKind> = new Set(["text", "question"]);

export function ConversationTimeline() {
  const {
    activeChatSearchIndex,
    agentActivitySpaceReserved,
    attachmentAction,
    attachmentDownloads,
    channel,
    chatSearchMatches,
    chatSearchOpen,
    chatSearchQuery,
    chatSearchTotal,
    clearNewMessages,
    closeChatSearch,
    composerHasContent,
    quotedMessageId,
    branchThread,
    dismissPendingSend,
    downloadMessageImageFile,
    editingDeliveryId,
    editPendingSend,
    copyMessage,
    copiedMessageId,
    messageText,
    expandedEmojiMessageId,
    installedSkills,
    scrollFades,
    jumpToLatestMessage,
    jumpToUnreadMessages,
    markMessageSeen,
    markUnreadMessages,
    markingRead,
    messageVirtualizer,
    newMessageCount,
    timelineMessages,
    toggleRoutineRun,
    toggleAgentMessage,
    updateAnswers,
    timelineIndexById,
    unreadBoundaryMessageId,
    moveChatSearch,
    openExternalMessageUrl,
    openReactionMessageId,
    openRoutineSettings,
    changeMarkerActions,
    openAgentSettingRow,
    openSharedFile,
    openWorkspaceFile,
    openQuote,
    openTaggedReference,
    pendingSendFor,
    presentedQueueDeliveries,
    providerUpdateRequired,
    previewAttachment,
    props,
    mcpServers,
    sendCardMessage,
    saveSkillSuggestion,
    reactToMessage,
    renderedAgentActivity,
    activeStepActivity,
    activeTurnOutputShown,
    providerOffline,
    providerSilentMinutes,
    agentProviderName,
    replyJump,
    replyToMessage,
    addPageText,
    setPageContext,
    quoteSelection,
    retryPendingSend,
    scheduleUnreadDividerVisibilityUpdate,
    setChatSearchQuery,
    setExpandedEmojiMessageId,
    setOpenReactionMessageId,
    setRequiredInteractionElement,
    registerPromptComposerAnswer,
    showScrollToLatest,
    unreadDividerVisible,
    updateScrollFade,
    updateUnreadDividerVisibility,
    setAgentActivitySlotElement,
    setChatSearchInputElement,
    setScrollElement,
    setStickToLatest,
    followReaderScroll,
    setUnreadMessagesDividerElement,
    unreadDividerArrives,
    setVirtualRootElement,
    shownSubagentId,
    toggleSubagentPanel,
    sideThreadOpen,
    messagePins,
  } = useConversationViewScope();
  const { t, format } = useText();
  const controller = useConversationController();
  const waitingProviderName = () => {
    const waiting = providerSilentMinutes() !== null || providerOffline();
    return waiting ? agentProviderName() : undefined;
  };
  const readAloudAction = (message: AgentMessage) => {
    const agentId = props.agent?.id;
    if (
      props.runtime ||
      !agentId ||
      message.author !== "agent" ||
      message.streaming ||
      !speechTextFromMarkdown(message.body)
    )
      return;
    if (!speechModelReady()) return;
    return {
      reading: speechReading()?.messageId === message.id,
      onToggle: () =>
        toggleReadAloud({ serverId: props.server?.id ?? "local", agentId, messageId: message.id }, message.body),
    };
  };
  const markUnreadAction = (message: AgentMessage) => {
    const onMarkUnread = props.onMarkUnread;
    if (channel || !onMarkUnread || !isIncomingAgentMessage(message) || message.streaming) return;
    return () => void onMarkUnread(message.id);
  };
  const [deleteTargetId, setDeleteTargetId] = createSignal<string | null>(null);
  const deleteAction = (message: AgentMessage) => {
    if (!props.onDeleteMessage || message.streaming || message.id.startsWith(PENDING_SEND_ID_PREFIX)) return;
    if (props.canDeleteMessage && !props.canDeleteMessage(message)) return;
    return () => setDeleteTargetId(message.id);
  };
  const deleteMessage = (messageId: string) => props.onDeleteMessage?.(messageId) ?? Promise.resolve();
  const pinAction = (message: AgentMessage) => {
    if (!messagePins.available() || message.streaming || message.id.startsWith(PENDING_SEND_ID_PREFIX)) return;
    if (message.actionMarker) return;
    const pinned = messagePins.isPinned(undefined, message.id);
    return { pinned, onToggle: () => messagePins.set(undefined, message.id, !pinned) };
  };
  const sendToChannelAction = (message: AgentMessage) => {
    const target = props.sendToChannel;
    if (
      channel ||
      !target ||
      message.streaming ||
      !message.body.trim() ||
      message.id.startsWith(PENDING_SEND_ID_PREFIX)
    )
      return;
    return { channels: target.channels, onSend: (channelId: string) => target.onSend(channelId, messageText(message)) };
  };
  const branchPoints = createMemo(() =>
    channel ? new Set<string>() : branchPointIds(timelineMessages(), props.activeTurnId),
  );
  const branchAction = (message: AgentMessage) => {
    if (channel || !props.threads?.onBranch || !branchPoints().has(message.id)) return;
    return () => void branchThread(null, message.id);
  };
  const replacedPlans = createMemo(() => replacedPlanIds(timelineMessages()));
  const spokenReplyIds = createMemo(() => {
    const ids = new Set<string>();
    let spoken = false;
    let reply: string | undefined;
    for (const message of timelineMessages()) {
      if (message.author === "you") {
        if (reply) ids.add(reply);
        spoken = message.voiceRecording !== undefined;
        reply = undefined;
      } else if (spoken && (message.kind ?? "text") === "text" && message.body.trim()) reply = message.id;
    }
    if (reply) ids.add(reply);
    return ids;
  });
  const voicePlayer = (message: AgentMessage | undefined) => {
    if (!message) return;
    const reading = speechReading();
    const own = reading?.messageId === message.id ? reading : undefined;
    const state = !own ? ("idle" as const) : own.paused ? ("paused" as const) : ("playing" as const);
    const url = message.voiceRecording?.previewUrl;
    if (message.author === "you" && url && !recordingGone(url)) {
      const waveform = recordingWaveform(url);
      return {
        kind: "message" as const,
        state,
        peaks: waveform?.peaks,
        duration: waveform?.duration ?? own?.duration ?? undefined,
        elapsed: own?.elapsed,
        onToggle: () => toggleRecording(message.id, url),
        onSeek: (seconds: number) => seekRecording(message.id, url, seconds),
        levels: undefined,
      };
    }
    const agentId = props.agent?.id;
    if (!agentId || !spokenReplyIds().has(message.id) || !readAloudAction(message)) return;
    const summary = spokenReply(message.id);
    return {
      kind: "reply" as const,
      state,
      levels: own?.levels,
      peaks: summary?.peaks,
      duration: summary?.duration ?? own?.duration ?? undefined,
      elapsed: own?.elapsed,
      onSeek: (seconds: number) => seekSpokenReply(message.id, seconds),
      onToggle: () =>
        toggleSpokenReply({ serverId: props.server?.id ?? "local", agentId, messageId: message.id }, message.body),
    };
  };
  const compaction = (): ContextCompactionView | null => {
    const state = props.contextState;
    if (state?.agentId !== props.agent?.id || state?.threadId !== props.agent?.threadId || !state?.compaction)
      return null;
    return { ...state.compaction, timestamp: new Date(state.compaction.startedAt).toISOString() };
  };
  const compactionBefore = createMemo(() => {
    const startedAt = props.contextState?.compaction?.startedAt;
    return startedAt === undefined
      ? undefined
      : timelineMessages().find((message) => message.createdAt && Date.parse(message.createdAt) > startedAt)?.id;
  });
  const CompactionMarker = () => (
    <Show when={compaction()}>{(state) => <ContextCompactionMarker compaction={state()} />}</Show>
  );

  const runtime = conversationRuntime(props);
  const backdropAction = useMessageBackdropAction(runtime);
  watchAgentBackdrops(
    runtime,
    () => props.agent?.id,
    () => props.messages,
    () => props.isOwnSender,
  );
  const messageImageFiles = props.runtime ? undefined : createMessageImageFiles(runtime.agent);
  const withdrawFeedback = createMemo(() => {
    const agentId = props.agent?.id;
    const server = props.server;
    if (channel || !agentId || !server || (server.kind !== "local" && server.role !== "owner")) return undefined;
    const remove = props.runtime?.withdrawFeedback;
    if (remove) return (messageId: string) => remove({ agentId, messageId }).then(({ status }) => status);
    if (props.runtime || !serverSupportsCapability(server, FEEDBACK_WITHDRAW_CAPABILITY)) return undefined;
    return (messageId: string) =>
      conversationPort()
        .agent.withdrawFeedback({ agentId, messageId }, server.id)
        .then(({ status }) => status);
  });
  const requestFeedbackChange = createMemo(() => {
    const agentId = props.agent?.id;
    const server = props.server;
    if (channel || !agentId || !server) return undefined;
    return (request: { number: number; change: "fix" | "remove" }) => {
      const target = { serverId: server.id, agentId };
      const number = String(request.number);
      if (request.change === "fix")
        controller.startFeedbackFix(target, request.number, t("chat.feedbackSent.fixPrompt", { number }));
      else controller.appendPluginPrompt(target, t("chat.feedbackSent.removePrompt", { number }));
    };
  });
  const interactionAgentName = () => (channel ? channel.interactionAgentName() : props.agent?.name);

  const [sendingFeedback, setSendingFeedback] = createSignal<{
    approval: AgentApproval;
    rows: number;
    turnId: string | null | undefined;
  } | null>(null);
  const heldFeedback = createMemo(() => {
    const held = sendingFeedback();
    if (!held || props.approval) return undefined;
    if (props.messages.length !== held.rows || props.activeTurnId !== held.turnId) return undefined;
    return held.approval;
  });
  async function approve(approval: AgentApproval) {
    if (feedbackApproval(approval)) {
      setSendingFeedback({ approval, rows: props.messages.length, turnId: props.activeTurnId });
    }
    const accepted = await props.onRespondToApproval("accept");
    if (!accepted) setSendingFeedback(null);
    return accepted;
  }
  const otherSender = (message: AgentMessage | undefined): ConversationMessageSender | undefined => {
    const sender = message?.author === "you" ? message.senderMember : undefined;
    return sender && !props.isOwnSender(sender.id) ? sender : undefined;
  };
  const memberAuthor = (sender: ConversationMessageSender): ChatMessageAuthor => {
    const member = props.presence.members.find((candidate) => candidate.id === sender.id);
    return {
      kind: "member",
      name: (member ? teamMemberName(member) : sender.name.trim()) || t("chat.message.memberFallback"),
      avatarSeed: sender.id,
      chatColor: member?.chatColor,
    };
  };
  const ownChatColor = () =>
    props.currentUserChatColor === undefined
      ? props.presence.members.find((member) => props.isOwnSender(member.id))?.chatColor
      : (props.currentUserChatColor ?? undefined);
  const agentMessagesByExchangeId = createMemo(
    () =>
      new Map(
        props.messages.flatMap((message) => (message.exchange ? [[message.exchange.messageId, message] as const] : [])),
      ),
  );
  const exchangeAuthor = (message: AgentMessage): ChatMessageAuthor => {
    const agentId = message.exchange?.senderAgentId;
    const agent = props.agents.find((candidate) => candidate.id === agentId);
    return { kind: "agent", name: agent?.name ?? t("chat.message.agentFallback"), agent, avatarSeed: agentId };
  };
  const exchangeRequest = (replyToMessageId: string | null | undefined) =>
    replyToMessageId
      ? (agentMessagesByExchangeId().get(replyToMessageId) ??
        props.messages.find((candidate) => candidate.id === replyToMessageId) ??
        props.messageReferences?.[replyToMessageId])
      : undefined;
  const requestAuthorName = (request: AgentMessage): string | undefined => {
    if (request.exchange) return exchangeAuthor(request).name;
    const sender = otherSender(request);
    if (sender) return memberAuthor(sender).name;
    return request.author === "agent" ? props.agent?.name : undefined;
  };
  const agentMessageText = (messageId: string) => {
    const message = () => agentMessagesByExchangeId().get(messageId);
    const quietAnswers = () => updateAnswers().get(messageId) ?? [];
    const request = () => exchangeRequest(message()?.exchange?.replyToMessageId);
    const quoted = (): AgentMessage | undefined => {
      const current = request();
      return (
        current && { id: current.id, author: current.author, body: current.body, time: current.time, kind: "text" }
      );
    };
    const quotedAuthorName = () => {
      const current = request();
      return current && requestAuthorName(current);
    };
    return (
      <>
        <Show when={message()}>
          {(current) => (
            <ChatMessageRow
              message={{
                id: current().id,
                author: "agent",
                body: current().body,
                time: current().time,
                ...(current().createdAt === undefined ? {} : { createdAt: current().createdAt }),
                kind: "text",
              }}
              author={exchangeAuthor(current())}
              showAuthor
              showTime
              agents={props.agents}
              referencedMessage={quoted()}
              referencedAuthorName={quotedAuthorName()}
              onSelectAgent={(agentId) =>
                agentId === current().exchange?.senderAgentId
                  ? props.onSelectAgent(agentId, current().exchange?.senderTaskId ?? MAIN_THREAD_ID)
                  : props.onSelectAgent(agentId)
              }
              onOpenLink={(url) => void openExternalMessageUrl(url)}
              onPreview={(attachment) => void previewAttachment(attachment)}
              onAttachmentAction={attachmentAction}
              onOpenSharedFile={(path) => openSharedFile(path)}
              onOpenWorkspaceFile={(path) => openWorkspaceFile(path, undefined, current().exchange?.senderAgentId)}
              onOpenQuote={openQuote}
              onOpenTag={openTaggedReference}
              macWindowControls={props.platform === "darwin"}
            />
          )}
        </Show>
        <For each={quietAnswers()}>
          {(answer) => (
            <ChatMessageRow
              message={answer}
              author={ownAgentAuthor()}
              showTime
              agents={props.agents}
              onSelectAgent={props.onSelectAgent}
              onOpenLink={(url) => void openExternalMessageUrl(url)}
              onPreview={(attachment) => void previewAttachment(attachment)}
              onAttachmentAction={attachmentAction}
              onOpenWorkspaceFile={(path) => openWorkspaceFile(path, undefined, props.agent?.id)}
              onOpenQuote={openQuote}
              onOpenTag={openTaggedReference}
              macWindowControls={props.platform === "darwin"}
            />
          )}
        </For>
      </>
    );
  };
  const ownAgentAuthor = (): ChatMessageAuthor => ({
    kind: "agent",
    name: props.agent?.name ?? t("chat.message.agentFallback"),
    agent: props.agent,
  });
  const senderRunRow = (message: AgentMessage) => {
    const sender = otherSender(message);
    const author = sender
      ? `member:${sender.id}`
      : channel && message.author === "agent"
        ? `agent:${message.senderAgentId ?? ""}`
        : message.author;
    return {
      author,
      ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
      ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    };
  };
  const routineCardMarker = (message: AgentMessage | undefined, marker: ChatActionMarkerModel | undefined) =>
    message?.turnId && marker?.kind === "routine-lifecycle" ? marker : undefined;
  const latestRoutineMessageIds = createMemo(() => {
    const latest = new Map<string, string>();
    for (const message of timelineMessages()) {
      const marker = routineCardMarker(message, message.actionMarker);
      if (marker) latest.set(marker.routineId, message.id);
    }
    return latest;
  });
  const routineCard = (message: AgentMessage | undefined, marker: ChatActionMarkerModel) => {
    const agentId = props.agent?.id;
    const cardMarker = routineCardMarker(message, marker);
    if (!message || !cardMarker || cardMarker.action === "deleted" || !agentId) return undefined;
    if (latestRoutineMessageIds().get(cardMarker.routineId) !== message.id) return undefined;
    const routine = props.routines?.find((candidate) => candidate.id === cardMarker.routineId);
    return routine && { action: cardMarker.action, routine, agentId };
  };
  const webhookRoutinesNeeded = createMemo(() => {
    if (!props.routines) return false;
    const scheduled = new Set(props.routines.map((routine) => routine.id));
    return timelineMessages().some((message) => {
      const marker = routineCardMarker(message, message.actionMarker);
      return marker !== undefined && marker.action !== "deleted" && !scheduled.has(marker.routineId);
    });
  });
  const webhookRoutineSource = createMemo(
    () => {
      const agentId = props.agent?.id;
      const api = webhookRoutinesNeeded() ? desktopChatEventRoutinesApi(props.server, props.runtime) : undefined;
      return agentId && api
        ? { api, agentId, serverId: props.server?.id, recovery: remoteRoutineRecovery(props.server) }
        : undefined;
    },
    {
      equals: (left, right) =>
        left?.agentId === right?.agentId && left?.serverId === right?.serverId && left?.recovery === right?.recovery,
    },
  );
  const webhookRoutines = createChatWebhookRoutines(webhookRoutineSource);
  const openRoutineThread = (routineId: string) => {
    const routine =
      props.routines?.find((candidate) => candidate.id === routineId) ??
      webhookRoutines.state.routines.find((candidate) => candidate.id === routineId);
    return routine?.runIn === "chat" ? undefined : props.threads?.routineThread(routineId);
  };
  const routineRunFailureSource = createMemo(
    (): RoutineRunFailureSource | undefined => {
      const agentId = channel ? undefined : props.agent?.id;
      const server = props.server;
      if (!agentId) return undefined;
      if (props.runtime) {
        const routines = props.runtime.routines;
        return routines ? { agentId, serverId: server?.id, listRuns: routines.listRoutineRuns } : undefined;
      }
      if (!server || !serverRoleCanAdminister(server)) return undefined;
      return {
        agentId,
        serverId: server.id,
        listRuns: (input) => window.openbot.agent.listRoutineRuns(input, server.id),
      };
    },
    { equals: (left, right) => left?.agentId === right?.agentId && left?.serverId === right?.serverId },
  );
  const routineRunFailure = createRoutineRunFailures(routineRunFailureSource, timelineMessages);
  const availableRoutineIds = createMemo(() =>
    props.availableRoutineIds
      ? [...props.availableRoutineIds, ...webhookRoutines.state.routines.map((routine) => routine.id)]
      : undefined,
  );
  const webhookRoutineCard = (message: AgentMessage | undefined, marker: ChatActionMarkerModel) => {
    const source = webhookRoutineSource();
    const cardMarker = routineCardMarker(message, marker);
    if (!source || !message || !cardMarker || cardMarker.action === "deleted") return undefined;
    if (latestRoutineMessageIds().get(cardMarker.routineId) !== message.id) return undefined;
    const routine = webhookRoutines.state.routines.find((candidate) => candidate.id === cardMarker.routineId);
    return routine && { api: source.api, action: cardMarker.action, routine };
  };
  const suggestionMarker = (marker: ChatActionMarkerModel) =>
    marker.kind === "marketplace-suggestion" && marketplaceSuggestionKnown(marker.appId) ? marker : undefined;
  const skillSuggestionMarker = (marker: ChatActionMarkerModel) =>
    marker.kind === "skill-suggestion" ? marker : undefined;
  const mcpSignInConfig = (marker: ChatActionMarkerModel) =>
    marker.kind === "mcp-sign-in"
      ? mcpServers().find((config) => config.id === marker.mcpServerId && config.transport === "http")
      : undefined;
  const settingLinkMarker = (marker: ChatActionMarkerModel) => (marker.kind === "setting-link" ? marker : undefined);
  const signInAction = (message: AgentMessage | undefined) => {
    const signIn = props.onSignInProvider;
    const marker = message?.actionMarker;
    return signIn &&
      marker?.kind === "sign-in-failure" &&
      marker.provider !== "opencode" &&
      marker.provider === props.agent?.provider &&
      props.messages.at(-1)?.id === message?.id
      ? (provider: AgentProviderId) => void signIn(provider)
      : undefined;
  };
  const serverInstallCard = (marker: ChatActionMarkerModel) => {
    const watch = props.serverInstall;
    return marker.kind === "server-install" && watch ? { marker, watch } : undefined;
  };
  const virtualMessageRows = createMemo(() => messageVirtualizer.getVirtualItems());
  let timelineScrollElement: HTMLDivElement | undefined;
  const subagentDock = createSubagentDock({
    rows: timelineMessages,
    drawnRows: virtualMessageRows,
    scrollElement: () => timelineScrollElement,
    hidden: sideThreadOpen,
  });
  const revealSubagents = async () => {
    const cardId = subagentDock.cardId();
    if (!cardId) return;
    const row = await replyJump.reveal(cardId, undefined, props.agent?.id);
    const header = row?.querySelector<HTMLElement>(".subagents-group-header");
    header?.scrollIntoView({ block: "nearest" });
    header?.focus({ preventScroll: true });
  };
  const rail = createChatScrollRail({
    rows: timelineMessages,
    question: (message) =>
      message.author === "you" && !message.actionMarker && !otherSender(message) ? message.body : undefined,
    reply: (message) =>
      countableTimelineMessage(message) && REPLY_KINDS.has(message.kind ?? "text") ? message.body : undefined,
    storedCount: () => props.messages.length,
    unloaded: () => props.unloadedHistory,
    virtualizer: messageVirtualizer,
    onLoadOlder: () => props.onLoadOlder?.(),
    onJump: () => setStickToLatest(false),
  });
  const turnSteps = createTurnSteps({
    messages: () => props.messages,
    lines: () => props.turnStepLines,
    activeTurnId: () => props.activeTurnId,
  });
  const showAgentSteps = useShowAgentSteps();
  const compactActions = useCompactMessageActions();
  const bubbleStyle = useChatBubbleStyle();
  const turnTrace = useTurnTrace({ turnSteps, agentName: () => props.agent?.name, agents: () => props.agents });
  const traceAbove = (messageId: string | undefined, agentName?: string): AgentStepsTrace => ({
    ...turnTrace(messageId, agentName),
    canSelectSpan: (id) => id.startsWith(SUBAGENT_SPAN_PREFIX),
    onSelectSpan: (id) => {
      const subagentId = id.slice(SUBAGENT_SPAN_PREFIX.length);
      if (shownSubagentId() !== subagentId) toggleSubagentPanel(subagentId);
    },
  });
  const plainActivity = () => !channel && props.responseStyle === "natural";
  const channelWorkingSteps = createMemo(() => (channel ? turnSteps.workingSteps(channel.workingTurns()) : []));
  const [channelActivity, setChannelActivity] = createSignal<{
    workers: ChannelWorker[];
    steps: readonly AgentStep[];
    phase: "active" | "exiting";
  } | null>(null);
  createEffect(
    (): ChannelWorker[] => channel?.workers() ?? [],
    (workers) => {
      if (workers.length > 0) {
        setChannelActivity({
          workers,
          steps: untrack(channelWorkingSteps),
          phase: "active",
        });
        return;
      }
      if (!untrack(channelActivity)) return;
      let exitTimer: number | undefined;
      const delayTimer = window.setTimeout(() => {
        setChannelActivity((latest) => latest && { ...latest, phase: "exiting" });
        exitTimer = window.setTimeout(() => setChannelActivity(null), agentActivityExitDuration());
      }, agentActivityExitDelay());
      return () => {
        window.clearTimeout(delayTimer);
        window.clearTimeout(exitTimer);
      };
    },
  );
  createEffect(channelWorkingSteps, (steps) => {
    if (untrack(channelActivity)?.phase === "active" && untrack(() => channel?.workers().length))
      setChannelActivity((latest) => latest && { ...latest, steps });
  });
  const backgroundWorkLabel = nextAgentActivityLabel();
  const backgroundWorkSince = () => (props.activeTurnId ? undefined : props.backgroundWorkSince?.(null));
  const emptyAgent = createMemo(() =>
    !channel &&
    timelineMessages().length === 0 &&
    !props.hasOlder &&
    !props.activeTurnId &&
    presentedQueueDeliveries().length === 0 &&
    !(props.queue?.welcome && props.queue.agentId === props.agent?.id) &&
    !renderedAgentActivity() &&
    !props.prompt
      ? props.agent
      : undefined,
  );
  onSettled(preloadConversationCards);
  const sampleRoutinePrompt = () =>
    props.routines?.find((routine) => routine.active && routine.instruction.trim())?.instruction ??
    props.routines?.find((routine) => routine.instruction.trim())?.instruction;
  const sampleSkillName = () =>
    installedSkills().find(
      (skill) => skill.enabled !== false && skill.origin !== "managed" && skill.problem === undefined,
    )?.name;
  return (
    <>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {props.prompt
          ? t("prompt.inputRequiredAnnouncement", {
              question: markdownPlainText(props.prompt.questions[0]?.question ?? ""),
            })
          : ""}
      </span>
      <Show when={chatSearchOpen() && !sideThreadOpen()}>
        <ChatSearch
          query={chatSearchQuery()}
          current={activeChatSearchIndex()}
          total={props.onSearchMessages ? chatSearchTotal() : chatSearchMatches().length}
          inputRef={setChatSearchInputElement}
          onQueryChange={setChatSearchQuery}
          onPrevious={() => moveChatSearch(-1)}
          onNext={() => moveChatSearch(1)}
          onClose={closeChatSearch}
        />
      </Show>

      <Show when={props.unreadCount > 0 && !unreadDividerVisible() && !sideThreadOpen()}>
        <UnreadMessagesBanner
          count={props.unreadCount}
          busy={markingRead()}
          onJumpToUnread={jumpToUnreadMessages}
          onMarkRead={() => void markUnreadMessages()}
        />
      </Show>

      <SubagentDock
        subagents={subagentDock.subagents()}
        cardHeader={subagentDock.cardHeader}
        onReveal={() => void revealSubagents()}
      />

      <div
        class={["conversation-scroll", scrollFades.classes(), { "conversation-covered": sideThreadOpen() }]}
        inert={sideThreadOpen()}
        ref={(element) => {
          timelineScrollElement = element;
          setScrollElement(element);
          rail.ref(element);
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          followReaderScroll(element);
          updateScrollFade(element);
          updateUnreadDividerVisibility();
          replyJump.updateReturnVisibility();
          subagentDock.update();
        }}
      >
        <ChatScrollRail {...rail.props} />
        <Show
          when={replyJump.returnReplyId()}
          fallback={
            <Show when={showScrollToLatest() || props.discontinuous}>
              <ScrollToLatestButton
                onClick={() => void jumpToLatestMessage()}
                newMessageCount={newMessageCount()}
                onDismiss={clearNewMessages}
              />
            </Show>
          }
        >
          <ReplyReturnButton onBack={() => void replyJump.returnToReply()} onStay={replyJump.stayHere} />
        </Show>
        <Show when={props.loaded}>
          <Show when={props.loadingOlder || props.olderError}>
            <div class="conversation-history-status" role={props.olderError ? "alert" : "status"}>
              <Show when={props.olderError} fallback={t("chat.history.loadingOlder")}>
                <span>{props.olderError}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => props.onLoadOlder?.()}>
                  {t("common.retry")}
                </Button>
              </Show>
            </div>
          </Show>
          {channel ? (
            <Show when={timelineMessages().length === 0}>
              <channel.EmptyState />
            </Show>
          ) : (
            <Show when={emptyAgent()}>
              {(agent) => (
                <AgentChatEmptyState
                  agent={agent()}
                  samplePrompt={sampleRoutinePrompt()}
                  sampleSkillName={sampleSkillName()}
                />
              )}
            </Show>
          )}
          <div
            ref={setVirtualRootElement}
            class={["virtual-chat-list", { "virtual-chat-list-static": !messageVirtualizer.isVirtualized() }]}
            style={{ height: messageVirtualizer.isVirtualized() ? `${messageVirtualizer.getTotalSize()}px` : "auto" }}
          >
            <For each={virtualMessageRows()}>
              {(virtualRow) => {
                const index = createMemo(() => timelineIndexById().get(virtualRow.key));
                const message = createMemo(() => {
                  const current = index();
                  return current === undefined ? undefined : timelineMessages()[current];
                });
                const previousMessage = () => {
                  const current = index();
                  return current === undefined ? undefined : timelineMessages()[current - 1];
                };
                const initialMessage = untrack(message);
                if (!initialMessage) return null;
                const arrives = untrack(() => initialMessage.animate === true && markMessageSeen(initialMessage.id));
                const initialActionMarker = untrack(() => initialMessage.actionMarker);
                const animateEntrance =
                  initialActionMarker?.kind === "routine-run"
                    ? untrack(() => markMessageSeen(`routine-run:${initialActionMarker.runId}`)) && arrives
                    : arrives;
                const dayMarker = createMemo(() => {
                  const current = message();
                  if (!current) return null;
                  const previous = previousMessage();
                  if (current.createdAt)
                    return dayMarkerLabel(previous?.createdAt, current.createdAt, {
                      t,
                      format,
                      ...(channel || !compactActions() ? {} : { gapMs: CHAT_TIME_GAP_MS }),
                    });
                  return previous === undefined ? (current.time ?? t("chat.day.now")) : null;
                });
                const continuesRun = createMemo(() => {
                  const current = message();
                  if (!current) return false;
                  if (current.id === unreadBoundaryMessageId() || current.actionMarker) return false;
                  const previous = previousMessage();
                  return continuesSenderRun(previous && senderRunRow(previous), senderRunRow(current), {
                    previousDrawsTime: previous !== undefined && rowDrawsTime(previous),
                    startsDay: dayMarker() !== null,
                  });
                });
                const author = createMemo((): ChatMessageAuthor => {
                  const current = message();
                  const sender = otherSender(current);
                  if (sender) return memberAuthor(sender);
                  if (current?.author === "you")
                    return ownMessageAuthor({
                      name: t("chat.message.you"),
                      style: channel ? "classic" : bubbleStyle(),
                      agent: props.agent,
                      chatColor: ownChatColor(),
                    });
                  if (channel && current) return channel.author(current);
                  return {
                    kind: "agent",
                    name: props.agent?.name ?? t("chat.message.agentFallback"),
                    agent: props.agent,
                  };
                });
                const referencedMessage = createMemo(() => {
                  const replyToMessageId = message()?.replyToMessageId;
                  if (!replyToMessageId) return undefined;
                  const referencedIndex = timelineIndexById().get(replyToMessageId);
                  return (
                    (referencedIndex === undefined ? undefined : timelineMessages()[referencedIndex]) ??
                    props.messageReferences?.[replyToMessageId]
                  );
                });
                const openReference = () => {
                  const current = message();
                  if (current) void replyJump.openReference(current);
                };
                const referencedAuthorName = () => {
                  const referenced = referencedMessage();
                  const sender = otherSender(referenced);
                  if (sender) return memberAuthor(sender).name;
                  return channel && referenced?.author === "agent" ? channel.author(referenced).name : undefined;
                };
                const workspaceAgentId = () => {
                  if (!channel) return props.agent?.id;
                  const current = message();
                  return current?.author === "agent" ? current.senderAgentId : undefined;
                };
                const turnAttachment = (path: string) => {
                  const turnId = message()?.turnId;
                  if (!turnId || /[/\\]/u.test(path)) return undefined;
                  const matches = timelineMessages()
                    .filter((candidate) => candidate.turnId === turnId)
                    .flatMap((candidate) => candidate.attachments ?? [])
                    .filter((attachment) => attachment.name === path);
                  return matches.length === 1 ? matches[0] : undefined;
                };
                const imageScope = () => ({
                  serverId: props.server?.id ?? "local",
                  messageId: message()?.id ?? initialMessage.id,
                  agentId: workspaceAgentId(),
                });
                const writtenFile = (asWritten: string | undefined) => {
                  const agentId = workspaceAgentId();
                  return asWritten && agentId
                    ? () => openWorkspaceFile(asWritten, undefined, agentId, "tab", turnAttachment(asWritten))
                    : undefined;
                };
                const hostless = createMemo(() => message()?.id.startsWith(PENDING_SEND_ID_PREFIX) === true);
                const turnStep = createMemo(() => message()?.itemType === "commentary");
                const pendingSend = createMemo(() => {
                  const send = pendingSendFor(message()?.id);
                  return send && send.state !== "sent" ? send : undefined;
                });
                const pending = createMemo(() => pendingSend() !== undefined);
                const player = createMemo(() => voicePlayer(message()));
                const playerKind = createMemo(() => player()?.kind);
                const replySpeed = () => (playerKind() === "reply" ? speechSpeed() : undefined);
                const replySpeedChange = () => (playerKind() === "reply" ? cycleSpeechSpeed : undefined);
                const pendingState = () => {
                  const state = pendingSend()?.state;
                  return state === "failed" || state === "waiting" ? state : "sending";
                };
                const pendingRetrySafe = () => {
                  const send = pendingSend();
                  return send ? pendingSendRetrySafe(send) : false;
                };
                const markerOnly = untrack(() => markerOnlyMessage(initialMessage));
                const groupedWithMarker = createMemo(() => {
                  const current = message();
                  if (!current?.actionMarker) return false;
                  if (current.id === unreadBoundaryMessageId()) return false;
                  const previous = previousMessage();
                  return previous !== undefined && markerRowEndsWithMarker(previous);
                });
                if (markerOnly) {
                  return (
                    <div
                      data-index={virtualRow.index}
                      data-grouped={groupedWithMarker() ? "marker" : undefined}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          data-chat-search-group={groupedMessageIds(message())}
                          class={{ "chat-action-entry-animated": animateEntrance }}
                        >
                          <Show when={message()?.actionMarker ?? initialActionMarker}>
                            {(marker) => (
                              <Show
                                when={routineCard(message() ?? initialMessage, marker())}
                                fallback={
                                  <Show
                                    when={skillSuggestionMarker(marker())}
                                    fallback={
                                      <Show
                                        when={suggestionMarker(marker())}
                                        fallback={
                                          <Show
                                            when={mcpSignInConfig(marker())}
                                            fallback={
                                              <Show
                                                when={webhookRoutineCard(message() ?? initialMessage, marker())}
                                                fallback={
                                                  <Show
                                                    when={serverInstallCard(marker())}
                                                    fallback={
                                                      <Show
                                                        when={settingLinkMarker(marker())}
                                                        fallback={
                                                          <ChatActionMarker
                                                            onOpenSkill={changeMarkerActions.onOpenSkill}
                                                            marker={marker()}
                                                            agents={props.agents}
                                                            announce={arrives}
                                                            routineAvailable={routineMarkerAvailable(
                                                              marker(),
                                                              availableRoutineIds(),
                                                            )}
                                                            onSelectAgent={props.onSelectAgent}
                                                            onOpenRoutine={openRoutineSettings}
                                                            openRoutineThread={openRoutineThread}
                                                            routineRunFailure={routineRunFailure}
                                                            onOpenHostedSite={(url) => void openExternalMessageUrl(url)}
                                                            onOpenLink={(url) => void openExternalMessageUrl(url)}
                                                            onWithdrawFeedback={withdrawFeedback()}
                                                            onRequestFeedbackChange={requestFeedbackChange()}
                                                            onToggleRoutineRun={toggleRoutineRun}
                                                            onToggleAgentMessage={toggleAgentMessage}
                                                            agentMessageText={agentMessageText}
                                                            instructions={changeMarkerActions.instructions}
                                                            onOpenInstructions={changeMarkerActions.onOpenInstructions}
                                                            onSignInProvider={signInAction(message())}
                                                          />
                                                        }
                                                      >
                                                        {(link) => (
                                                          <SettingLinkChatCard
                                                            settingId={link().settingId}
                                                            agent={
                                                              channel || !props.agent
                                                                ? null
                                                                : { id: props.agent.id, name: props.agent.name }
                                                            }
                                                            onOpenAgentSetting={openAgentSettingRow}
                                                            appSettingOpener={props.appSettingOpener}
                                                          />
                                                        )}
                                                      </Show>
                                                    }
                                                  >
                                                    {(card) => (
                                                      <ServerInstallChatCard
                                                        messageId={message()?.id ?? initialMessage.id}
                                                        name={card().marker.name}
                                                        expiresAt={card().marker.expiresAt}
                                                        watch={card().watch}
                                                      />
                                                    )}
                                                  </Show>
                                                }
                                              >
                                                {(card) => (
                                                  <RoutineWebhookChatCard
                                                    api={card().api}
                                                    action={card().action}
                                                    routine={card().routine}
                                                    connected={webhookRoutines.state.connected}
                                                    agentName={props.agent?.name}
                                                    secret={webhookRoutines.state.secrets[card().routine.id] ?? null}
                                                    onSecret={(secret) =>
                                                      webhookRoutines.setSecret(card().routine.id, secret)
                                                    }
                                                    onOpenRoutine={openRoutineSettings}
                                                  />
                                                )}
                                              </Show>
                                            }
                                          >
                                            {(config) => (
                                              <McpSignInChatCard
                                                config={config()}
                                                signedIn={props.mcpSignedIn?.(config().id) ?? false}
                                                onSignIn={
                                                  props.onOpenMcpSignIn
                                                    ? (trigger) => props.onOpenMcpSignIn?.(config().id, trigger)
                                                    : undefined
                                                }
                                                onContinue={sendCardMessage}
                                              />
                                            )}
                                          </Show>
                                        }
                                      >
                                        {(suggestion) => (
                                          <MarketplaceSuggestionChatCard
                                            messageId={message()?.id ?? initialMessage.id}
                                            appId={suggestion().appId}
                                            connectors={props.connectors}
                                            mcpServers={mcpServers()}
                                            onOpenMarketplaceApp={props.onOpenMarketplaceApp}
                                          />
                                        )}
                                      </Show>
                                    }
                                  >
                                    {(suggestion) => (
                                      <SkillSuggestionChatCard
                                        messageId={message()?.id ?? initialMessage.id}
                                        suggestion={suggestion()}
                                        outcome={skillSuggestionOutcome(
                                          timelineMessages(),
                                          message()?.id ?? initialMessage.id,
                                          suggestion(),
                                          Boolean(props.activeTurnId),
                                        )}
                                        onSave={(reply) =>
                                          saveSkillSuggestion(message()?.id ?? initialMessage.id, reply)
                                        }
                                        onOpenSkill={changeMarkerActions.onOpenSkill}
                                      />
                                    )}
                                  </Show>
                                }
                              >
                                {(card) => (
                                  <RoutineChatCard
                                    action={card().action}
                                    routine={card().routine}
                                    agentId={card().agentId}
                                    onOpenRoutine={openRoutineSettings}
                                  />
                                )}
                              </Show>
                            )}
                          </Show>
                          <Show
                            when={
                              initialMessage.exchange?.direction === "incoming" &&
                              (message()?.attachments?.length ?? 0) > 0
                            }
                          >
                            <div class="chat-action-attachments">
                              <AttachmentCards
                                attachments={message()?.attachments ?? []}
                                mediaSource={runtime.attachmentMedia}
                                downloads={attachmentDownloads}
                                onPreview={(attachment) => void previewAttachment(attachment)}
                                onAction={attachmentAction}
                              />
                            </div>
                          </Show>
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                if (untrack(() => initialMessage.kind === "plan")) {
                  const plan = () => message()?.plan ?? initialMessage.plan;
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          class={{ "message-entry-animated": animateEntrance }}
                        >
                          <Show when={plan()}>
                            {(current) => (
                              <TaskList
                                items={planItems(current(), message()?.streaming === true)}
                                title={planTitle(current(), replacedPlans().has(initialMessage.id))}
                                defaultOpen={untrack(() => initialMessage.streaming === true)}
                              />
                            )}
                          </Show>
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                if (untrack(() => initialMessage.kind === "subagents")) {
                  const subagents = () => message()?.subagents ?? initialMessage.subagents;
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          class={{ "message-entry-animated": animateEntrance }}
                        >
                          <Show when={subagents()}>
                            {(current) => (
                              <SubagentGroup
                                subagents={current()}
                                selectedId={shownSubagentId()}
                                onOpen={toggleSubagentPanel}
                              />
                            )}
                          </Show>
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                if (untrack(() => initialMessage.kind === "memory-changes" || initialMessage.kind === "thinking")) {
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article data-chat-search-message={message()?.id}>
                          <AgentStepsDisclosure
                            steps={turnSteps.stepsOfTurn((message() ?? initialMessage).turnId)}
                            defaultOpen={showAgentSteps()}
                          />
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                const initialVisual = untrack(() => shownVisualReply(initialMessage, runtime.visualPage));
                if (initialVisual) {
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          aria-label={(message() ?? initialMessage).body}
                          class={{
                            "message-entry-animated": animateEntrance,
                            "chat-visual-with-author": Boolean(channel) && author().kind === "agent",
                          }}
                        >
                          <ChatVisualReply
                            message={message() ?? initialMessage}
                            initial={initialVisual}
                            onMessage={addPageText}
                            onContext={(text) => setPageContext(message() ?? initialMessage, text)}
                            onQuote={quoteSelection}
                          />
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                const displayedReactions = createMemo(() => {
                  const currentMessage = message();
                  if (currentMessage?.reactions?.length) return currentMessage.reactions;
                  if (currentMessage?.reaction) {
                    return [{ emoji: currentMessage.reaction, actor: { kind: "user" as const } }];
                  }
                  return (currentMessage?.reactionSummary?.emojis ?? []).map((emoji) => ({
                    emoji,
                    actor: { kind: "user" as const },
                  }));
                });
                const messageActions = {
                  onReact: (emoji: MessageReaction | null) => {
                    const currentMessage = message();
                    if (currentMessage) void reactToMessage(currentMessage, emoji);
                  },
                  onReply: () => {
                    const currentMessage = message();
                    if (currentMessage) replyToMessage(currentMessage);
                  },
                  onCopy: () => {
                    const currentMessage = message();
                    if (currentMessage) void copyMessage(currentMessage);
                  },
                };
                const stepsInRow = () =>
                  author().kind === "agent" && !message()?.questionPrompt && (Boolean(channel) || !showAgentSteps());
                const actionsBeside = () => stepsInRow() || author().kind === "you";
                const stepsDisclosure = () => (
                  <Show when={turnSteps.stepsAbove(message()?.id)}>
                    {(steps) => (
                      <AgentStepsDisclosure
                        steps={steps()}
                        defaultOpen={showAgentSteps()}
                        list={!stepsInRow()}
                        trace={traceAbove(
                          message()?.id,
                          channel && author().kind === "agent" ? author().name : undefined,
                        )}
                        facts={turnSteps.factsAbove(message()?.id)}
                      />
                    )}
                  </Show>
                );
                const messageReadAloud = () =>
                  spokenReplyIds().has((message() ?? initialMessage).id)
                    ? undefined
                    : readAloudAction(message() ?? initialMessage);
                const menuItems = (): MessageMenuItemsProps => ({
                  message: message() ?? initialMessage,
                  reactions: !channel,
                  ...messageActions,
                  readAloud: messageReadAloud(),
                  onMarkUnread: markUnreadAction(message() ?? initialMessage),
                  sendToChannel: sendToChannelAction(message() ?? initialMessage),
                  onBranch: branchAction(message() ?? initialMessage),
                  branchDisabled: Boolean(props.activeTurnId),
                  pin: pinAction(message() ?? initialMessage),
                  onUseAsBackdrop: backdropAction(message() ?? initialMessage),
                  onDelete: deleteAction(message() ?? initialMessage),
                });
                const rowMenu = () => (compactActions() ? () => <MessageMenuItems {...menuItems()} /> : undefined);
                const rowCopy = () => (compactActions() ? undefined : messageActions.onCopy);
                const rowCopied = () => !compactActions() && copiedMessageId() === message()?.id;
                const rowReadAloud = () => (compactActions() ? undefined : messageReadAloud());
                const rowBranch = () => (compactActions() ? undefined : branchAction(message() ?? initialMessage));
                const rowActionTime = () => Boolean(channel) || !compactActions();
                return (
                  <div
                    data-index={virtualRow.index}
                    data-grouped={groupedWithMarker() ? "marker" : continuesRun() ? "sender" : undefined}
                    ref={messageVirtualizer.measureElement}
                    class="virtual-chat-row"
                    style={{
                      transform: messageVirtualizer.isVirtualized()
                        ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                        : "none",
                    }}
                  >
                    <Show when={message()?.id === compactionBefore()}>
                      <CompactionMarker />
                    </Show>
                    <Show when={dayMarker()}>
                      {(label) => (
                        <div class="time-marker">
                          <span>{label()}</span>
                        </div>
                      )}
                    </Show>
                    <Show when={message()?.id === unreadBoundaryMessageId()}>
                      <UnreadMessagesDivider
                        animateIn={unreadDividerArrives}
                        elementRef={(element) => {
                          setUnreadMessagesDividerElement(element);
                          scheduleUnreadDividerVisibilityUpdate();
                        }}
                      />
                    </Show>
                    <Show when={!stepsInRow() && turnSteps.stepsAbove(message()?.id)}>
                      <ChatRowBoundary>{stepsDisclosure()}</ChatRowBoundary>
                    </Show>
                    <ChatRowBoundary>
                      <Show
                        when={message()?.questionPrompt}
                        keyed
                        fallback={
                          <ChatMessageRow
                            message={message() ?? initialMessage}
                            author={author()}
                            showFull={
                              chatSearchOpen() && chatSearchOpensMessage(message()?.body ?? "", chatSearchQuery())
                            }
                            open={quotedMessageId() === message()?.id && chatSearchCanOpen(message()?.body ?? "")}
                            showAuthor={
                              author().kind === "member" || (channel && author().kind === "agent")
                                ? !continuesRun()
                                : undefined
                            }
                            showTime={!continuesRun()}
                            actionRow={!turnStep()}
                            actionTime={rowActionTime()}
                            steps={stepsInRow() ? stepsDisclosure() : undefined}
                            actionsBeside={actionsBeside()}
                            animate={animateEntrance}
                            textAtOnce={props.responseStyle === "natural"}
                            agents={props.agents}
                            skills={installedSkills()}
                            referencedMessage={referencedMessage()}
                            referencedAuthorName={referencedAuthorName()}
                            onOpenReference={openReference}
                            referenceState={replyJump.referenceState(message(), referencedMessage())}
                            reactions={channel ? undefined : displayedReactions()}
                            reactionOverflowCount={message()?.reactionSummary?.overflowCount}
                            onRemoveReaction={() => {
                              const currentMessage = message();
                              if (currentMessage) void reactToMessage(currentMessage, null);
                            }}
                            data-chat-search-message={message()?.id}
                            onSelectAgent={props.onSelectAgent}
                            onOpenLink={(url) => void openExternalMessageUrl(url)}
                            onPreview={(attachment) => void previewAttachment(attachment)}
                            onAttachmentAction={attachmentAction}
                            onOpenSharedFile={(path, asWritten) => openSharedFile(path, "tab", writtenFile(asWritten))}
                            onOpenWorkspaceFile={
                              workspaceAgentId()
                                ? (path, asWritten) =>
                                    openWorkspaceFile(
                                      path,
                                      undefined,
                                      workspaceAgentId(),
                                      "tab",
                                      turnAttachment(path),
                                      writtenFile(asWritten),
                                    )
                                : undefined
                            }
                            onOpenQuote={openQuote}
                            onOpenTag={openTaggedReference}
                            onDownload={(attachment) => attachmentAction(attachment, "download")}
                            mediaSource={runtime.attachmentMedia}
                            downloads={attachmentDownloads}
                            macWindowControls={props.platform === "darwin"}
                            loadImageFile={messageImageFiles && ((file) => messageImageFiles.load(file, imageScope()))}
                            onDownloadImageFile={
                              messageImageFiles &&
                              ((file) =>
                                downloadMessageImageFile(
                                  messageImageFiles.source(file, imageScope()),
                                  workspaceAgentId(),
                                ))
                            }
                            actions={
                              <>
                                <Show when={pending()}>
                                  <PendingSendStatus
                                    state={pendingState()}
                                    updateRequired={Boolean(providerUpdateRequired())}
                                    error={pendingSend()?.error ?? null}
                                    errorReference={pendingSend()?.errorReference ?? null}
                                    retrySafe={pendingRetrySafe()}
                                    canEdit={!composerHasContent() && !editingDeliveryId()}
                                    onRetry={() => {
                                      const send = pendingSend();
                                      if (send) retryPendingSend(send.clientMessageId);
                                    }}
                                    onEdit={() => {
                                      const send = pendingSend();
                                      if (send) editPendingSend(send.clientMessageId);
                                    }}
                                    onDismiss={() => {
                                      const send = pendingSend();
                                      if (send) dismissPendingSend(send.clientMessageId);
                                    }}
                                  />
                                </Show>
                                <Show when={!hostless() && !turnStep()}>
                                  <MessageActions
                                    message={message() ?? initialMessage}
                                    pickerOpen={openReactionMessageId() === message()?.id}
                                    expandedEmoji={expandedEmojiMessageId() === message()?.id}
                                    reactions={!channel}
                                    authorName={channel ? author().name : undefined}
                                    onTogglePicker={() => {
                                      const messageId = message()?.id;
                                      if (!messageId) return;
                                      setOpenReactionMessageId((current) => (current === messageId ? null : messageId));
                                      setExpandedEmojiMessageId(null);
                                    }}
                                    onExpandEmoji={() => {
                                      const messageId = message()?.id;
                                      if (!messageId) return;
                                      setExpandedEmojiMessageId((current) =>
                                        current === messageId ? null : messageId,
                                      );
                                    }}
                                    onReact={messageActions.onReact}
                                    onReply={messageActions.onReply}
                                    menu={rowMenu()}
                                    onCopy={rowCopy()}
                                    copied={rowCopied()}
                                    readAloud={rowReadAloud()}
                                    onBranch={rowBranch()}
                                    branchDisabled={Boolean(props.activeTurnId)}
                                  />
                                </Show>
                              </>
                            }
                            menu={
                              hostless() || turnStep()
                                ? undefined
                                : () => (
                                    <MessageMenu {...menuItems()} authorName={channel ? author().name : undefined} />
                                  )
                            }
                          >
                            <Show when={playerKind()}>
                              {(kind) => (
                                <VoicePlayer
                                  kind={kind()}
                                  state={player()?.state ?? "idle"}
                                  peaks={player()?.peaks}
                                  duration={player()?.duration}
                                  elapsed={player()?.elapsed}
                                  levels={player()?.levels}
                                  onToggle={() => player()?.onToggle()}
                                  onSeek={(seconds) => player()?.onSeek?.(seconds)}
                                  speed={replySpeed()}
                                  onCycleSpeed={replySpeedChange()}
                                />
                              )}
                            </Show>
                          </ChatMessageRow>
                        }
                      >
                        {(questionPrompt) => (
                          <Show
                            when={frozenUiBlock(message())}
                            fallback={
                              <Show when={questionPrompt.resolution} keyed>
                                {(resolution) => (
                                  <article
                                    data-chat-search-message={message()?.id}
                                    class="question-prompt-history-entry"
                                  >
                                    <QuestionPromptBubble
                                      questions={questionPrompt.questions}
                                      resolution={resolution}
                                      onSubmit={async () => false}
                                      onOpenLink={(url) => void openExternalMessageUrl(url)}
                                    />
                                  </article>
                                )}
                              </Show>
                            }
                          >
                            {(block) => (
                              <article data-chat-search-message={message()?.id} class="question-prompt-history-entry">
                                <UiBlockPrompt
                                  block={block()}
                                  agents={props.agents}
                                  onSelectAgent={props.onSelectAgent}
                                  onOpenLink={(url) => void openExternalMessageUrl(url)}
                                />
                              </article>
                            )}
                          </Show>
                        )}
                      </Show>
                    </ChatRowBoundary>
                  </div>
                );
              }}
            </For>
          </div>
          <div class="conversation-live">
            <Show when={!compactionBefore()}>
              <CompactionMarker />
            </Show>
            <Show when={!sideThreadOpen()}>
              <div class={{ "question-prompt-with-author": Boolean(channel) }}>
                <ConversationQuestionPrompt
                  elementRef={setRequiredInteractionElement}
                  registerComposerAnswer={registerPromptComposerAnswer}
                />
              </div>
            </Show>
            <Show keyed when={props.approval ?? heldFeedback()}>
              {(approval) => (
                <Loading>
                  <ApprovalCard
                    approval={approval}
                    agentName={interactionAgentName()}
                    sending={heldFeedback() !== undefined}
                    onApprove={() => approve(approval)}
                    onReject={() => props.onRespondToApproval("decline")}
                    onAlwaysAllow={props.onAlwaysAllowApproval}
                  />
                </Loading>
              )}
            </Show>
            <Show when={props.usageLimitAsk}>
              {(ask) => (
                <UsageLimitAskCard
                  provider={ask().provider}
                  model={ask().model}
                  agentName={ask().agentName}
                  resetsAt={ask().resetsAt}
                  options={ask().options}
                  onSend={ask().onSend}
                  onWait={ask().onWait}
                />
              )}
            </Show>
            <Show when={!sideThreadOpen()}>
              <ConversationBrowserTakeover />
            </Show>
            <div
              class="agent-activity-slot"
              data-reserved={agentActivitySpaceReserved() ? "true" : "false"}
              ref={setAgentActivitySlotElement}
            >
              <Show
                when={!channel}
                fallback={
                  <Show when={channelActivity()}>
                    {(activity) => (
                      <ChannelActivityIndicator
                        workers={activity().workers}
                        steps={activity().steps}
                        phase={activity().phase}
                        stepsOpenByDefault={showAgentSteps()}
                      />
                    )}
                  </Show>
                }
              >
                <Show
                  when={renderedAgentActivity()}
                  fallback={
                    <Show when={backgroundWorkSince()}>
                      {(since) => (
                        <AgentActivityIndicator
                          agent={props.agent}
                          detail={t("chat.activity.backgroundWork")}
                          label={backgroundWorkLabel}
                          since={since()}
                        />
                      )}
                    </Show>
                  }
                >
                  {(activity) => (
                    <AgentActivityIndicator
                      agent={activity().agent}
                      detail={activity().detail}
                      label={activity().label}
                      phase={activity().phase}
                      since={activity().since}
                      steps={turnSteps.activeSteps()}
                      stepsOpenByDefault={showAgentSteps()}
                      waitingFor={waitingProviderName()}
                      plain={plainActivity()}
                      outputShown={activeTurnOutputShown()}
                      activity={activeStepActivity()}
                    />
                  )}
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </div>
      <DeleteMessageDialog
        messageId={deleteTargetId()}
        onDelete={deleteMessage}
        onClose={() => setDeleteTargetId(null)}
      />
    </>
  );
}
