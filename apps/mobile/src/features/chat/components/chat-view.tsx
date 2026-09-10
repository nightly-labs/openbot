import { userErrorMessage } from "@openbot/user-errors";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { router, useIsFocused } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState, Keyboard, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { type ChatBubbleMessage, useMessageActions } from "@/features/chat/context/message-actions-context";
import {
  latestReadableMessage,
  type PendingChatMessage,
  presentChatMessages,
  projectChatMessages,
} from "@/features/chat/model/chat-messages";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { isIOS } from "@/shared/lib/platform";
import { uploadChatAttachments } from "../model/upload-chat-attachments";
import { ChatCameraPanel } from "./chat-camera-panel";

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
  const { select: selectMessageActions } = useMessageActions();
  const [replyTarget, setReplyTarget] = useState<ChatBubbleMessage | null>(null);
  const [replyFocusVersion, setReplyFocusVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<{ agentId: string; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendRetryVersion, setSendRetryVersion] = useState(0);
  const [composerGestureHeight, setComposerGestureHeight] = useState(0);
  const sendingRef = useRef(false);
  const attachments = useChatAttachments();
  const [pendingMessage, setPendingMessage] = useState<PendingChatMessage | null>(null);
  const [messageAliases, setMessageAliases] = useState<ReadonlyMap<string, string>>(new Map());
  const sendSequence = useRef(0);
  const [showStarter, setShowStarter] = useState(true);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const historyRequestRef = useRef(0);
  const {
    agents,
    conversationStore,
    loadOlderMessages,
    loadConversation,
    markAgentRead,
    servers,
    respondToPrompt,
    sendMessage: sendTeamMessage,
    uploadAttachment,
    discardAttachment,
  } = useMobileWorkspace();
  const subscribeConversation = useCallback(
    (notify: () => void) => conversationStore.subscribe(agent.id, notify),
    [agent.id, conversationStore],
  );
  const getConversation = useCallback(() => conversationStore.get(agent.id), [agent.id, conversationStore]);
  const conversation = useSyncExternalStore(subscribeConversation, getConversation);
  const serverAgents = useMemo(
    () => agents.filter((candidate) => candidate.serverId === agent.serverId),
    [agents, agent.serverId],
  );
  const mentionAgents = useMemo(
    () => serverAgents.filter((candidate) => candidate.id !== agent.id),
    [serverAgents, agent.id],
  );
  const activity = useAgentActivity(agent.id);
  const projectedMessages = useMemo(() => projectChatMessages(conversation?.messages ?? []), [conversation?.messages]);
  const referenceMessages = useMemo(
    () => projectChatMessages(Object.values(conversation?.references ?? {})),
    [conversation?.references],
  );
  const messages = useMemo(
    () => presentChatMessages(projectedMessages, pendingMessage, messageAliases),
    [projectedMessages, pendingMessage, messageAliases],
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

  function sendMessage(value: string): void {
    if (!serverOnline || sendingRef.current || pendingMessage) return;
    const body = value.trim();
    if (!body && attachments.items.length === 0) return;

    setSendError(null);
    motion.beginSend();
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
    const submittedReply = replyTarget;
    setReplyTarget(null);
    const files = attachments.items;
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
          previewUrl: file.mimeType.startsWith("image/") ? `data:${file.mimeType};base64,${file.base64}` : null,
        })),
      },
      baseline: new Set(projectedMessages.map((message) => message.id)),
      serverId: null,
    });
    void (async () => {
      try {
        const serverId = await uploadChatAttachments(files, {
          upload: (file) => uploadAttachment(agent.id, file),
          discard: (id) => discardAttachment(agent.id, id),
          send: (ids) => sendTeamMessage(agent.id, body, ids, submittedReply?.id ?? null),
        });
        setMessageAliases((current) => new Map(current).set(serverId, localId));
        setPendingMessage((current) => (current?.message.id === localId ? { ...current, serverId } : current));
        attachments.clear();
      } catch (error) {
        motion.cancelSend();
        setPendingMessage((current) => (current?.message.id === localId ? null : current));
        setReplyTarget((current) => current ?? submittedReply);
        setDraft((current) => (current ? `${body}\n${current}` : body));
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
              agent={agent}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              liquidGlassAvailable={liquidGlassAvailable}
              topInset={insets.top}
              onBack={handleLeaveConversation}
            />
            <ChatMessageList
              agents={serverAgents}
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
              messageAliases={messageAliases}
              referenceMessages={referenceMessages}
              hasOlder={conversation?.pageInfo.hasOlder ?? false}
              olderLoading={conversation?.olderLoading ?? false}
              olderError={conversation?.olderError ?? false}
              onLoadOlder={() => {
                void loadOlderMessages(agent.id);
              }}
              onReply={
                !questionForm.question
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
                  onReply: !questionForm.question
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
              showStarter={showStarter && serverOnline && !activity && conversation?.messages.length === 0}
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
              {sendError?.agentId === agent.id ? (
                <Typography.Paragraph accessibilityRole="alert" className="bg-background px-4 py-2 text-danger">
                  {sendError.message}
                </Typography.Paragraph>
              ) : null}
              <ChatComposer
                sendRetryVersion={sendRetryVersion}
                replyTarget={questionForm.question ? null : replyTarget}
                replyFocusVersion={replyFocusVersion}
                onCancelReply={() => setReplyTarget(null)}
                mentionAgents={mentionAgents}
                key={JSON.stringify([
                  agent.id,
                  questionForm.question ? questionForm.messageId : null,
                  questionForm.question?.id,
                ])}
                action={action}
                actionForeground={actionForeground}
                agentName={agent.name}
                bottomInset={insets.bottom}
                disabled={!serverOnline || questionForm.pending}
                sending={sending || Boolean(pendingMessage)}
                attachments={attachments}
                answerQuestion={questionForm.question}
                draft={questionForm.question ? questionForm.draft : draft}
                fallbackBackground={fieldBackground}
                foreground={foreground}
                liquidGlassAvailable={liquidGlassAvailable}
                muted={muted}
                raised={raised}
                onChangeDraft={questionForm.question ? questionForm.setDraft : setDraft}
                onSend={sendMessage}
              />
            </Animated.View>
          </KeyboardGestureArea>
        </View>
        {attachments.cameraOpen && isFocused && appActive ? (
          <ChatCameraPanel onClose={attachments.closeCamera} onPhoto={attachments.addPhoto} />
        ) : null}
      </View>
    </GestureDetector>
  );
}
