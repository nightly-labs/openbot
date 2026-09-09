import { isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { router, useIsFocused } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState, Keyboard, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
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
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { isIOS } from "@/shared/lib/platform";

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
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
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
    conversations,
    loadConversation,
    markAgentRead,
    servers,
    respondToPrompt,
    sendMessage: sendTeamMessage,
    uploadAttachment,
    discardAttachment,
  } = useMobileWorkspace();
  const conversation = conversations[agent.id];
  const activity = useAgentActivity(agent.id);
  const projectedMessages = useMemo(() => projectChatMessages(conversation?.messages ?? []), [conversation]);
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

  function sendMessage(value: string): void {
    if (!serverOnline || sendingRef.current || pendingMessage) return;
    const body = value.trim();
    if (!body && attachments.items.length === 0) return;

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
    const files = attachments.items;
    const localId = `local-message-${++sendSequence.current}`;
    setPendingMessage({
      message: {
        id: localId,
        kind: "message",
        author: "user",
        body,
        streaming: false,
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
      } catch {
        motion.cancelSend();
        setPendingMessage((current) => (current?.message.id === localId ? null : current));
        setDraft((current) => (current ? `${body}\n${current}` : body));
        // Only discard drafts created by this attempt. Keep the local files and text for retry.
        await Promise.allSettled(uploaded.map((id) => discardAttachment(agent.id, id)));
        Alert.alert(
          "Message not sent",
          "Your text and attachments are still here. Check the connection and try again.",
        );
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
              motion.onComposerLayout(event);
              setComposerGestureHeight(event.nativeEvent.layout.height);
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
            <ChatComposer
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
          </KeyboardStickyView>
        </KeyboardGestureArea>
      </View>
    </GestureDetector>
  );
}
