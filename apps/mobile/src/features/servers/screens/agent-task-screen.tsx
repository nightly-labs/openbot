import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentTask, AgentTasksSnapshot, RespondToPromptInput } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Keyboard, Pressable, useColorScheme, View } from "react-native";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import {
  asksForSecret,
  BrowserSecretComposer,
  BrowserTakeoverCard,
} from "@/features/chat/components/browser-secret-card";
import { ChatAttachmentPanel } from "@/features/chat/components/chat-attachment-panel";
import { ChatComposer, VOICE_BUTTON_SIZE } from "@/features/chat/components/chat-composer";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { DRAFT_THREAD_ID, useChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useRowsAfterOpenTransition } from "@/features/chat/components/chat-view";
import { dictationVoice } from "@/features/chat/components/composer-voice";
import { useMarkThreadRead } from "@/features/chat/components/use-agent-thread-reads";
import { useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { useVoiceMode } from "@/features/chat/components/use-voice-mode";
import { VoiceOverlay } from "@/features/chat/components/voice-overlay";
import { mentionDraft } from "@/features/chat/model/chat-mentions";
import { latestReadableMessage, projectChatMessages } from "@/features/chat/model/chat-messages";
import type { AgentChatTarget } from "@/features/chat/model/chat-target";
import { uploadChatAttachments } from "@/features/chat/model/upload-chat-attachments";
import { voiceAccent, voicePalette } from "@/features/chat/model/voice-palette";
import { agentTaskHoldText } from "@/features/servers/model/agent-task-text";
import { useThreadActions } from "@/features/servers/model/use-thread-actions";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import { useApprovalRequests, useBrowserRequests } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useReducedTransparency } from "@/shared/lib/use-reduced-transparency";

const NO_MESSAGES: never[] = [];
const NO_ALIASES: ReadonlyMap<string, string> = new Map();
/** As in the agent's chat: a host starts a turn within a second or two; this only ends a wait for a turn that never shows. */
const AWAIT_TURN_MS = 10_000;

function onThreadDeleted(task: AgentTask) {
  router.dismissTo({ pathname: "/chat/[agentId]", params: { agentId: task.agentId } });
}

/** Leaves the task. A task opened from a notification or a link has no screen under it. */
function leaveTask() {
  void Keyboard.dismiss();
  if (router.canGoBack()) router.back();
  else router.replace("/connected");
}

/**
 * One thread of an agent, laid out as the agent's chat: the same header, message list and composer.
 * The agent's name in the header opens the thread menu, the header has the thread's actions in place
 * of the browser. The composer has files only on a host with `agent-thread-files-v1`: `agent-tasks-v1`
 * carries text only. The files upload when the person sends, and a failed send keeps them. The task id
 * `DRAFT_THREAD_ID` is a new thread: its first message starts the thread, as on desktop.
 */
export function AgentTaskScreen() {
  const { t } = useText();
  const { serverId, agentId, taskId } = useLocalSearchParams<{ serverId: string; agentId: string; taskId: string }>();
  const { agents } = useMobileWorkspace();
  const agent = agents.find((item) => item.id === agentId && item.serverId === serverId);
  if (agent)
    return <AgentTaskChat key={`${serverId}:${taskId}`} target={{ ...agent, kind: "agent" }} taskId={taskId} />;
  return <TaskNote note={t("mobile.server.threads.notFound")} />;
}

/** A full screen note with a way back, for a task or an agent that this phone cannot show. */
function TaskNote({ note, retry }: { note: string; retry?: () => void }) {
  const { t } = useText();
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
        {retry ? null : <ArrowLeft color={String(foreground)} size={20} strokeWidth={2} />}
        <Typography.Paragraph weight="semibold">{retry ? t("common.retry") : t("common.back")}</Typography.Paragraph>
      </Pressable>
    </View>
  );
}

function AgentTaskChat({ target, taskId }: { target: AgentChatTarget; taskId: string }) {
  const { t, errorMessage } = useText();
  const { serverId, id: agentId } = target;
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const isDraft = taskId === DRAFT_THREAD_ID;
  const threadMenu = useChatThreadMenu(target, taskId);
  // A deleted thread has no screen: the agent's chat takes its place.
  const threadActions = useThreadActions(target.serverId, onThreadDeleted);
  const {
    servers,
    agents,
    canUseTasks,
    canAttachThreadFiles,
    attachmentSupport,
    uploadAttachment,
    discardAttachment,
    startAgentTask,
    loadAgentTasks,
    loadAgentTaskConversation,
    sendAgentTaskMessage,
    respondToTaskPrompt,
    respondToApproval,
    respondToBrowserTakeover,
    respondToBrowserSecret,
    browserViewSupport,
  } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const online = showsOnline(server);
  const enabled = server?.state === "online" && canUseTasks(serverId);
  const serverAgents = useMemo(() => agents.filter((item) => item.serverId === serverId), [agents, serverId]);
  const list = useQuery({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    enabled,
    retry: false,
    queryFn: () => loadAgentTasks(agentId, serverId),
  });
  const conversation = useQuery({
    queryKey: queryKeys.agentTaskConversation(queryScope, serverId, taskId),
    enabled: enabled && !isDraft,
    retry: false,
    queryFn: () => loadAgentTaskConversation({ agentId, taskId }, serverId),
  });
  const task = list.data?.tasks.find((item) => item.id === taskId);
  const messages = useMemo(
    () => (conversation.data ? projectChatMessages(conversation.data.messages) : NO_MESSAGES),
    [conversation.data],
  );
  const activeTurnId = task?.activeTurnId ?? null;
  // As in the agent's chat: the open question of the running turn has the form; earlier ones show their result.
  const activePrompt = messages.findLast(
    (row) => row.kind === "question" && !row.prompt.resolution && activeTurnId !== null && row.turnId === activeTurnId,
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
  );
  // The composer answers only after the person chooses it in the form. A private answer has its own field.
  const answersQuestion = Boolean(questionForm.question && !questionForm.question.isSecret && questionForm.replyInChat);
  const threadId = conversation.data?.threadId ?? null;
  const browserRequests = useBrowserRequests(serverId);
  // Only the browser requests of the task's own thread; the agent's chat shows those of its thread.
  const taskBrowserRequests = useMemo(
    () =>
      threadId === null
        ? []
        : browserRequests.filter((request) => request.agentId === agentId && request.threadId === threadId),
    [browserRequests, agentId, threadId],
  );
  const waitReason = questionForm.question ? "question" : taskBrowserRequests.length > 0 ? "takeover" : null;
  // A task turn is not in the agent's live activity, so the row comes from the task.
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
  // Only the approvals of the task's own thread, as the agent's chat shows only its own.
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
  const browserViewAvailable = browserViewSupport(serverId).view;
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
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);
  // The person sees the thread while its screen is in front, so its dot in the thread menu goes, on
  // this phone and on the member's other devices.
  useMarkThreadRead(
    serverId,
    agentId,
    task ? taskId : null,
    isFocused && appActive && conversation.data
      ? (latestReadableMessage(conversation.data.messages)?.id ?? null)
      : null,
    task?.updatedAt ?? null,
  );
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const filesAllowed = canAttachThreadFiles(serverId);
  const attachments = useChatAttachments([], undefined, () => attachmentSupport(serverId));
  // The card's open progress, shared with the composer, as in the agent's chat.
  const menuProgress = useSharedValue(0);
  // As in the agent's chat: after the host takes the message, the activity row waits for the turn,
  // the reply or a failure. Task events can arrive after the read that holds the reply.
  const [awaitingTurn, setAwaitingTurn] = useState(false);
  const ready = isDraft || Boolean(conversation.data);
  const rowsShown = useRowsAfterOpenTransition();
  const lastUserId = messages.findLast((row) => row.kind === "message" && row.author === "user")?.id ?? null;
  const motion = useChatMotion(
    insets.top + 84,
    keyboardOffset,
    ready && rowsShown,
    rowsShown && messages.some((row) => row.kind !== "thinking"),
    lastUserId,
    questionForm.question ? (questionForm.messageId ?? null) : null,
  );
  const closed = task?.state === "closed";
  const canSend = online && !closed && (!isDraft || enabled);
  const voice = useVoiceMode({
    enabled: isFocused && canSend,
    focused: isFocused,
    sendable: canSend,
    onSend: (text) => void send(text),
  });
  const voiceOpen = voice.stage !== "closed";
  // As in the agent's chat: a password or a code is typed where the composer is.
  const showBrowserRequests = online && foregroundVisit && isFocused;
  const secretRequest = showBrowserRequests && !voiceOpen ? taskBrowserRequests.find(asksForSecret) : undefined;
  const dark = useColorScheme() === "dark";
  const palette = useMemo(
    () => voicePalette([getBloubAvatarColor(target.avatarSeed, target.avatarHue)], dark),
    [target.avatarSeed, target.avatarHue, dark],
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

  /**
   * As in a chat, the text leaves the composer at once; a failed send puts it back in an empty composer.
   * The files stay in the composer until the host takes the message, because they upload first.
   */
  async function send(value: string) {
    const text = value.trim();
    const files = filesAllowed ? attachments.items : [];
    // The files of a send in progress are still in the composer, so they do not go twice. A second
    // start of a new thread would make a second thread.
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
    // While the agent asks a question and the person chose to reply here, the text is the answer.
    // Files still go as a message, as in the agent's chat.
    if (answersQuestion && files.length === 0) {
      if (!questionForm.disabled) questionForm.answer([mentionDraft(text).text]);
      return;
    }
    /** Uploads the files as drafts, then sends; a failure discards the drafts that uploaded. */
    const withFiles = <R,>(deliver: (attachmentDraftIds: string[]) => Promise<R>) =>
      uploadChatAttachments(files, {
        upload: (file, onProgress) => uploadAttachment(agentId, file, serverId, onProgress),
        discard: (id) => discardAttachment(agentId, id, serverId),
        send: deliver,
      });
    // A new thread starts with this message, and the screen then shows the thread.
    if (isDraft) {
      setSending(true);
      try {
        const started = await withFiles((attachmentDraftIds) =>
          startAgentTask({ agentId, text, attachmentDraftIds, clientMessageId: Crypto.randomUUID() }, serverId),
        );
        attachments.clear();
        // The thread shows in the menu before its list event arrives.
        queryClient.setQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(queryScope, serverId, agentId), (stored) =>
          stored && !stored.tasks.some((entry) => entry.id === started.id)
            ? { ...stored, tasks: [started, ...stored.tasks] }
            : stored,
        );
        router.setParams<"/task/[taskId]">({ taskId: started.id });
      } catch (error) {
        void haptics.notification("error");
        setDraft((current) => (current.trim() ? current : value));
        setSendError(errorMessage(error, t("mobile.server.threads.error.start")));
        setSending(false);
      }
      return;
    }
    // As in the agent's chat: a message to an idle task moves to the top of the chat when its row
    // shows. A running task takes the message into its turn or its queue, so the list only goes to the end.
    const startsTurn = activeTurnId === null;
    if (startsTurn && ready) motion.beginSend();
    else motion.scrollToLatest();
    setSending(true);
    try {
      await withFiles((attachmentDraftIds) =>
        sendAgentTaskMessage(
          { agentId, taskId, text, attachmentDraftIds, clientMessageId: Crypto.randomUUID() },
          serverId,
        ),
      );
      attachments.clear();
      if (startsTurn) setAwaitingTurn(true);
    } catch (error) {
      motion.cancelSend();
      void haptics.notification("error");
      setDraft((current) => (current.trim() ? current : value));
      setSendError(errorMessage(error, t("mobile.server.threads.error.send")));
    } finally {
      setSending(false);
    }
  }

  if (!task && !isDraft) {
    if (list.isError)
      return <TaskNote note={t("mobile.server.threads.loadFailed")} retry={() => void list.refetch()} />;
    if (!enabled || list.data)
      return <TaskNote note={t(enabled ? "mobile.server.threads.notFound" : "mobile.server.threads.offline")} />;
  }

  const hold = task ? agentTaskHoldText(task, list.data?.limit ?? 1, t) : null;
  const actionsMenu = task
    ? {
        label: t("mobile.server.threads.actions"),
        actions: threadActions.menu(task),
        onPressAction: (id: string) => threadActions.run(task, id),
      }
    : null;

  // Under the activity, as the desktop task panel: why the task waits, its queued messages and its failure.
  const taskNotes = isDraft ? (
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
              className="max-w-[88%] self-end rounded-[30px] bg-control/40 px-4 py-3"
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
            {task.error || t("mobile.server.threads.failedBody")}
          </Typography.Paragraph>
        </View>
      ) : null}
    </View>
  ) : null;

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
          accessibilityHidden={voiceOpen}
        />
        <ChatMessageList
          agents={serverAgents}
          rowsShown={rowsShown}
          target={target}
          accessibilityHidden={voiceOpen}
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
          questionForm={questionForm}
          activityAccessory={taskNotes}
          approvals={approvals}
          browserRequests={taskBrowserRequests}
          serverName={server?.name ?? ""}
          onRespondApproval={(approval, decision) =>
            respondToApproval(serverId, { requestId: approval.requestId, decision })
          }
          fieldBackground={fieldBackground}
          foreground={foreground}
          messages={messages}
          messageAliases={NO_ALIASES}
          referenceMessages={NO_MESSAGES}
          hasOlder={false}
          olderLoading={false}
          olderError={false}
          onLoadOlder={() => {}}
          muted={muted}
          raised={raised}
          showStarter={false}
          topInset={insets.top}
          onDismissStarter={() => {}}
          onSelectStarter={() => {}}
          onRetryHistory={() => void conversation.refetch()}
        />
        {voiceOpen ? (
          <VoiceOverlay
            voice={voice}
            hint={voice.phase === "listening" ? t("mobile.chat.voice.listening") : ""}
            reply={null}
            muted={muted}
            topInset={insets.top}
            controlsHeight={Math.max(insets.bottom, 10) + VOICE_BUTTON_SIZE + 48}
            reducedTransparency={reducedTransparency}
          />
        ) : null}
        <Animated.View
          style={[
            { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: voiceOpen ? 31 : undefined },
            motion.composerStyle,
          ]}
          pointerEvents="box-none"
          onLayout={motion.onComposerLayout}
        >
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
            // A closed task takes no messages. Reopen in the header menu takes it back.
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
          ) : (
            <ChatComposer
              sendRetryVersion={0}
              replyTarget={null}
              replyFocusVersion={0}
              onCancelReply={() => {}}
              mentionAgents={serverAgents.filter((item) => item.id !== agentId)}
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
              voice={dictationVoice(voice, t)}
              voiceAccent={accent}
            />
          )}
        </Animated.View>
      </KeyboardGestureArea>
      {/* As in the agent's chat: the card stays while a system prompt holds the foreground. */}
      {filesAllowed && attachments.menuAnchor && isFocused ? (
        <ChatAttachmentPanel
          anchor={attachments.menuAnchor}
          appActive={appActive}
          attachments={attachments}
          fallbackBackground={fieldBackground}
          foreground={foreground}
          keyboardHeight={motion.keyboardHeight}
          keyboardOffset={keyboardOffset}
          liquidGlassAvailable={liquidGlassAvailable}
          onClose={attachments.closeMenu}
          progress={menuProgress}
        />
      ) : null}
    </View>
  );
}
