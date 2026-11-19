import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import { isNarrationItemId } from "@openbot/contracts/conversation-narration";
import {
  type ChannelMessage,
  type ChannelTask,
  type ConversationMessage,
  isAgentAnswer,
  latestTurnAnswer,
  type QueueDelivery,
} from "@openbot/contracts/ipc";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useId, useRef, useState } from "react";
import { BackHandler } from "react-native";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { type ReplyReading, replyVoiceFailureText, streamReply } from "@/features/voice/model/reply-voice";
import { speechNative } from "@/features/voice/model/speech-native";
import { useVoiceSettings } from "@/features/voice/model/voice-settings";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";
import { type LiveConversationPhase, liveReplyTurn } from "../model/live-conversation";
import type { OutboxMessage } from "../model/outbox";
import { useVoiceDictation, type VoiceDictation } from "./use-voice-dictation";

const REPLY_GRACE_MS = 5_000;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 460;
const CLOSE_MS = 400;
const SPEAKING_PULSE_MS = 420;

interface PendingReply {
  clientMessageId: string;
  messageId: string | null;
  turnId: string | null;
  endedAt: number | null;
  channel: { known: ReadonlySet<string>; knownTasks: ReadonlySet<string>; namedId: string | null } | null;
}

export interface LiveChannel {
  messages: readonly ChannelMessage[];
  tasks: readonly Pick<ChannelTask, "id" | "ownerAgentId">[];
  leadAgentId: string | null;
}

interface LiveConversationInput {
  enabled: boolean;
  online: boolean;
  focused: boolean;
  foreground: boolean;
  conversation: { messages: readonly ConversationMessage[]; activeTurnId: string | null } | null;
  provider: AgentProviderRef | undefined;
  channel: LiveChannel | null;
  deliveries: readonly Pick<QueueDelivery, "messageId" | "turnId">[];
  outboxMessages: readonly OutboxMessage[];
  send: (text: string) => OutboxMessage | null;
}

interface LiveConversationState {
  open: boolean;
  phase: LiveConversationPhase;
  muted: boolean;
  caption: string;
  error: string | null;
  exit: "cancel" | null;
  speakerId: string | null;
}

const CLOSED: LiveConversationState = {
  open: false,
  phase: "starting",
  muted: false,
  caption: "",
  error: null,
  exit: null,
  speakerId: null,
};

export interface LiveConversation extends LiveConversationState {
  available: boolean;
  micOpen: boolean;
  level: SharedValue<number>;
  presence: SharedValue<number>;
  start: () => void;
  toggleMute: () => void;
  interrupt: () => void;
  end: () => void;
}

export function useLiveConversation(input: LiveConversationInput): LiveConversation {
  const [state, setState] = useState(CLOSED);
  const inputRef = useRef(input);
  inputRef.current = input;
  const presence = useSharedValue(0);
  const speechLevel = useSharedValue(0);
  const dictationRef = useRef<VoiceDictation | null>(null);
  const [controller] = useState(() =>
    createController({
      input: () => inputRef.current,
      dictation: () => dictationRef.current,
      setState,
      presence,
      speechLevel,
    }),
  );
  const dictation = useVoiceDictation({
    enabled: input.enabled && input.online && state.open && !state.exit,
    onDraft: controller.hear,
    endsOnPause: true,
  });
  dictationRef.current = dictation;
  const { conversation, channel, deliveries, outboxMessages } = input;
  const available = dictation.available && Boolean(speechNative) && (conversation !== null || channel !== null);

  useEffect(() => {
    controller.followReply({ conversation, channel, deliveries, outboxMessages });
  }, [controller, conversation, channel, deliveries, outboxMessages]);

  useEffect(() => {
    controller.recognizerPhase(dictation.phase);
  }, [controller, dictation.phase]);

  useEffect(() => {
    controller.connection(input.online);
  }, [controller, input.online]);

  const asking = dictation.phase === "starting";
  useEffect(() => {
    if (state.open && (!input.focused || (!input.foreground && !asking))) controller.end();
  }, [controller, state.open, input.focused, input.foreground, asking]);

  const keepAwakeTag = useId();
  useEffect(() => {
    if (!state.open) return;
    activateKeepAwakeAsync(keepAwakeTag).catch(() => {});
    return () => {
      deactivateKeepAwake(keepAwakeTag).catch(() => {});
    };
  }, [state.open, keepAwakeTag]);

  useEffect(() => {
    if (!state.open || !input.focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      controller.end();
      return true;
    });
    return () => subscription.remove();
  }, [controller, state.open, input.focused]);

  useEffect(() => () => controller.dispose(), [controller]);

  return {
    ...state,
    available,
    micOpen: dictation.phase === "listening",
    level: state.phase === "speaking" ? speechLevel : dictation.level,
    presence,
    start: controller.start,
    toggleMute: controller.toggleMute,
    interrupt: controller.interrupt,
    end: controller.end,
  };
}

function createController({
  input,
  dictation,
  setState,
  presence,
  speechLevel,
}: {
  input: () => LiveConversationInput;
  dictation: () => VoiceDictation | null;
  setState: (change: (current: LiveConversationState) => LiveConversationState) => void;
  presence: SharedValue<number>;
  speechLevel: SharedValue<number>;
}) {
  let open = false;
  let exiting = false;
  let phase: LiveConversationPhase = "starting";
  let muted = false;
  let heard = "";
  let pending: PendingReply | null = null;
  let reading: ReplyReading | null = null;
  let readIds: string[] = [];
  let speakerId: string | null = null;
  const readTexts = new Map<string, string>();
  let readUpdates: { turnId: string; ids: Set<string> } | null = null;
  let generation = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionListened = false;
  let previousRecognizerPhase: VoiceDictation["phase"] = "idle";
  let startedAt = 0;
  let turns = 0;

  const update = (change: Partial<LiveConversationState>) => setState((current) => ({ ...current, ...change }));
  const setPhase = (next: LiveConversationPhase) => {
    phase = next;
    update({ phase: next });
  };
  const setMuted = (next: boolean) => {
    muted = next;
    update({ muted: next });
  };
  const setCaption = (caption: string) => update({ caption });

  const turnEndSilence = () => useVoiceSettings.getState().turnPauseMs;

  function clearTimers(): void {
    if (pauseTimer) clearTimeout(pauseTimer);
    if (graceTimer) clearTimeout(graceTimer);
    pauseTimer = null;
    graceTimer = null;
  }

  function stopSpeaking(): void {
    cancelAnimation(speechLevel);
    speechLevel.set(0);
    reading?.stop();
    reading = null;
    readIds = [];
    readTexts.clear();
  }

  function drop(): void {
    generation += 1;
    clearTimers();
    stopSpeaking();
    pending = null;
  }

  function listen(): void {
    drop();
    heard = "";
    setPhase("listening");
    setCaption("");
    setSpeaker(null);
    if (muted || !open) return;
    sessionListened = false;
    if (!dictation()?.start("")) setMuted(true);
  }

  function endTurn(): void {
    if (!open || phase !== "listening") return;
    clearTimers();
    setPhase("sending");
    const own = generation;
    void dictation()
      ?.finish()
      .then(() => {
        if (own === generation && open) deliver(heard.trim());
      });
  }

  function deliver(text: string): void {
    if (!text) {
      listen();
      return;
    }
    const message = input().send(text);
    if (!message) {
      listen();
      update({ caption: text, error: currentText().t("mobile.chat.liveVoice.notSent") });
      return;
    }
    turns += 1;
    const room = input().channel;
    pending = {
      clientMessageId: message.clientMessageId,
      messageId: message.messageId,
      turnId: null,
      endedAt: null,
      channel: room
        ? {
            known: new Set(room.messages.map((entry) => entry.id)),
            knownTasks: new Set(room.tasks.map((task) => task.id)),
            namedId: message.target.kind === "channel" ? message.target.recipientAgentId : null,
          }
        : null,
    };
    setPhase("thinking");
    update({ caption: text, error: null });
    followReply();
  }

  function readAnswer(answer: ConversationMessage, complete: boolean, settled = false): void {
    if (!reading) {
      const own = generation;
      reading = streamReply({
        onPart: (part) => {
          if (own !== generation) return;
          if (phase !== "speaking") {
            if (pauseTimer) clearTimeout(pauseTimer);
            pauseTimer = null;
            setPhase("speaking");
            speechLevel.set(
              withRepeat(
                withTiming(0.55, { duration: SPEAKING_PULSE_MS, easing: Easing.inOut(Easing.ease) }),
                -1,
                true,
                undefined,
                ReduceMotion.System,
              ),
            );
          }
          setCaption(part);
        },
        onDone: () => {
          if (own === generation && open) listen();
        },
        onError: (failure, reason) => {
          if (own !== generation || !open) return;
          listen();
          update({ error: replyVoiceFailureText(failure, reason) });
        },
      });
    }
    if (!readTexts.has(answer.id)) readIds.push(answer.id);
    readTexts.set(answer.id, answer.text);
    reading.update(
      readIds.map((id) => readTexts.get(id) ?? "").join("\n\n"),
      complete,
      settled && readIds.at(-1) === answer.id,
    );
    if (complete) pending = null;
  }

  function endWithoutAnswer(): void {
    if (!reading) {
      listen();
      return;
    }
    pending = null;
    reading.update(readIds.map((id) => readTexts.get(id) ?? "").join("\n\n"), true);
  }

  function followReply(
    {
      conversation,
      channel,
      deliveries,
      outboxMessages,
    }: Pick<LiveConversationInput, "conversation" | "channel" | "deliveries" | "outboxMessages"> = input(),
  ): void {
    const current = pending;
    if (!current || (phase !== "thinking" && phase !== "speaking")) return;
    const outboxMessage = outboxMessages.find((message) => message.clientMessageId === current.clientMessageId);
    if (outboxMessage && (outboxMessage.state === "failed" || outboxMessage.returned || outboxMessage.stopped)) {
      listen();
      update({ caption: outboxMessage.text, error: currentText().t("mobile.chat.liveVoice.notSent") });
      return;
    }
    if (current.channel) {
      if (channel) followChannelReply(current.channel, channel);
      return;
    }
    if (!conversation) return;
    current.messageId = outboxMessage?.messageId ?? current.messageId;
    current.turnId ??= current.messageId ? liveReplyTurn(conversation.messages, deliveries, current.messageId) : null;
    const turnId = current.turnId;
    const active = turnId !== null && conversation.activeTurnId === turnId;
    if (
      readIds.some(
        (id) =>
          !readUpdates?.ids.has(id) &&
          !conversation.messages.some(
            (message) => message.id === id && message.turnId === turnId && isAgentAnswer(message),
          ),
      )
    ) {
      stopSpeaking();
      if (phase === "speaking") {
        setPhase("thinking");
        setCaption("");
      }
    }
    const answer = turnId ? latestTurnAnswer(conversation.messages, turnId) : undefined;
    const provider = input().provider;
    if (turnId && readUpdates?.turnId !== turnId) readUpdates = { turnId, ids: new Set() };
    for (const update of conversation.messages)
      if (
        turnId &&
        readUpdates &&
        update.turnId === turnId &&
        update.author === "assistant" &&
        update.itemType === "commentary" &&
        update.status === "completed" &&
        update.text.trim() &&
        !readTexts.has(update.id) &&
        !readUpdates.ids.has(update.id) &&
        isNarrationItemId(update.id, provider)
      ) {
        readUpdates.ids.add(update.id);
        readAnswer(update, false, true);
      }
    if (answer && (answer.status === "streaming" || answer.status === "completed")) {
      current.endedAt = null;
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
      readAnswer(answer, answer.status === "completed" && !active);
      return;
    }
    if (answer) {
      endWithoutAnswer();
      return;
    }
    if (!turnId || active) {
      current.endedAt = null;
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
      return;
    }
    if (current.endedAt !== null) return;
    current.endedAt = Date.now();
    const own = generation;
    graceTimer = setTimeout(() => {
      if (own === generation && pending === current) endWithoutAnswer();
    }, REPLY_GRACE_MS);
  }

  function recognizerPhase(next: VoiceDictation["phase"]): void {
    const before = previousRecognizerPhase;
    previousRecognizerPhase = next;
    if (next === "listening") sessionListened = true;
    if (next !== "idle" || before === "idle") return;
    if (!open || exiting || phase !== "listening" || muted || !input().online) return;
    if (heard.trim()) {
      clearTimers();
      setPhase("sending");
      deliver(heard.trim());
    } else if (sessionListened && input().enabled && input().foreground) listen();
    else setMuted(true);
  }

  function setSpeaker(agentId: string | null): void {
    if (speakerId === agentId) return;
    speakerId = agentId;
    update({ speakerId });
  }

  function followChannelReply(sent: NonNullable<PendingReply["channel"]>, channel: LiveChannel): void {
    const assignee = channel.tasks.find((task) => !sent.knownTasks.has(task.id) && task.ownerAgentId)?.ownerAgentId;
    if (assignee && phase === "thinking") setSpeaker(assignee);
    const entry = channel.messages.find(
      (candidate) =>
        !sent.known.has(candidate.id) &&
        candidate.author.kind === "agent" &&
        (sent.namedId === null || candidate.author.id === sent.namedId) &&
        isAgentAnswer(candidate.message),
    );
    if (!entry) return;
    setSpeaker(entry.author.id);
    const { status } = entry.message;
    if (status === "streaming" || status === "completed") readAnswer(entry.message, status === "completed");
    else listen();
  }

  function connection(online: boolean): void {
    if (!open || exiting) return;
    if (!online && phase !== "offline") {
      drop();
      dictation()?.cancel();
      setPhase("offline");
      setCaption("");
      update({ error: currentText().t("mobile.chat.liveVoice.offline") });
    } else if (online && phase === "offline") {
      update({ error: null });
      listen();
    }
  }

  function closed(): void {
    open = false;
    exiting = false;
    setState(() => CLOSED);
  }

  return {
    hear(text: string): void {
      if (!open || (phase !== "listening" && phase !== "sending")) return;
      const changed = text.trim() !== heard.trim();
      heard = text;
      update({ caption: text });
      if (phase === "sending" || !changed) return;
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = text.trim() ? setTimeout(endTurn, turnEndSilence()) : null;
    },
    followReply,
    recognizerPhase,
    connection,
    start(): void {
      const { conversation, channel, enabled, online } = input();
      if (open || !speechNative || (!conversation && !channel) || !enabled) return;
      open = true;
      exiting = false;
      muted = false;
      startedAt = performance.now();
      turns = 0;
      setState(() => ({ ...CLOSED, open: true }));
      void haptics.impact("light");
      mobileAnalytics.track("voice_conversation_action", {
        action: "start",
        server_kind: "remote",
        result: "succeeded",
      });
      presence.set(withTiming(1, { duration: OPEN_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
      if (online) listen();
      else {
        phase = "listening";
        connection(false);
      }
    },
    toggleMute(): void {
      if (!open || exiting) return;
      setMuted(!muted);
      void haptics.selection();
      if (phase !== "listening") return;
      if (muted) {
        generation += 1;
        clearTimers();
        dictation()?.cancel();
        heard = "";
        setCaption("");
      } else {
        update({ error: null });
        listen();
      }
    },
    interrupt(): void {
      if (!open || exiting || (phase !== "thinking" && phase !== "speaking")) return;
      void haptics.impact("light");
      listen();
    },
    end(): void {
      if (!open || exiting) return;
      exiting = true;
      drop();
      dictation()?.cancel();
      update({ exit: "cancel" });
      void haptics.selection();
      mobileAnalytics.track("voice_conversation_action", {
        action: "end",
        server_kind: "remote",
        result: "succeeded",
        duration_ms: performance.now() - startedAt,
        turn_count: turns,
      });
      presence.set(
        withTiming(0, { duration: CLOSE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }, (finished) => {
          if (finished) scheduleOnRN(closed);
        }),
      );
    },
    dispose(): void {
      if (open) stopSpeaking();
      generation += 1;
      clearTimers();
      open = false;
    },
  };
}
