import { userErrorMessage } from "@openbot/user-errors";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { router, useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Keyboard, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { ChatQueue } from "@/features/chat/components/chat-queue";
import { useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import {
  latestReadableMessage,
  type PendingChatMessage,
  partitionChatMessages,
  presentChatMessages,
  projectChatMessages,
} from "@/features/chat/model/chat-messages";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { isIOS } from "@/shared/lib/platform";
import { useQueueEdit } from "./use-queue-edit";

interface MobileChatViewProps {
  animateAvatarOnExit?: boolean;
  agent: MobileAgent;
}

const CHAT_BACK_EDGE_WIDTH = 24;

function leaveConversation(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/connected");
}

export function MobileChatView({ animateAvatarOnExit = false, agent }: MobileChatViewProps) {
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [reducedTransparency, setReducedTransparency] = useState(true);
  const insets = useSafeAreaInsets();
  const keyboardOffset = Math.max(insets.bottom, 10) - 10;
  const { leaveAgentChatAnimated } = useAgentPinTransition();
  const [foreground, muted, fieldBackground, raised, action, actionForeground, background] = useThemeColor([
    "foreground",
    "muted",
    "default",
    "surface-tertiary",
    "accent",
    "accent-foreground",
    "background",
  ]);
  const [sendError, setSendError] = useState<{ agentId: string; message: string } | null>(null);
  const [normalSending, setSending] = useState(false);
  const [sendRetryVersion, setSendRetryVersion] = useState(0);
  const queueAnimating = useRef(false);
  const measuredComposerHeight = useRef<number | null>(null);
  const [composerGestureHeight, setComposerGestureHeight] = useState(0);
  const sendingRef = useRef(false);

  const [immediateMessageId, setImmediateMessageId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingChatMessage | null>(null);
  const [messageAliases, setMessageAliases] = useState<ReadonlyMap<string, string>>(new Map());
  const sendSequence = useRef(0);
  const [showStarter, setShowStarter] = useState(true);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const historyRequestRef = useRef(0);
  const {
    agents,
    queueEdits,
    conversations,
    loadConversation,
    markAgentRead,
    servers,
    respondToPrompt,
    sendMessage: sendTeamMessage,
    cancelQueuedMessage,
    steerQueuedMessage,
    takeQueuedMessage,
    uploadAttachment,
    discardAttachment,
  } = useMobileWorkspace();
  const editor = useQueueEdit(queueEdits, agent, async (message) => {
    const delivery = message.delivery;
    if (!delivery) throw new Error("This message is not queued.");
    if (message.attachments?.length) {
      const prepared = await takeQueuedMessage({ agentId: agent.id, deliveryId: delivery.id }, agent.serverId);
      return { body: prepared.text, attachments: prepared.attachments };
    }
    await cancelQueuedMessage({ agentId: agent.id, deliveryId: delivery.id }, agent.serverId);
    return { body: message.body, attachments: [] };
  });
  const { draft, setDraft, preparing, queueEdit, focusRequest, startQueueEdit, finishQueueEdit } = editor;
  const sending = normalSending || editor.sending;
  const attachments = useChatAttachments(editor);
  const conversation = conversations[agent.id];
  const activity = useAgentActivity(agent.id);
  const projectedMessages = useMemo(() => projectChatMessages(conversation?.messages ?? []), [conversation]);
  const otherTurnActive =
    conversation?.activeTurnId &&
    conversation.messages.some(
      (message) =>
        message.author === "user" &&
        message.turnId === conversation.activeTurnId &&
        (messageAliases.get(message.id) ?? message.id) !== immediateMessageId,
    );
  const { history: messages, queued } = useMemo(
    () =>
      partitionChatMessages(
        presentChatMessages(projectedMessages, pendingMessage, messageAliases),
        otherTurnActive ? null : immediateMessageId,
      ),
    [projectedMessages, pendingMessage, messageAliases, otherTurnActive, immediateMessageId],
  );
  useEffect(() => {
    if (pendingMessage?.serverId && projectedMessages.some((message) => message.id === pendingMessage.serverId))
      setPendingMessage(null);
  }, [pendingMessage, projectedMessages]);
  const lastUserId =
    messages.findLast((message) => message.kind === "message" && message.author === "user")?.id ?? null;
  const motion = useChatMotion(insets.top + 84, keyboardOffset, Boolean(conversation), lastUserId);
  const atLatest = motion.atLatest;
  const liquidGlassAvailable = isLiquidGlassAvailable() && !reducedTransparency;
  const latestMessage = latestReadableMessage(conversation?.messages ?? []);
  const readBoundary = latestMessage?.id;
  const readBoundaryStatus = latestMessage?.status;
  const server = servers.find((server) => server.id === agent.serverId);
  const serverOnline = server?.state === "online";
  const activePrompt = messages.findLast(
    (message) =>
      message.kind === "question" &&
      !message.prompt.resolution &&
      Boolean(conversation?.activeTurnId) &&
      message.turnId === conversation?.activeTurnId,
  );
  const questionForm = useQuestionPrompt(
    agent.id,
    activePrompt?.kind === "question" ? activePrompt : undefined,
    serverOnline,
    respondToPrompt,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (mounted) setReducedTransparency(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReducedTransparency);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!pendingMessage && isFocused && appActive && atLatest && serverOnline && readBoundary && readBoundaryStatus) {
      markAgentRead(agent.id, readBoundary);
    }
  }, [
    pendingMessage,
    isFocused,
    appActive,
    atLatest,
    serverOnline,
    readBoundary,
    readBoundaryStatus,
    agent.id,
    markAgentRead,
  ]);

  const fetchHistory = useCallback(() => {
    if (!serverOnline) return;
    const requestId = ++historyRequestRef.current;
    setHistoryLoadFailed(false);
    void loadConversation(agent.id).catch(() => {
      if (historyRequestRef.current === requestId) setHistoryLoadFailed(true);
    });
  }, [agent.id, loadConversation, serverOnline]);

  useEffect(() => {
    fetchHistory();
    return () => {
      historyRequestRef.current += 1;
    };
  }, [fetchHistory]);

  const handleLeaveConversation = useCallback(() => {
    if (animateAvatarOnExit) leaveAgentChatAnimated(agent.id);
    else leaveConversation();
  }, [animateAvatarOnExit, agent.id, leaveAgentChatAnimated]);

  const edgeBackGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isIOS)
        .hitSlop({ left: 0, width: CHAT_BACK_EDGE_WIDTH })
        .activeOffsetX(12)
        .failOffsetX(-8)
        .failOffsetY([-16, 16])
        .onEnd((event) => {
          if (event.translationX >= 48 || event.velocityX >= 650) scheduleOnRN(handleLeaveConversation);
        }),
    [handleLeaveConversation],
  );

  const onQueueAnimatingChange = useCallback(
    (animating: boolean) => {
      queueAnimating.current = animating;
      const height = measuredComposerHeight.current;
      if (!animating && height !== null) {
        motion.onComposerHeight(height);
        setComposerGestureHeight(height);
      }
    },
    [motion.onComposerHeight],
  );

  function sendMessage(value: string): void {
    if (!serverOnline || preparing || sending || sendingRef.current || pendingMessage) return;
    const body = value.trim();
    if (!body && attachments.items.length === 0 && !queueEdit?.message.attachments?.length) return;
    if (queueEdit) {
      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      const uploaded: string[] = [];
      void (async () => {
        try {
          await editor.sendQueueEdit(async () => {
            for (const file of attachments.items) uploaded.push((await uploadAttachment(agent.id, file)).id);
            await sendTeamMessage(
              agent.id,
              body,
              [...(queueEdit.message.attachments?.map((file) => file.id) ?? []), ...uploaded],
              queueEdit.message.replyToMessageId,
            );
          });
          setSendRetryVersion((version) => version + 1);
        } catch (error) {
          await Promise.allSettled(uploaded.map((id) => discardAttachment(agent.id, id)));
          setSendRetryVersion((version) => version + 1);
          setSendError({
            agentId: agent.id,
            message: userErrorMessage(error, "Could not send the edited message. Your draft is kept here."),
          });
        } finally {
          sendingRef.current = false;
          setSending(false);
        }
      })();
      return;
    }

    setSendError(null);
    const queueing = Boolean(
      activity ||
        conversation?.activeTurnId ||
        projectedMessages.some(
          (message) =>
            message.kind === "message" &&
            (message.delivery?.status === "queued" ||
              message.delivery?.status === "starting" ||
              message.delivery?.status === "running"),
        ),
    );
    if (!queueing) motion.beginSend();
    Keyboard.dismiss();

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (questionForm.question) {
      questionForm.answer([body]);
      motion.cancelSend();
      motion.scrollToLatest();
      return;
    }
    setShowStarter(false);
    setDraft("");
    sendingRef.current = true;
    setSending(true);
    const files = attachments.items;
    const localId = `local-message-${++sendSequence.current}`;
    if (!queueing) setImmediateMessageId(localId);
    setPendingMessage({
      message: {
        id: localId,
        kind: "message",
        author: "user",
        body,
        streaming: false,
        awaitingQueueReceipt: queueing,
        attachments: files.map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          kind: file.mimeType.startsWith("image/") ? "image" : "file",
          previewKind: "none",
          previewUrl: null,
        })),
      },
      baseline: new Set(projectedMessages.map((message) => message.id)),
      serverId: null,
    });
    const uploaded: string[] = [];
    void (async () => {
      try {
        for (const file of files) uploaded.push((await uploadAttachment(agent.id, file)).id);
        const serverId = await sendTeamMessage(agent.id, body, uploaded);
        setMessageAliases((current) => new Map(current).set(serverId, localId));
        setPendingMessage((current) => (current?.message.id === localId ? { ...current, serverId } : current));
        attachments.clear();
      } catch (error) {
        motion.cancelSend();
        setPendingMessage((current) => (current?.message.id === localId ? null : current));
        setDraft((current) => (current ? `${body}\n${current}` : body));
        // Only discard drafts created by this attempt. Keep the local files and text for retry.
        await Promise.allSettled(uploaded.map((id) => discardAttachment(agent.id, id)));
        setSendRetryVersion((version) => version + 1);
        setSendError({
          agentId: agent.id,
          message: userErrorMessage(
            error,
            "Could not send the message. Check the conversation before you send it again.",
          ),
        });
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    })();
  }

  return (
    <GestureDetector gesture={edgeBackGesture}>
      <View className="flex-1" style={{ backgroundColor: background }}>
        <KeyboardGestureArea
          style={{ flex: 1 }}
          textInputNativeID="chat-composer-input"
          interpolator="ios"
          enableSwipeToDismiss
          offset={Math.max(0, composerGestureHeight - keyboardOffset)}
        >
          <ChatHeader
            agent={agent}
            fallbackBackground={fieldBackground}
            foreground={foreground}
            liquidGlassAvailable={liquidGlassAvailable}
            topInset={insets.top}
            onBack={handleLeaveConversation}
          />
          <ChatMessageList
            agents={agents.filter((candidate) => candidate.serverId === agent.serverId)}
            agent={agent}
            motion={motion}
            sending={sending}
            keyboardOffset={keyboardOffset}
            canSend={serverOnline}
            historyState={
              conversation
                ? "ready"
                : server?.initialConnectionPending
                  ? "connecting"
                  : !serverOnline
                    ? "waiting"
                    : historyLoadFailed
                      ? "error"
                      : "loading"
            }
            appActive={appActive}
            activeTurnId={conversation?.activeTurnId ?? null}
            questionForm={questionForm}
            fieldBackground={fieldBackground}
            foreground={foreground}
            messages={messages}
            muted={muted}
            raised={raised}
            showStarter={showStarter && serverOnline && !activity && conversation?.messages.length === 0}
            topInset={insets.top}
            onDismissStarter={() => setShowStarter(false)}
            onSelectStarter={sendMessage}
            onRetryHistory={fetchHistory}
          />
          <KeyboardStickyView
            style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
            offset={{ opened: keyboardOffset }}
            pointerEvents="box-none"
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              measuredComposerHeight.current = height;
              if (queueAnimating.current) return;
              motion.onComposerHeight(height);
              setComposerGestureHeight(height);
            }}
          >
            {liquidGlassAvailable ? (
              <SheetScrollEdgeEffect
                edge="bottom"
                style={{ position: "absolute", top: -32, bottom: 0, left: 0, right: 0 }}
              />
            ) : null}
            {!atLatest && motion.historyVisible && messages.length > 0 ? (
              <View className="absolute -top-14 self-center">
                <ChatGlassIconButton
                  accessibilityLabel="Scroll to latest message"
                  fallbackBackground={fieldBackground}
                  liquidGlassAvailable={liquidGlassAvailable}
                  onPress={motion.scrollToLatest}
                >
                  <ArrowDown color={String(foreground)} size={22} />
                </ChatGlassIconButton>
              </View>
            ) : null}
            <ConnectionStatus server={server} />
            {sendError?.agentId === agent.id ? (
              <Typography.Paragraph accessibilityRole="alert" className="bg-background px-4 py-2 text-danger">
                {sendError.message}
              </Typography.Paragraph>
            ) : null}
            <ChatQueue
              onAnimatingChange={onQueueAnimatingChange}
              messages={queued.filter(
                (message) => !queueEdit || message.delivery?.id !== queueEdit.message.delivery?.id,
              )}
              canManage={serverOnline && !preparing && !sending && !pendingMessage && !queueEdit}
              onEdit={async (message) => {
                await startQueueEdit(message);
                setSendError(null);
                setSendRetryVersion((version) => version + 1);
              }}
              canSteer={Boolean(conversation?.activeTurnId)}
              onSteer={async (deliveryId) => {
                const expectedTurnId = conversation?.activeTurnId;
                if (!expectedTurnId) throw new Error("There is no active turn to steer.");
                await steerQueuedMessage({ agentId: agent.id, deliveryId, expectedTurnId }, agent.serverId);
              }}
              onDelete={(deliveryId) => cancelQueuedMessage({ agentId: agent.id, deliveryId }, agent.serverId)}
              liquidGlassAvailable={liquidGlassAvailable}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              muted={muted}
            />
            {queueEdit ? (
              <View className="mx-4 flex-row items-center gap-2 px-2 py-1">
                <View className="min-w-0 flex-1">
                  <Typography.Paragraph type="body-xs" style={{ color: muted }}>
                    Editing message
                  </Typography.Paragraph>
                  {queueEdit.message.attachments?.length ? (
                    <Typography.Paragraph type="body-xs" numberOfLines={1} style={{ color: muted }}>
                      {queueEdit.message.attachments.map((file) => file.name).join(" · ")}
                    </Typography.Paragraph>
                  ) : null}
                </View>
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={sending}
                  onPress={() => {
                    void Promise.allSettled(
                      (queueEdit.message.attachments ?? []).map((file) => discardAttachment(agent.id, file.id)),
                    );
                    finishQueueEdit();
                    setSendError(null);
                    setSendRetryVersion((version) => version + 1);
                  }}
                >
                  Cancel
                </Button>
              </View>
            ) : null}
            <ChatComposer
              focusRequest={focusRequest}
              editingQueue={Boolean(queueEdit)}
              retainedAttachments={Boolean(queueEdit?.message.attachments?.length)}
              sendRetryVersion={sendRetryVersion}
              mentionAgents={agents.filter(
                (candidate) => candidate.serverId === agent.serverId && candidate.id !== agent.id,
              )}
              key={JSON.stringify([
                agent.id,
                questionForm.question ? questionForm.messageId : null,
                questionForm.question?.id,
              ])}
              action={action}
              actionForeground={actionForeground}
              agentName={agent.name}
              bottomInset={insets.bottom}
              disabled={!serverOnline || preparing || (queueEdit ? sending : questionForm.pending)}
              sending={sending || Boolean(pendingMessage)}
              attachments={attachments}
              answerQuestion={queueEdit ? undefined : questionForm.question}
              draft={!queueEdit && questionForm.question ? questionForm.draft : draft}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              liquidGlassAvailable={liquidGlassAvailable}
              muted={muted}
              raised={raised}
              onChangeDraft={!queueEdit && questionForm.question ? questionForm.setDraft : setDraft}
              onSend={sendMessage}
            />
          </KeyboardStickyView>
        </KeyboardGestureArea>
      </View>
    </GestureDetector>
  );
}
