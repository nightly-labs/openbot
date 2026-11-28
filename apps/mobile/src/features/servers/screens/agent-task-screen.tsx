import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentTask, RespondToPromptInput } from "@openbot/contracts/ipc";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, useColorScheme, View } from "react-native";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import {
  asksForSecret,
  BrowserSecretComposer,
  BrowserTakeoverCard,
  QuestionSecretComposer,
} from "@/features/chat/components/browser-secret-card";
import type { ApprovalDecision } from "@/features/chat/components/chat-approval-card";
import { ChatAttachmentPanel } from "@/features/chat/components/chat-attachment-panel";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatEndPullRing, useChatEndPull } from "@/features/chat/components/chat-end-pull";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { DRAFT_THREAD_ID, useChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useRowsAfterOpenTransition } from "@/features/chat/components/chat-view";
import { useMarkThreadRead, useThreadOpeningUnread } from "@/features/chat/components/use-agent-thread-reads";
import { useBranchThread } from "@/features/chat/components/use-branch-thread";
import { useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import {
  useComposerDictation,
  useComposerDictationWithSettings,
} from "@/features/chat/components/use-composer-dictation";
import { useComposerContextMeter } from "@/features/chat/components/use-context-usage";
import { useLeaveChat } from "@/features/chat/components/use-leave-chat";
import { useMessageDelete } from "@/features/chat/components/use-message-delete";
import { useMessagePins } from "@/features/chat/components/use-message-pins";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { branchDividerRowId } from "@/features/chat/model/branch-points";
import { mentionDraft } from "@/features/chat/model/chat-mentions";
import {
  type ChatBubbleMessage,
  chatRowIndex,
  keptIdSet,
  latestReadBoundaryMessage,
  projectChatMessages,
  withQuestionContext,
} from "@/features/chat/model/chat-messages";
import type { AgentChatTarget } from "@/features/chat/model/chat-target";
import { promptAskedByThisPerson } from "@/features/chat/model/location-request";
import {
  answerlessTurnSummaries,
  finishedTurnSummaries,
  type TurnStepsSummary,
} from "@/features/chat/model/turn-thinking";
import { uploadChatAttachments } from "@/features/chat/model/upload-chat-attachments";
import { useAgentMentionReferences } from "@/features/chat/model/use-agent-mention-references";
import { useAgentMentionSkills } from "@/features/chat/model/use-agent-mention-skills";
import { useProgressUpdates } from "@/features/chat/model/use-progress-updates";
import { voiceAccent, voicePalette } from "@/features/chat/model/voice-palette";
import { agentTaskHoldText } from "@/features/servers/model/agent-task-text";
import { taskStartId } from "@/features/servers/model/task-start-id";
import { useThreadActions } from "@/features/servers/model/use-thread-actions";
import { useChatRowShown, useThinkingDisplayPreference } from "@/features/settings/model/chat-details";
import { useChatPullPreference } from "@/features/settings/model/chat-swipe";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import { useTurnStepLines } from "@/features/workspace/components/use-agent-activity";
import {
  useApprovalRequests,
  useBrowserRequests,
  useThreadWaits,
} from "@/features/workspace/components/use-live-workspace";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { PendingApproval } from "@/features/workspace/model/pending-approvals";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { addStartedTask, loadNewestTaskConversation } from "@/features/workspace/model/task-cache";
import { hostAwaitsQuestion } from "@/features/workspace/model/thread-waits";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useAppActive } from "@/shared/lib/use-app-active";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useReducedTransparency } from "@/shared/lib/use-reduced-transparency";

const NO_MESSAGES: never[] = [];
const PINS_ACTION = "pinned-messages";
const NO_ALIASES: ReadonlyMap<string, string> = new Map();
const NO_OLDER = () => {};
const AWAIT_TURN_MS = 10_000;
const taskMessageId = retryOperationIds(() => Crypto.randomUUID());

function onThreadDeleted(task: AgentTask, serverId: string) {
  router.dismissTo({ pathname: "/chat/[agentId]", params: { agentId: task.agentId, serverId } });
}

export function AgentTaskScreen() {
  const { t } = useText();
  const { serverId, agentId, taskId, messageId, focusAt } = useLocalSearchParams<{
    serverId: string;
    agentId: string;
    taskId: string;
    messageId?: string;
    focusAt?: string;
  }>();
  const agent = useMobileWorkspaceSelector((workspace) =>
    workspace.agents.find((item) => item.id === agentId && item.serverId === serverId),
  );
  if (agent)
    return (
      <AgentTaskChat
        key={`${serverId}:${taskId}:${focusAt ?? ""}`}
        target={{ ...agent, kind: "agent" }}
        taskId={taskId}
        focusMessageId={messageId || null}
      />
    );
  return <TaskNote note={t("mobile.server.threads.notFound")} />;
}

function TaskNote({ note, retry }: { note: string; retry?: () => void }) {
  const { t } = useText();
  const leaveTask = useLeaveChat();
  const foreground = useThemeColor("foreground");
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-5 bg-background"
      style={{ paddingLeft: insets.left + 32, paddingRight: insets.right + 32 }}
    >
      <Typography.Paragraph align="center" className="text-text-secondary">
        {note}
      </Typography.Paragraph>
      <Pressable
        accessibilityRole="button"
        className="min-h-12 flex-row items-center gap-2 rounded-full bg-control px-5"
        onPress={() => {
          void haptics.impact("soft");
          if (retry) retry();
          else leaveTask();
        }}
      >
        {retry ? null : <ArrowLeft color={String(foreground)} size={20} strokeWidth={2} style={MIRROR_IN_RTL} />}
        <Typography.Paragraph weight="semibold">{retry ? t("common.retry") : t("common.back")}</Typography.Paragraph>
      </Pressable>
    </View>
  );
}

function AgentTaskChat({
  target,
  taskId,
  focusMessageId,
}: {
  target: AgentChatTarget;
  taskId: string;
  focusMessageId: string | null;
}) {
  const { t, errorMessage } = useText();
  const leaveTask = useLeaveChat();
  const { serverId, id: agentId } = target;
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const isDraft = taskId === DRAFT_THREAD_ID;
  const threadMenu = useChatThreadMenu(target, taskId);
  const mentionReferences = useAgentMentionReferences(serverId, agentId, taskId);
  const threadActions = useThreadActions(target.serverId, onThreadDeleted);
  const pins = useMessagePins(serverId, agentId);
  const pinsEnabled = pins.enabled;
  const pinnedMessageIds = useMemo(
    () => new Set(pins.pins.filter((pin) => pin.taskId === taskId).map((pin) => pin.messageId)),
    [pins.pins, taskId],
  );
  const server = useMobileWorkspaceSelector((workspace) => workspace.servers.find((item) => item.id === serverId));
  const agents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const tasksAllowed = useMobileWorkspaceSelector((workspace) => workspace.canUseTasks(serverId));
  const filesAllowed = useMobileWorkspaceSelector((workspace) => workspace.canAttachThreadFiles(serverId));
  const browserViewAvailable = useMobileWorkspaceSelector((workspace) => workspace.browserViewSupport(serverId).view);
  const wholeApprovals = useMobileWorkspaceSelector((workspace) => workspace.readsWholeApprovals(serverId));
  const readWorkspace = useMobileWorkspaceReader();
  const {
    uploadAttachment,
    discardAttachment,
    startAgentTask,
    loadAgentTasks,
    loadAgentTaskConversation,
    sendAgentTaskMessage,
    respondToTaskPrompt,
    respondToApproval,
    readWholeApproval,
    respondToBrowserTakeover,
    respondToBrowserSecret,
  } = useMobileWorkspaceActions();
  const online = showsOnline(server);
  const enabled = server?.state === "online" && tasksAllowed;
  const serverAgents = useMemo(() => agents.filter((item) => item.serverId === serverId), [agents, serverId]);
  const list = useQuery({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    enabled,
    retry: false,
    queryFn: () => loadAgentTasks(agentId, serverId),
  });
  const conversationKey = queryKeys.agentTaskConversation(queryScope, serverId, taskId);
  const conversation = useQuery({
    queryKey: conversationKey,
    enabled: enabled && !isDraft,
    retry: false,
    queryFn: () =>
      loadNewestTaskConversation(queryClient, conversationKey, () =>
        loadAgentTaskConversation({ agentId, taskId }, serverId),
      ),
  });
  const task = list.data?.tasks.find((item) => item.id === taskId);
  const memberId = server?.membershipId ?? null;
  const accountUserId = useMobileSession().session?.user.id ?? null;
  const progressUpdates = useProgressUpdates(serverId, serverAgents, agentId);
  const activeTurnId = task?.activeTurnId ?? null;
  const messages = useMemo(
    () =>
      conversation.data
        ? withQuestionContext(
            projectChatMessages(conversation.data.messages, memberId, accountUserId, progressUpdates),
            activeTurnId,
          )
        : NO_MESSAGES,
    [conversation.data, memberId, accountUserId, progressUpdates, activeTurnId],
  );
  const branching = useBranchThread({
    serverId,
    agentId,
    sourceTaskId: taskId,
    messages: task ? conversation.data?.messages : undefined,
    activeTurnId,
  });
  const branch = branching.branch;
  const link = task?.branch ?? null;
  const dividerAfterId =
    link && conversation.data ? branchDividerRowId(conversation.data.messages, messages, link.throughMessageId) : null;
  const sourceTitle =
    link === null
      ? null
      : link.sourceTaskId === null
        ? target.name
        : (list.data?.tasks.find((entry) => entry.id === link.sourceTaskId)?.title ?? link.sourceTitle);
  const branchDivider = useMemo(
    () => (dividerAfterId ? { afterId: dividerAfterId, label: sourceTitle } : null),
    [dividerAfterId, sourceTitle],
  );
  const openBranchSource = useMemo(
    () =>
      link && sourceTitle !== null
        ? () => {
            if (link.sourceTaskId === null)
              router.dismissTo({
                pathname: "/chat/[agentId]",
                params: { agentId, serverId, messageId: link.sourceMessageId },
              });
            else router.setParams<"/task/[taskId]">({ taskId: link.sourceTaskId, messageId: link.sourceMessageId });
          }
        : undefined,
    [link, sourceTitle, agentId, serverId],
  );
  const [focus, setFocus] = useState(focusMessageId);
  const openingUnread = useThreadOpeningUnread(serverId, agentId, isDraft ? null : taskId);
  const [unreadLine, setUnreadLine] = useState<{ messageId: string | null } | null>(null);
  const connecting = Boolean(server?.initialConnectionPending) || (online && server?.state !== "online");
  if (unreadLine === null && openingUnread.firstUnread !== undefined && !connecting && (isDraft || conversation.data))
    setUnreadLine({ messageId: openingUnread.firstUnread });
  const unreadLineMessageId = unreadLine?.messageId ?? null;
  const lastUnreadLineIds = useRef<ReadonlySet<string> | null>(null);
  const unreadLineMessageIds = useMemo(() => {
    const entries = conversation.data?.messages ?? [];
    const start = unreadLineMessageId ? entries.findIndex((message) => message.id === unreadLineMessageId) : -1;
    lastUnreadLineIds.current =
      start < 0
        ? null
        : keptIdSet(
            lastUnreadLineIds.current,
            entries.slice(start).map((message) => message.id),
          );
    return lastUnreadLineIds.current;
  }, [unreadLineMessageId, conversation.data?.messages]);
  const [unreadOpening, setUnreadOpening] = useState<"pending" | "done">("pending");
  const opensAtUnread =
    focus === null &&
    unreadOpening === "pending" &&
    online &&
    (unreadLine === null ? !isDraft && !connecting && openingUnread.keptUnread : unreadLineMessageIds !== null);
  const clearFocus = useCallback(() => {
    setFocus(null);
    setUnreadOpening("done");
  }, []);
  const turnLines = useTurnStepLines(serverId);
  const lastTurnSummaries = useRef<ReadonlyMap<string, TurnStepsSummary> | undefined>(undefined);
  const showThinking = useThinkingDisplayPreference((state) => state.enabled);
  const allTurnSummaries = useMemo(() => {
    lastTurnSummaries.current = conversation.data
      ? finishedTurnSummaries(conversation.data.messages, activeTurnId, turnLines, lastTurnSummaries.current)
      : undefined;
    return lastTurnSummaries.current;
  }, [conversation.data, activeTurnId, turnLines]);
  const answerlessSummaries = useMemo(() => answerlessTurnSummaries(allTurnSummaries), [allTurnSummaries]);
  const turnSummaries = showThinking ? allTurnSummaries : answerlessSummaries;
  const rowShown = useChatRowShown(turnSummaries);
  const openTurn = useCallback(
    (turnId: string) => router.push({ pathname: "/turn-thinking", params: { agentId, serverId, taskId, turnId } }),
    [agentId, serverId, taskId],
  );
  const threadWaits = useThreadWaits(serverId);
  const activePrompt = messages.findLast(
    (row) =>
      row.kind === "question" &&
      !row.prompt.resolution &&
      ((activeTurnId !== null && row.turnId === activeTurnId) ||
        hostAwaitsQuestion(threadWaits, agentId, row.turnId, row.prompt.requestId)),
  );
  const respond = useCallback(
    (_agentId: string, input: RespondToPromptInput) => respondToTaskPrompt(input, serverId),
    [respondToTaskPrompt, serverId],
  );
  const questionForm = useQuestionPrompt(
    agentId,
    activePrompt?.kind === "question" ? activePrompt : undefined,
    online,
    respond,
    (text) => setDraft((current) => (current.trim() ? `${current.trimEnd()}\n${text}` : text)),
    promptAskedByThisPerson(messages, activePrompt?.id),
  );
  const answersQuestion = Boolean(questionForm.question && !questionForm.question.isSecret && questionForm.replyInChat);
  const threadId = conversation.data?.threadId ?? null;
  const contextMeter = useComposerContextMeter({
    serverId,
    agentId,
    task: { taskId, threadId: isDraft ? null : threadId },
  });
  const browserRequests = useBrowserRequests(serverId);
  const taskBrowserRequests = useMemo(
    () =>
      threadId === null
        ? []
        : browserRequests.filter((request) => request.agentId === agentId && request.threadId === threadId),
    [browserRequests, agentId, threadId],
  );
  const waitReason = questionForm.question ? "question" : taskBrowserRequests.length > 0 ? "takeover" : null;
  const activity = useMemo<MobileAgentActivity | undefined>(
    () =>
      task?.state === "running"
        ? waitReason
          ? { agentId, turnId: activeTurnId, phase: "waiting", detail: null, reason: waitReason }
          : { agentId, turnId: activeTurnId, phase: "working", detail: null }
        : undefined,
    [task?.state, waitReason, agentId, activeTurnId],
  );
  const serverApprovals = useApprovalRequests(serverId);
  const approvals = useMemo(
    () =>
      threadId === null
        ? []
        : serverApprovals.filter((approval) => approval.agentId === agentId && approval.threadId === threadId),
    [serverApprovals, agentId, threadId],
  );

  const isFocused = useIsFocused();
  const foregroundVisit = useAppForeground();
  const browserAllowed = useBrowserFeature();
  const insets = useSafeAreaInsets();
  const keyboardOffset = Math.max(insets.bottom, 10) - 10;
  const reducedTransparency = useReducedTransparency();
  const liquidGlassAvailable = isLiquidGlassAvailable() && !reducedTransparency;
  const [foreground, muted, fieldBackground, raised, action, actionForeground, background] = useThemeColor([
    "foreground",
    "muted",
    "default",
    "surface-tertiary",
    "accent",
    "accent-foreground",
    "background",
  ]);
  const appActive = useAppActive();
  useMarkThreadRead(
    serverId,
    agentId,
    task ? taskId : null,
    isFocused && appActive && conversation.data && unreadLine !== null
      ? (latestReadBoundaryMessage(conversation.data.messages)?.id ?? null)
      : null,
    task?.updatedAt ?? null,
  );
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const attachments = useChatAttachments([], undefined, () => readWorkspace().attachmentSupport(serverId));
  const menuProgress = useSharedValue(0);
  const [awaitingTurn, setAwaitingTurn] = useState(false);
  const ready = isDraft || Boolean(conversation.data);
  const rowsShown = useRowsAfterOpenTransition();
  const lastUserId = messages.findLast((row) => row.kind === "message" && row.author === "user")?.id ?? null;
  const motion = useChatMotion(
    insets.top + 84,
    keyboardOffset,
    ready && rowsShown,
    rowsShown && messages.some(rowShown),
    lastUserId,
    questionForm.question ? (questionForm.messageId ?? null) : null,
    focus !== null || opensAtUnread,
  );
  const focusMissing = focus !== null && Boolean(conversation.data) && chatRowIndex(messages, focus) < 0;
  useEffect(() => {
    if (!focusMissing) return;
    setFocus(null);
    setUnreadOpening("done");
  }, [focusMissing]);
  const shownWithoutFocus = motion.historyVisible && focus === null && !opensAtUnread;
  useEffect(() => {
    if (shownWithoutFocus) setUnreadOpening("done");
  }, [shownWithoutFocus]);
  const closed = task?.state === "closed";
  const canSend = online && !closed && (!isDraft || enabled);
  const messageDelete = useMessageDelete(serverId, { kind: "agent", agentId, taskId });
  const removeMessage = messageDelete.deleteMessage;
  const deleteTaskMessage = useCallback(
    async (message: ChatBubbleMessage) => {
      await removeMessage?.(message.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentTaskConversation(queryScope, serverId, taskId) });
    },
    [removeMessage, queryClient, queryScope, serverId, taskId],
  );
  const deleteMessage = removeMessage && !isDraft && !closed ? deleteTaskMessage : undefined;
  const dictation = useComposerDictation({
    enabled: isFocused && canSend,
    focused: isFocused,
    draft,
    onDraft: setDraft,
  });
  const dictating = dictation.active;
  const composerDictation = useComposerDictationWithSettings(dictation);
  const mentionSkills = useAgentMentionSkills(agentId, serverId, canSend);
  const [skillPickerVersion, setSkillPickerVersion] = useState(0);
  const pullOn = useChatPullPreference((state) => state.enabled);
  const openInfo = useCallback(
    () => router.push({ pathname: "/agent-info/[agentId]", params: { agentId, serverId } }),
    [agentId, serverId],
  );
  const endPull = useChatEndPull({
    motion,
    enabled: pullOn && !attachments.menuOpen && !dictating,
    onOpen: openInfo,
  });
  const showBrowserRequests = online && foregroundVisit && isFocused;
  const keepsComposer = dictating || attachments.menuOpen;
  const secretRequest = showBrowserRequests && !keepsComposer ? taskBrowserRequests.find(asksForSecret) : undefined;
  const secretQuestion = !secretRequest && !keepsComposer && questionForm.question?.isSecret ? questionForm : undefined;
  const dark = useColorScheme() === "dark";
  const palette = useMemo(
    () => voicePalette([avatarHeadColor(target.avatarSeed, target.avatarHue, target.avatarColor)], dark),
    [target.avatarSeed, target.avatarHue, target.avatarColor, dark],
  );
  const accent = useMemo(() => voiceAccent(palette), [palette]);

  const tailUserIndex = messages.findLastIndex((row) => row.kind === "message" && row.author === "user");
  const turnShown = Boolean(activity || activeTurnId) || tailUserIndex < messages.length - 1;
  useEffect(() => {
    if (awaitingTurn && turnShown) setAwaitingTurn(false);
  }, [awaitingTurn, turnShown]);
  useEffect(() => {
    if (!awaitingTurn) return;
    const timer = setTimeout(() => setAwaitingTurn(false), AWAIT_TURN_MS);
    return () => clearTimeout(timer);
  }, [awaitingTurn]);

  async function send(value: string) {
    const text = value.trim();
    const files = filesAllowed ? attachments.items : [];
    if ((!text && files.length === 0) || !canSend || (sending && (isDraft || files.length > 0))) return;
    if (files.length > INPUT_LIMITS.attachments) {
      void haptics.notification("error");
      setSendError(t("mobile.chat.attachment.limit", { limit: INPUT_LIMITS.attachments }));
      return;
    }
    setDraft("");
    setSendError(null);
    Keyboard.dismiss();
    void haptics.impact();
    if (answersQuestion && files.length === 0) {
      if (!questionForm.disabled) questionForm.answerText(mentionDraft(text).text);
      return;
    }
    const withFiles = <R,>(deliver: (attachmentDraftIds: string[]) => Promise<R>) =>
      uploadChatAttachments(files, {
        upload: (file, onProgress) => uploadAttachment(agentId, file, serverId, onProgress),
        discard: (id) => discardAttachment(agentId, id, serverId),
        send: deliver,
      });
    if (isDraft) {
      setSending(true);
      const start = taskStartId(
        serverId,
        agentId,
        text,
        files.map((file) => file.id),
      );
      try {
        const started = await withFiles((attachmentDraftIds) =>
          startAgentTask({ agentId, text, attachmentDraftIds, clientMessageId: start.id }, serverId),
        );
        attachments.clear();
        addStartedTask(queryClient, queryScope, serverId, started);
        router.setParams<"/task/[taskId]">({ taskId: started.id });
      } catch (error) {
        start.failed();
        void haptics.notification("error");
        setDraft((current) => (current.trim() ? current : value));
        setSendError(errorMessage(error, t("mobile.server.threads.error.start")));
        setSending(false);
      }
      return;
    }
    const startsTurn = activeTurnId === null;
    if (startsTurn && ready) motion.beginSend();
    else motion.scrollToLatest();
    setSending(true);
    const message = taskMessageId([serverId, agentId, taskId, text, files.map((file) => file.id)]);
    try {
      await withFiles((attachmentDraftIds) =>
        sendAgentTaskMessage({ agentId, taskId, text, attachmentDraftIds, clientMessageId: message.id }, serverId),
      );
      attachments.clear();
      if (startsTurn) setAwaitingTurn(true);
    } catch (error) {
      message.failed();
      motion.cancelSend();
      void haptics.notification("error");
      setDraft((current) => (current.trim() ? current : value));
      setSendError(errorMessage(error, t("mobile.server.threads.error.send")));
    } finally {
      setSending(false);
    }
  }

  const respondToListApproval = useCallback(
    (approval: PendingApproval, decision: ApprovalDecision) =>
      respondToApproval(serverId, { requestId: approval.requestId, decision }),
    [respondToApproval, serverId],
  );
  const loadWholeListApproval = useCallback(
    (approval: PendingApproval) => readWholeApproval(serverId, approval),
    [readWholeApproval, serverId],
  );
  const branchMessage = useMemo(
    () => (branch ? (message: ChatBubbleMessage) => void branch(message.id) : undefined),
    [branch],
  );
  const setPinned = pins.setPinned;
  const togglePinMessage = useMemo(
    () =>
      pinsEnabled && !isDraft
        ? (message: ChatBubbleMessage, pinned: boolean) => setPinned(taskId, message.id, pinned)
        : undefined,
    [pinsEnabled, isDraft, setPinned, taskId],
  );
  const refetchConversation = conversation.refetch;
  const retryHistory = useCallback(() => void refetchConversation(), [refetchConversation]);
  const listLimit = list.data?.limit ?? 1;
  const taskNotes = useMemo(() => {
    const hold = task ? agentTaskHoldText(task, listLimit, t) : null;
    return isDraft ? (
      <Typography.Paragraph type="body-xs" align="center" className="px-6 pb-3 text-text-secondary">
        {t("mobile.chat.threads.draftNote", { name: target.name })}
      </Typography.Paragraph>
    ) : task ? (
      <View className="gap-3 pb-3">
        {hold ? (
          <Typography.Paragraph type="body-xs" className="px-1 text-text-secondary">
            {hold}
          </Typography.Paragraph>
        ) : null}
        {task.queuedMessages.length > 0 ? (
          <View className="gap-2">
            <Typography.Paragraph type="body-xs" weight="semibold" className="px-1 text-text-secondary">
              {t("mobile.server.threads.queued")}
            </Typography.Paragraph>
            {task.queuedMessages.map((queued) => (
              <View
                key={queued.deliveryId}
                className="max-w-[92%] self-end rounded-[30px] bg-control/40 px-4 py-3"
                style={{ borderCurve: "circular" }}
              >
                <Typography.Paragraph numberOfLines={3} className="text-text-secondary">
                  {queued.text}
                </Typography.Paragraph>
              </View>
            ))}
          </View>
        ) : null}
        {task.state === "idle" && task.outcome === "failed" ? (
          <View accessibilityRole="alert" className="gap-1 px-1">
            <Typography.Paragraph weight="medium" className="text-danger-text">
              {t("mobile.server.threads.failedTitle")}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" className="text-danger-text">
              {task.error?.trim()
                ? errorMessage(task.error, t("mobile.chat.failure.fallback"))
                : t("mobile.server.threads.failedBody")}
            </Typography.Paragraph>
          </View>
        ) : null}
      </View>
    ) : null;
  }, [isDraft, task, listLimit, t, errorMessage, target.name]);

  const { menu: threadMenuActions, run: runThreadAction } = threadActions;
  const actionsMenu = useMemo(() => {
    if (!task) return null;
    const pinsAction: MenuAction = { id: PINS_ACTION, title: t("mobile.chat.pins.title"), image: "pin" };
    return {
      label: t("mobile.server.threads.actions"),
      actions: pinsEnabled && !isDraft ? [...threadMenuActions(task), pinsAction] : threadMenuActions(task),
      onPressAction: (id: string) => {
        if (id !== PINS_ACTION) {
          runThreadAction(task, id);
          return;
        }
        void haptics.impact("soft");
        router.push({ pathname: "/pinned-messages", params: { agentId, serverId, taskId } });
      },
    };
  }, [task, t, pinsEnabled, isDraft, threadMenuActions, runThreadAction, agentId, serverId, taskId]);

  if (!task && !isDraft) {
    if (list.isError)
      return <TaskNote note={t("mobile.server.threads.loadFailed")} retry={() => void list.refetch()} />;
    if (!enabled || list.data)
      return <TaskNote note={t(enabled ? "mobile.server.threads.notFound" : "mobile.server.threads.offline")} />;
  }

  return (
    <View className="flex-1" style={{ backgroundColor: background }}>
      <KeyboardGestureArea
        style={{ flex: 1 }}
        textInputNativeID="chat-composer-input"
        interpolator="ios"
        enableSwipeToDismiss
      >
        <ChatHeader
          target={target}
          kicker={target.name}
          title={isDraft ? t("mobile.chat.threads.new") : (task?.title ?? "")}
          threadMenu={threadMenu}
          actionsMenu={actionsMenu}
          fallbackBackground={fieldBackground}
          foreground={foreground}
          liquidGlassAvailable={liquidGlassAvailable}
          topInset={insets.top}
          onBack={leaveTask}
        />
        <ChatMessageList
          bubbleSurface={String(background)}
          pullGesture={endPull.gesture}
          pullShift={endPull.shift}
          agents={serverAgents}
          rowsShown={rowsShown}
          target={target}
          motion={motion}
          sending={sending}
          awaitingTurn={awaitingTurn}
          keyboardOffset={keyboardOffset}
          canSend={canSend}
          online={online}
          activity={activity}
          historyState={
            ready
              ? "ready"
              : server?.initialConnectionPending
                ? "connecting"
                : !enabled
                  ? "waiting"
                  : conversation.isError
                    ? "error"
                    : "loading"
          }
          appActive={appActive}
          activeTurnId={activeTurnId}
          questionForm={questionForm.messageId ? questionForm : undefined}
          activityAccessory={taskNotes}
          approvals={approvals}
          browserRequests={taskBrowserRequests}
          serverName={server?.name ?? ""}
          onRespondApproval={respondToListApproval}
          readsWholeApprovals={wholeApprovals}
          serverConnected={server?.state === "online"}
          onLoadWholeApproval={loadWholeListApproval}
          foreground={foreground}
          messages={messages}
          turnSummaries={turnSummaries}
          onOpenTurn={isDraft ? undefined : openTurn}
          messageAliases={NO_ALIASES}
          referenceMessages={NO_MESSAGES}
          hasOlder={false}
          olderLoading={false}
          olderError={false}
          onLoadOlder={NO_OLDER}
          onBranch={branchMessage}
          onDeleteMessage={deleteMessage}
          deletesAnyMessage={messageDelete.deletesAny}
          onTogglePin={togglePinMessage}
          pinnedMessageIds={pinnedMessageIds}
          branchPoints={branching.branchPoints}
          branchDivider={branchDivider}
          onOpenBranchSource={openBranchSource}
          unreadLineMessageIds={unreadLineMessageIds}
          focusMessageId={focus ?? (opensAtUnread && unreadLineMessageIds ? unreadLineMessageId : null)}
          focusUnread={focus === null && opensAtUnread}
          onFocusPlaced={clearFocus}
          muted={muted}
          showStarter={false}
          topInset={insets.top}
          onRetryHistory={retryHistory}
        />
        <Animated.View
          style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, motion.composerStyle]}
          pointerEvents="box-none"
          onLayout={motion.onComposerLayout}
        >
          {pullOn ? <ChatEndPullRing pull={endPull} target={target} /> : null}
          <View style={{ paddingLeft: insets.left, paddingRight: insets.right }}>
            <ConnectionStatus server={server} />
          </View>
          {showBrowserRequests
            ? taskBrowserRequests
                .filter((request) => !asksForSecret(request))
                .map((request) => (
                  <BrowserTakeoverCard
                    key={`${serverId}:${request.requestId}`}
                    request={request}
                    respondToTakeover={(decision) =>
                      respondToBrowserTakeover(serverId, { requestId: request.requestId, decision })
                    }
                    openBrowser={
                      browserAllowed && browserViewAvailable
                        ? () =>
                            router.push({
                              pathname: "/browser/[agentId]",
                              params: { agentId: request.agentId, serverId, tabId: request.tabId },
                            })
                        : undefined
                    }
                  />
                ))
            : null}
          {sendError ? (
            <Typography.Paragraph
              accessibilityRole="alert"
              className="bg-background py-2 text-danger-text"
              style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
            >
              {sendError}
            </Typography.Paragraph>
          ) : null}
          {closed ? (
            <Typography.Paragraph
              type="body-xs"
              align="center"
              className="pt-2 text-text-secondary"
              style={{
                paddingLeft: insets.left + 24,
                paddingRight: insets.right + 24,
                paddingBottom: Math.max(insets.bottom, 10) + 6,
              }}
            >
              {t("mobile.server.threads.closedNote")}
            </Typography.Paragraph>
          ) : secretRequest ? (
            <BrowserSecretComposer
              key={`${serverId}:${secretRequest.requestId}`}
              request={secretRequest}
              respond={(input) => respondToBrowserSecret(serverId, input)}
              bottomInset={insets.bottom}
              liquidGlassAvailable={liquidGlassAvailable}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              muted={muted}
              action={action}
              actionForeground={actionForeground}
            />
          ) : secretQuestion ? (
            <QuestionSecretComposer
              key={`${serverId}:${secretQuestion.messageId}:${secretQuestion.question?.id}`}
              controller={secretQuestion}
              bottomInset={insets.bottom}
              liquidGlassAvailable={liquidGlassAvailable}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              muted={muted}
              action={action}
              actionForeground={actionForeground}
            />
          ) : (
            <ChatComposer
              sendRetryVersion={0}
              replyTarget={null}
              replyFocusVersion={0}
              onCancelReply={() => {}}
              mentionAgents={serverAgents.filter((item) => item.id !== agentId)}
              mentionReferences={mentionReferences}
              mentionSkills={mentionSkills}
              skillPickerVersion={skillPickerVersion}
              action={action}
              actionForeground={actionForeground}
              agentName={target.name}
              placeholder={
                answersQuestion
                  ? t("mobile.chat.question.answerPlaceholder")
                  : isDraft
                    ? t("mobile.chat.threads.draftPlaceholder", { name: target.name })
                    : t(
                        task?.state === "running" || task?.state === "queued"
                          ? "mobile.server.threads.messagePlaceholder"
                          : "mobile.server.threads.continuePlaceholder",
                      )
              }
              bottomInset={insets.bottom}
              disabled={!canSend || (sending && (isDraft || attachments.items.length > 0))}
              attachments={filesAllowed ? attachments : undefined}
              menuOpen={attachments.menuOpen}
              menuProgress={menuProgress}
              draft={draft}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              liquidGlassAvailable={liquidGlassAvailable}
              muted={muted}
              raised={raised}
              onChangeDraft={setDraft}
              onSend={(text) => void send(text)}
              onStop={task?.state === "running" && !answersQuestion ? () => threadActions.run(task, "stop") : undefined}
              stopping={task ? threadActions.acting(task) : false}
              keyboardProgress={motion.keyboardProgress}
              dictation={composerDictation}
              voiceAccent={accent}
              contextMeter={contextMeter}
            />
          )}
        </Animated.View>
      </KeyboardGestureArea>
      {filesAllowed && attachments.menuAnchor && isFocused ? (
        <ChatAttachmentPanel
          anchor={attachments.menuAnchor}
          appActive={appActive}
          attachments={attachments}
          context={contextMeter}
          fallbackBackground={fieldBackground}
          foreground={foreground}
          keyboardHeight={motion.keyboardHeight}
          keyboardOffset={keyboardOffset}
          liquidGlassAvailable={liquidGlassAvailable}
          onClose={attachments.closeMenu}
          onUseSkill={mentionSkills.length ? () => setSkillPickerVersion((version) => version + 1) : undefined}
          progress={menuProgress}
        />
      ) : null}
    </View>
  );
}
