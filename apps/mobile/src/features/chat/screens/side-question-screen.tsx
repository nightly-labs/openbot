import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Keyboard, useColorScheme, View } from "react-native";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { useRowsAfterOpenTransition } from "@/features/chat/components/chat-view";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import {
  useComposerDictation,
  useComposerDictationWithSettings,
} from "@/features/chat/components/use-composer-dictation";
import { useLeaveChat } from "@/features/chat/components/use-leave-chat";
import { projectChatMessages } from "@/features/chat/model/chat-messages";
import type { AgentChatTarget } from "@/features/chat/model/chat-target";
import {
  askSideQuestion,
  deleteSideQuestion,
  type SideQuestionExchange,
  setSideQuestionDraft,
  useSideQuestion,
} from "@/features/chat/model/side-questions";
import { voiceAccent, voicePalette } from "@/features/chat/model/voice-palette";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { sameAgentApartFromMessage, sameAgentsApartFromMessage } from "@/features/workspace/model/directory-agents";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useReducedTransparency } from "@/shared/lib/use-reduced-transparency";

const NO_MESSAGES: never[] = [];
const NO_ALIASES: ReadonlyMap<string, string> = new Map();
const NO_EXCHANGES: readonly SideQuestionExchange[] = [];
const NO_AGENTS: MobileAgent[] = [];

/** The questions and answers as chat messages, so the list draws them as the agent's chat does. */
function exchangeMessages(exchanges: readonly SideQuestionExchange[]): ConversationMessage[] {
  return exchanges.flatMap((exchange): ConversationMessage[] => {
    const question: ConversationMessage = {
      id: `${exchange.id}:question`,
      author: "user",
      text: exchange.question,
      createdAt: exchange.askedAt,
      status: "completed",
    };
    if (exchange.answer === null || exchange.answeredAt === null) return [question];
    return [
      question,
      {
        id: `${exchange.id}:answer`,
        author: "assistant",
        text: exchange.answer,
        createdAt: exchange.answeredAt,
        status: "completed",
      },
    ];
  });
}

/**
 * A question about an agent's chat that stays out of the chat, as the side question pane on desktop.
 * The agent answers with its own model, with no tools, and the host keeps nothing of it. Back keeps
 * it on this phone, so the More menu and the swipe open it again; Delete in the header deletes it.
 */
export function SideQuestionScreen() {
  const { t } = useText();
  const { serverId, agentId } = useLocalSearchParams<{ serverId: string; agentId: string }>();
  // Only this agent: a change elsewhere in the workspace, such as a streamed reply, does not render the
  // screen again.
  const agent = useMobileWorkspaceSelector(
    (current) => current.agents.find((item) => item.id === agentId && item.serverId === serverId),
    sameAgent,
  );
  const target = useMemo<AgentChatTarget | undefined>(() => (agent ? { ...agent, kind: "agent" } : undefined), [agent]);
  if (target) return <SideQuestionChat key={`${serverId}:${agentId}`} target={target} />;
  return <SideQuestionNote note={t("mobile.chat.sideQuestion.notFound")} />;
}

function SideQuestionNote({ note }: { note: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center bg-background"
      style={{ paddingLeft: insets.left + 32, paddingRight: insets.right + 32 }}
    >
      <Typography.Paragraph align="center" className="text-text-secondary">
        {note}
      </Typography.Paragraph>
    </View>
  );
}

function SideQuestionChat({ target }: { target: AgentChatTarget }) {
  const { t, errorMessage } = useText();
  const leave = useLeaveChat();
  const { serverId, id: agentId } = target;
  const { askSideQuestion: askHost } = useMobileWorkspaceActions();
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === serverId));
  const agents = useMobileWorkspaceSelector((current) => current.agents, sameAgentsApartFromMessage);
  const supported = useMobileWorkspaceSelector((current) => current.canAskSideQuestion(serverId));
  const online = showsOnline(server);
  // As in the agent's chat: while the connection resumes, a question waits for it.
  const canAsk = online && supported;
  const serverAgents = useMemo(() => agents.filter((item) => item.serverId === serverId), [agents, serverId]);
  const sideQuestion = useSideQuestion(serverId, agentId);
  const exchanges = sideQuestion?.exchanges ?? NO_EXCHANGES;
  const draft = sideQuestion?.draft ?? "";
  const failures = sideQuestion?.failures ?? 0;
  const asking = exchanges.at(-1)?.answer === null;
  const messages = useMemo(() => projectChatMessages(exchangeMessages(exchanges)), [exchanges]);
  const setDraft = useCallback((value: string) => setSideQuestionDraft(serverId, agentId, value), [serverId, agentId]);

  const isFocused = useIsFocused();
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
  const rowsShown = useRowsAfterOpenTransition();
  const lastUserId = messages.findLast((row) => row.kind === "message" && row.author === "user")?.id ?? null;
  const motion = useChatMotion(
    insets.top + 84,
    keyboardOffset,
    rowsShown,
    rowsShown && messages.length > 0,
    lastUserId,
  );
  // As in the agent's chat: the mic beside the main control dictates into the draft, and only Send
  // asks. Losing the server or a screen on top stops listening and keeps the words.
  const dictation = useComposerDictation({
    enabled: isFocused && canAsk,
    focused: isFocused,
    draft,
    onDraft: setDraft,
  });
  const composerDictation = useComposerDictationWithSettings(dictation);
  const dark = useColorScheme() === "dark";
  const accent = useMemo(
    () => voiceAccent(voicePalette([avatarHeadColor(target.avatarSeed, target.avatarHue, target.avatarColor)], dark)),
    [target.avatarSeed, target.avatarHue, target.avatarColor, dark],
  );

  // A failed question removes its row, so the list stops waiting to show it at the top.
  const cancelSend = useRef(motion.cancelSend);
  useEffect(() => {
    cancelSend.current = motion.cancelSend;
  });
  useEffect(() => {
    if (failures > 0) cancelSend.current();
  }, [failures]);

  // A Send that asks nothing, such as while the last question waits for its answer, keeps Send open.
  const [ignoredSends, setIgnoredSends] = useState(0);
  const ask = (value: string) => {
    const question = value.trim();
    if (!question || !canAsk || asking) {
      setIgnoredSends((count) => count + 1);
      return;
    }
    Keyboard.dismiss();
    void haptics.impact();
    motion.beginSend();
    askSideQuestion(
      serverId,
      agentId,
      question,
      (input) => askHost(input, serverId),
      (error) => errorMessage(error, t("mobile.chat.sideQuestion.error")),
    );
  };

  const remove = () => {
    void haptics.impact("soft");
    Alert.alert(t("mobile.chat.sideQuestion.deleteTitle"), t("mobile.chat.sideQuestion.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          deleteSideQuestion(serverId, agentId);
          leave();
        },
      },
    ]);
  };

  const emptyNote =
    exchanges.length === 0 ? (
      <View className="gap-1 px-1 py-4">
        <Typography.Heading type="h4">{t("mobile.chat.sideQuestion.emptyTitle")}</Typography.Heading>
        <Typography.Paragraph className="text-text-secondary">
          {t("mobile.chat.sideQuestion.emptyBody", { name: target.name })}
        </Typography.Paragraph>
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
          title={t("mobile.chat.sideQuestion.title")}
          deleteAction={{
            label: t("mobile.chat.sideQuestion.delete"),
            disabled: sideQuestion === undefined,
            onPress: remove,
          }}
          fallbackBackground={fieldBackground}
          foreground={foreground}
          liquidGlassAvailable={liquidGlassAvailable}
          topInset={insets.top}
          onBack={leave}
        />
        <ChatMessageList
          bubbleSurface={String(background)}
          agents={serverAgents}
          rowsShown={rowsShown}
          target={target}
          motion={motion}
          sending={false}
          awaitingTurn={asking}
          keyboardOffset={keyboardOffset}
          canSend={canAsk}
          online={online}
          appActive={appActive}
          activeTurnId={null}
          activityAccessory={emptyNote}
          foreground={foreground}
          historyState="ready"
          messages={messages}
          messageAliases={NO_ALIASES}
          referenceMessages={NO_MESSAGES}
          hasOlder={false}
          olderLoading={false}
          olderError={false}
          onLoadOlder={() => {}}
          muted={muted}
          showStarter={false}
          topInset={insets.top}
          onRetryHistory={() => {}}
        />
        <Animated.View
          style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, motion.composerStyle]}
          pointerEvents="box-none"
          onLayout={motion.onComposerLayout}
        >
          <View style={{ paddingLeft: insets.left, paddingRight: insets.right }}>
            <ConnectionStatus server={server} />
          </View>
          {sideQuestion?.error ? (
            <Typography.Paragraph
              accessibilityRole="alert"
              className="bg-background py-2 text-danger-text"
              style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
            >
              {sideQuestion.error}
            </Typography.Paragraph>
          ) : null}
          <ChatComposer
            sendRetryVersion={failures + ignoredSends}
            replyTarget={null}
            replyFocusVersion={0}
            onCancelReply={() => {}}
            mentionAgents={NO_AGENTS}
            action={action}
            actionForeground={actionForeground}
            agentName={target.name}
            sendLabel={t("mobile.chat.sideQuestion.send")}
            placeholder={t("mobile.chat.sideQuestion.placeholder")}
            bottomInset={insets.bottom}
            disabled={!canAsk}
            draft={draft}
            fallbackBackground={fieldBackground}
            foreground={foreground}
            liquidGlassAvailable={liquidGlassAvailable}
            muted={muted}
            raised={raised}
            onChangeDraft={setDraft}
            onSend={ask}
            keyboardProgress={motion.keyboardProgress}
            dictation={composerDictation}
            voiceAccent={accent}
          />
        </Animated.View>
      </KeyboardGestureArea>
    </View>
  );
}

function sameAgent(previous: MobileAgent | undefined, next: MobileAgent | undefined): boolean {
  return previous !== undefined && next !== undefined && sameAgentApartFromMessage(previous, next);
}
