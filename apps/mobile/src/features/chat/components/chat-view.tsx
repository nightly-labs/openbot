import { userErrorMessage } from "@openbot/user-errors";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { router, useIsFocused } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { latestReadableMessage, projectChatMessages } from "@/features/chat/model/chat-messages";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
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
  const [atLatest, setAtLatest] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const keyboardOffset = Math.max(insets.bottom, 10) - 10;
  const { leaveAgentChatAnimated } = useAgentPinTransition();
  const scrollViewRef = useRef<ComponentRef<typeof ChatMessageList>>(null);
  const initialScrollAgentIdRef = useRef<string | null>(agent.id);
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
  const [sendError, setSendError] = useState<{ agentId: string; message: string } | null>(null);
  const [showStarter, setShowStarter] = useState(true);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const historyRequestRef = useRef(0);
  const {
    conversations,
    loadConversation,
    markAgentRead,
    servers,
    respondToPrompt,
    sendMessage: sendTeamMessage,
  } = useMobileWorkspace();
  const conversation = conversations[agent.id];
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const activity = useAgentActivity(agent.id);
  const messages = useMemo(() => projectChatMessages(conversation?.messages ?? []), [conversation]);
  const liquidGlassAvailable = isLiquidGlassAvailable();
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
    if (isFocused && appActive && atLatest && serverOnline && readBoundary && readBoundaryStatus) {
      markAgentRead(agent.id, readBoundary);
    }
  }, [isFocused, appActive, atLatest, serverOnline, readBoundary, readBoundaryStatus, agent.id, markAgentRead]);

  useEffect(() => {
    setAtLatest(false);
    initialScrollAgentIdRef.current = agent.id;
  }, [agent.id]);

  const fetchHistory = useCallback(() => {
    if (!serverOnline) return;
    const requestId = ++historyRequestRef.current;
    const revisionBeforeLoad = conversationRef.current?.revision ?? null;
    setHistoryLoadFailed(false);
    void loadConversation(agent.id)
      .then((snapshot) => {
        if (
          historyRequestRef.current === requestId &&
          (revisionBeforeLoad === null || snapshot.revision > revisionBeforeLoad)
        ) {
          initialScrollAgentIdRef.current = agent.id;
        }
      })
      .catch(() => {
        if (historyRequestRef.current === requestId) setHistoryLoadFailed(true);
      });
  }, [agent.id, loadConversation, serverOnline]);

  useEffect(() => {
    fetchHistory();
    return () => {
      historyRequestRef.current += 1;
    };
  }, [fetchHistory]);

  const handleContentSizeChange = useCallback(() => {
    if (!conversation || (initialScrollAgentIdRef.current !== agent.id && !atLatest)) return;
    initialScrollAgentIdRef.current = null;
    scrollViewRef.current?.scrollToEnd({ animated: false });
    setAtLatest(true);
  }, [atLatest, agent.id, conversation]);

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
    if (!serverOnline) return;
    const body = value.trim();
    if (!body) return;
    setSendError(null);

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (questionForm.question) {
      questionForm.answer([body]);
      requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true }));
      return;
    }
    setDraft("");
    setShowStarter(false);
    void sendTeamMessage(agent.id, body).catch((error) => {
      setDraft((current) => current || body);
      setSendError({
        agentId: agent.id,
        message: userErrorMessage(
          error,
          "Could not send the message. Check the conversation before you send it again.",
        ),
      });
    });
    requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true }));
  }

  return (
    <GestureDetector gesture={edgeBackGesture}>
      <View className="flex-1" style={{ backgroundColor: background }}>
        <View className="flex-1">
          <ChatHeader
            agent={agent}
            fallbackBackground={fieldBackground}
            foreground={foreground}
            liquidGlassAvailable={liquidGlassAvailable}
            topInset={insets.top}
            onBack={handleLeaveConversation}
          />
          <ChatMessageList
            ref={scrollViewRef}
            agent={agent}
            bottomInset={composerHeight}
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
            onContentSizeChange={handleContentSizeChange}
            onEndVisible={setAtLatest}
            onDismissStarter={() => setShowStarter(false)}
            onSelectStarter={sendMessage}
            onRetryHistory={fetchHistory}
          />
          <KeyboardStickyView
            style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
            offset={{ opened: keyboardOffset }}
            pointerEvents="box-none"
            onLayout={({ nativeEvent: { layout } }) => setComposerHeight(layout.height)}
          >
            <ConnectionStatus server={server} />
            {sendError?.agentId === agent.id ? (
              <Typography.Paragraph accessibilityRole="alert" className="bg-background px-4 py-2 text-danger">
                {sendError.message}
              </Typography.Paragraph>
            ) : null}
            <ChatComposer
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
        </View>
      </View>
    </GestureDetector>
  );
}
