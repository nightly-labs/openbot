import { userErrorMessage } from "@openbot/user-errors";
import { useQueryClient } from "@tanstack/react-query";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Keyboard, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { MobileConversationAnalytics } from "@/features/analytics/conversation";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { type ChatAttachment, useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { type ChatBubbleMessage, useMessageActions } from "@/features/chat/context/message-actions-context";
import { type ChatMessage, type PendingChatMessage, presentChatMessages } from "@/features/chat/model/chat-messages";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import type { ChatHistoryReceipt } from "../model/chat-messages";
import type { ChatTarget } from "../model/chat-target";
import { retainConfirmedAttachments } from "../model/upload-chat-attachments";
import { ChatCameraPanel } from "./chat-camera-panel";

export interface ChatViewProps {
  target: ChatTarget;
  animateAvatarOnExit?: boolean;
  agents: MobileAgent[];
  mentionAgents: MobileAgent[];
  projectedMessages: ChatMessage[];
  referenceMessages: ChatMessage[];
  ready: boolean;
  historyLoadFailed: boolean;
  canSend: boolean;
  activity?: MobileAgentActivity;
  activities?: MobileAgentActivity[];
  activeTurnId: string | null;
  questionForm?: QuestionPromptController;
  readBoundary: string | null;
  markRead: () => void;
  fetchHistory: () => void;
  hasOlder: boolean;
  olderLoading: boolean;
  olderError: boolean;
  loadOlder: () => void;
  send: (
    body: string,
    files: ChatAttachment[],
    replyToMessageId: string | null,
  ) => Promise<string | null | ChatHistoryReceipt>;
  needsAction?: boolean;
  notice?: string;
}

const CHAT_BACK_EDGE_WIDTH = 24;

function leaveConversation(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/connected");
}

export function ChatView({
  target,
  animateAvatarOnExit = false,
  agents: serverAgents,
  mentionAgents,
  projectedMessages,
  referenceMessages,
  ready,
  historyLoadFailed,
  canSend,
  activity,
  activities,
  activeTurnId,
  questionForm,
  readBoundary,
  markRead,
  fetchHistory,
  hasOlder,
  olderLoading,
  olderError,
  loadOlder,
  send,
  needsAction = false,
  notice,
}: ChatViewProps) {
  const isFocused = useIsFocused();
  const foregroundVisit = useAppForeground();
  const [conversationAnalytics] = useState(() => new MobileConversationAnalytics(mobileAnalytics));
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
  const { select: selectMessageActions } = useMessageActions();
  const [replyTarget, setReplyTarget] = useState<ChatBubbleMessage | null>(null);
  const [replyFocusVersion, setReplyFocusVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<{ agentId: string; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [historyReceipt, setHistoryReceipt] = useState<ChatHistoryReceipt | null>(null);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [sendRetryVersion, setSendRetryVersion] = useState(0);
  const [composerGestureHeight, setComposerGestureHeight] = useState(0);
  const sendingRef = useRef(false);
  const attachments = useChatAttachments();
  const queryClient = useQueryClient();
  const submittedFiles = useRef<ChatAttachment[]>([]);
  const [pendingMessage, setPendingMessage] = useState<PendingChatMessage | null>(null);
  const [messageAliases, setMessageAliases] = useState<ReadonlyMap<string, string>>(new Map());
  const sendSequence = useRef(0);
  const [showStarter, setShowStarter] = useState(true);
  const { servers } = useMobileWorkspace();
  const messages = useMemo(
    () => presentChatMessages(projectedMessages, pendingMessage, messageAliases),
    [projectedMessages, pendingMessage, messageAliases],
  );
  useEffect(() => {
    if (!pendingMessage?.serverId) return;
    if (
      retainConfirmedAttachments(projectedMessages, pendingMessage.serverId, submittedFiles.current, (id, file) => {
        queryClient.setQueryData(["chat-attachment", target.serverId, id], file);
      })
    ) {
      submittedFiles.current = [];
      setPendingMessage(null);
    }
  }, [pendingMessage, projectedMessages, queryClient, target.serverId]);
  const lastUserId =
    messages.findLast((message) => message.kind === "message" && message.author === "user")?.id ?? null;
  const motion = useChatMotion(insets.top + 84, keyboardOffset, ready, lastUserId);
  const atLatest = motion.atLatest;
  const liquidGlassAvailable = isLiquidGlassAvailable() && !reducedTransparency;
  const server = servers.find((server) => server.id === target.serverId);
  const serverOnline = server?.state === "online";
  useEffect(() => {
    conversationAnalytics.update(
      isFocused && foregroundVisit,
      ready,
      historyLoadFailed || (!serverOnline && server?.initialConnectionPending === false),
    );
  }, [
    conversationAnalytics,
    isFocused,
    foregroundVisit,
    ready,
    historyLoadFailed,
    serverOnline,
    server?.initialConnectionPending,
  ]);
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
    if (!pendingMessage && isFocused && appActive && atLatest && serverOnline && readBoundary) markRead();
  }, [pendingMessage, isFocused, appActive, atLatest, serverOnline, readBoundary, markRead]);

  const handleLeaveConversation = useCallback(() => {
    if (animateAvatarOnExit && target.kind === "agent") leaveAgentChatAnimated(target.id);
    else leaveConversation();
  }, [animateAvatarOnExit, target.id, target.kind, leaveAgentChatAnimated]);

  const edgeBackGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isIOS && !attachments.cameraOpen)
        .hitSlop({ left: 0, width: CHAT_BACK_EDGE_WIDTH })
        .activeOffsetX(12)
        .failOffsetX(-8)
        .failOffsetY([-16, 16])
        .onEnd((event) => {
          if (event.translationX >= 48 || event.velocityX >= 650) scheduleOnRN(handleLeaveConversation);
        }),
    [handleLeaveConversation, attachments.cameraOpen],
  );

  async function retryAcceptedHistory() {
    if (!historyReceipt || refreshingHistory) return;
    setRefreshingHistory(true);
    try {
      await historyReceipt.refreshHistory();
      submittedFiles.current = [];
      setPendingMessage(null);
      setHistoryReceipt(null);
      setSendError(null);
    } catch (error) {
      setSendError({ agentId: target.id, message: userErrorMessage(error, "Could not refresh chat history.") });
    } finally {
      setRefreshingHistory(false);
    }
  }

  function sendMessage(value: string): void {
    if (!serverOnline || !canSend || sendingRef.current || pendingMessage) return;
    const body = value.trim();
    if (!body && attachments.items.length === 0) return;

    setSendError(null);
    motion.beginSend();
    Keyboard.dismiss();

    void haptics.impact();
    if (questionForm?.question) {
      questionForm.answer([body]);
      motion.cancelSend();
      motion.scrollToLatest();
      return;
    }
    setShowStarter(false);
    setDraft("");
    sendingRef.current = true;
    setSending(true);
    const submittedReply = replyTarget;
    setReplyTarget(null);
    const files = attachments.items;
    submittedFiles.current = files;
    const localId = `local-message-${++sendSequence.current}`;
    setPendingMessage({
      message: {
        id: localId,
        kind: "message",
        author: "user",
        body,
        streaming: false,
        replyToMessageId: submittedReply?.id ?? null,
        attachments: files.map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          kind: file.mimeType.startsWith("image/") ? "image" : "file",
          previewKind: "none",
          previewUrl: file.mimeType.startsWith("image/")
            ? (file.uri ?? `data:${file.mimeType};base64,${file.base64}`)
            : null,
        })),
      },
      baseline: new Set(projectedMessages.map((message) => message.id)),
      serverId: null,
    });
    void (async () => {
      try {
        const serverId = await send(body, files, submittedReply?.id ?? null);
        if (serverId && typeof serverId === "object") {
          setHistoryReceipt(serverId);
        } else if (serverId) {
          setMessageAliases((current) => new Map(current).set(serverId, localId));
          setPendingMessage((current) => (current?.message.id === localId ? { ...current, serverId } : current));
        } else {
          // Channel commands acknowledge the operation, without a message ID. Use the
          // refreshed host transcript; never guess a receipt from matching message text.
          submittedFiles.current = [];
          setPendingMessage(null);
        }
        attachments.clear();
      } catch (error) {
        submittedFiles.current = [];
        motion.cancelSend();
        setPendingMessage((current) => (current?.message.id === localId ? null : current));
        setReplyTarget((current) => current ?? submittedReply);
        setDraft((current) => (current ? `${body}\n${current}` : body));
        setSendRetryVersion((version) => version + 1);
        setSendError({
          agentId: target.id,
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
        <View
          className="flex-1"
          accessibilityElementsHidden={attachments.cameraOpen}
          importantForAccessibility={attachments.cameraOpen ? "no-hide-descendants" : "auto"}
          pointerEvents={attachments.cameraOpen ? "none" : "auto"}
        >
          <KeyboardGestureArea
            style={{ flex: 1 }}
            textInputNativeID="chat-composer-input"
            interpolator="ios"
            enableSwipeToDismiss
            offset={Math.max(0, composerGestureHeight - keyboardOffset)}
          >
            <ChatHeader
              target={target}
              needsAction={needsAction}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              liquidGlassAvailable={liquidGlassAvailable}
              topInset={insets.top}
              onBack={handleLeaveConversation}
            />
            <ChatMessageList
              agents={serverAgents}
              target={target}
              motion={motion}
              sending={sending}
              keyboardOffset={keyboardOffset}
              canSend={serverOnline && canSend}
              online={serverOnline}
              activity={activity}
              activities={activities}
              historyState={
                ready
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
              activeTurnId={activeTurnId}
              questionForm={questionForm}
              fieldBackground={fieldBackground}
              foreground={foreground}
              messages={messages}
              messageAliases={messageAliases}
              referenceMessages={referenceMessages}
              hasOlder={hasOlder}
              olderLoading={olderLoading}
              olderError={olderError}
              onLoadOlder={loadOlder}
              onReply={
                !questionForm?.question
                  ? (message) => {
                      setReplyTarget(message);
                      setReplyFocusVersion((version) => version + 1);
                    }
                  : undefined
              }
              onOpenActions={(message) => {
                Keyboard.dismiss();
                selectMessageActions({
                  message,
                  onReply: !questionForm?.question
                    ? () => {
                        setReplyTarget(message);
                        setReplyFocusVersion((version) => version + 1);
                      }
                    : null,
                });
                router.push("/message-actions");
              }}
              muted={muted}
              raised={raised}
              showStarter={
                showStarter && serverOnline && canSend && ready && !activity && projectedMessages.length === 0
              }
              topInset={insets.top}
              onDismissStarter={() => setShowStarter(false)}
              onSelectStarter={sendMessage}
              onRetryHistory={fetchHistory}
            />
            <Animated.View
              style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, motion.composerStyle]}
              pointerEvents="box-none"
              onLayout={(event) => {
                motion.onComposerLayout(event);
                setComposerGestureHeight(event.nativeEvent.layout.height);
              }}
            >
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
              {sendError?.agentId === target.id ? (
                <Typography.Paragraph accessibilityRole="alert" className="bg-background px-4 py-2 text-danger-text">
                  {sendError.message}
                </Typography.Paragraph>
              ) : null}
              {historyReceipt ? (
                <View className="bg-background px-4 py-2">
                  <Typography.Paragraph className="text-muted">
                    Message sent. Refresh history to show it.
                  </Typography.Paragraph>
                  <Button
                    variant="tertiary"
                    isDisabled={!serverOnline || refreshingHistory}
                    onPress={() => void retryAcceptedHistory()}
                  >
                    <Button.Label>{refreshingHistory ? "Refreshing…" : "Refresh history"}</Button.Label>
                  </Button>
                </View>
              ) : null}
              {notice ? (
                <Typography.Paragraph className="bg-background px-4 py-2 text-muted">{notice}</Typography.Paragraph>
              ) : null}
              <ChatComposer
                sendRetryVersion={sendRetryVersion}
                replyTarget={questionForm?.question ? null : replyTarget}
                replyFocusVersion={replyFocusVersion}
                onCancelReply={() => setReplyTarget(null)}
                mentionAgents={mentionAgents}
                key={JSON.stringify([
                  target.id,
                  questionForm?.question ? questionForm.messageId : null,
                  questionForm?.question?.id,
                ])}
                action={action}
                actionForeground={actionForeground}
                agentName={target.name}
                bottomInset={insets.bottom}
                disabled={!serverOnline || !canSend || Boolean(questionForm?.pending)}
                sending={sending || Boolean(pendingMessage)}
                attachments={attachments}
                answerQuestion={questionForm?.question}
                draft={questionForm?.question ? questionForm.draft : draft}
                fallbackBackground={fieldBackground}
                foreground={foreground}
                liquidGlassAvailable={liquidGlassAvailable}
                muted={muted}
                raised={raised}
                onChangeDraft={questionForm?.question ? questionForm.setDraft : setDraft}
                onSend={sendMessage}
              />
            </Animated.View>
          </KeyboardGestureArea>
        </View>
        {attachments.cameraOpen && isFocused && appActive ? (
          <ChatCameraPanel
            origin={attachments.cameraOrigin}
            onClose={attachments.closeCamera}
            onPhoto={attachments.addPhoto}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}
