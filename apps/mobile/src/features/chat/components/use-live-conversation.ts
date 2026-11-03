import {
  type ChannelMessage,
  type ChannelTask,
  type ConversationMessage,
  isAgentAnswer,
  latestTurnAnswer,
  type QueueDelivery,
} from "@openbot/contracts/ipc";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";
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
import {
  createNativeRealtimeVoice,
  type NativeRealtimeVoice,
  nativeRealtimeVoiceAvailable,
  type RealtimeVoicePort,
} from "@/features/voice/model/realtime-voice";
import { REPLY_VOICE_FAILURE_TEXT, type ReplyReading, streamReply } from "@/features/voice/model/reply-voice";
import { speechNative } from "@/features/voice/model/speech-native";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";
import { type LiveConversationPhase, liveReplyTurn } from "../model/live-conversation";
import type { OutboxMessage } from "../model/outbox";
import { useVoiceDictation, type VoiceDictation } from "./use-voice-dictation";

/** The pause after the last recognized words that ends the user's turn. */
const TURN_END_SILENCE_MS = 1_300;
/**
 * The agent's turn ended, or has not shown as running yet, and its answer is not in the
 * conversation: the read that the end starts brings it. After this long the conversation listens again.
 */
const REPLY_GRACE_MS = 5_000;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 460;
const CLOSE_MS = 400;
const SPEAKING_PULSE_MS = 420;

/** The message that was said, until the reply to it is read or dropped. */
interface PendingReply {
  clientMessageId: string;
  messageId: string | null;
  turnId: string | null;
  /** When the turn showed as ended with no answer yet. */
  endedAt: number | null;
  /**
   * In a channel: the messages that were there when the words were sent, and the member that the
   * words name at their start, whose answer is read. A channel send has no host message id.
   */
  channel: { known: ReadonlySet<string>; knownTasks: ReadonlySet<string>; namedId: string | null } | null;
}

/** A channel's messages, tasks and leader, for a voice conversation in the channel. */
export interface LiveChannel {
  messages: readonly ChannelMessage[];
  tasks: readonly Pick<ChannelTask, "id" | "ownerAgentId">[];
  leadAgentId: string | null;
}

interface LiveConversationInput {
  realtime?: RealtimeVoicePort | null;
  /** The chat is in front and the user can write here. */
  enabled: boolean;
  /** The agent's server is connected. */
  online: boolean;
  focused: boolean;
  foreground: boolean;
  /** The agent's conversation; null in a channel. */
  conversation: { messages: readonly ConversationMessage[]; activeTurnId: string | null } | null;
  /** The channel; null in an agent chat. */
  channel: LiveChannel | null;
  deliveries: readonly Pick<QueueDelivery, "id" | "messageId" | "turnId">[];
  outboxMessages: readonly OutboxMessage[];
  /** Sends what the user said. Null when the chat could not take it. */
  send: (text: string) => OutboxMessage | null;
}

interface LiveConversationState {
  realtime: boolean;
  permissionPending: boolean;
  open: boolean;
  phase: LiveConversationPhase;
  muted: boolean;
  caption: string;
  error: string | null;
  exit: "cancel" | null;
  /** In a channel, the agent whose answer is read now; null before an answer, and in an agent chat. */
  speakerId: string | null;
}

const CLOSED: LiveConversationState = {
  realtime: false,
  permissionPending: false,
  open: false,
  phase: "starting",
  muted: false,
  caption: "",
  error: null,
  exit: null,
  speakerId: null,
};

export interface LiveConversation extends LiveConversationState {
  realtimeReady: boolean;
  /** The phone can listen and speak. */
  available: boolean;
  /** The voice that is heard now, from 0 to 1: the user's while listening, a pulse while speaking. */
  level: SharedValue<number>;
  /** 0 with the chat, 1 with the conversation. */
  presence: SharedValue<number>;
  start: () => void;
  toggleMute: () => void;
  /** Stops the reply, or the wait for it, and listens again. The agent's turn goes on. */
  interrupt: () => void;
  end: () => void;
}

/**
 * A conversation by voice with one agent, as on desktop. It listens until the user stops speaking,
 * sends the words to the chat, and reads the answer aloud while the agent writes it, with the voice in
 * Settings > Voice (Supertonic 3 on the phone, or ElevenLabs); then it listens again. The microphone
 * is off while the agent thinks or speaks, because the recognizer would hear the reply; Interrupt
 * stops the reply instead.
 */
export function useLiveConversation(input: LiveConversationInput): LiveConversation {
  const [state, setState] = useState(CLOSED);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const inputRef = useRef({ ...input, realtimeReady });
  inputRef.current = { ...input, realtimeReady };
  useEffect(() => {
    let current = true;
    setRealtimeReady(false);
    if (!input.realtime || !input.online || !input.focused || !input.foreground || !nativeRealtimeVoiceAvailable())
      return;
    void input.realtime
      .status()
      .then((status) => {
        if (current) setRealtimeReady(status.enabled);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [input.realtime, input.online, input.focused, input.foreground]);
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
    enabled: input.enabled && input.online && state.open && !state.exit && !state.realtime,
    onDraft: controller.hear,
    onSpeaking: controller.speaking,
  });
  dictationRef.current = dictation;
  const { conversation, channel, deliveries, outboxMessages } = input;
  const available =
    realtimeReady || (dictation.available && Boolean(speechNative) && (conversation !== null || channel !== null));

  useEffect(() => {
    controller.followReply({ conversation, channel, deliveries, outboxMessages });
  }, [controller, conversation, channel, deliveries, outboxMessages]);

  useEffect(() => {
    controller.recognizerPhase(dictation.phase);
  }, [controller, dictation.phase]);

  useEffect(() => {
    controller.connection(input.online);
  }, [controller, input.online]);

  // The conversation belongs to the chat in front of an active app: a screen above the chat, or the
  // app in the background, ends it, as closing the pane does on desktop. Android reports the app as
  // in the background while its permission dialog is open, so the first start must not end itself.
  const asking = dictation.phase === "starting" || state.permissionPending;
  useEffect(() => {
    if (state.open && (!input.enabled || !input.focused || (!input.foreground && !asking))) controller.end();
  }, [controller, state.open, input.enabled, input.focused, input.foreground, asking]);

  // The user speaks hands-free, and a screen lock would put the app in the background.
  const keepAwakeTag = useId();
  useEffect(() => {
    if (!state.open) return;
    activateKeepAwakeAsync(keepAwakeTag).catch(() => {});
    return () => {
      deactivateKeepAwake(keepAwakeTag).catch(() => {});
    };
  }, [state.open, keepAwakeTag]);

  // Android back ends the conversation before it leaves the chat.
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
    realtimeReady,
    available,
    level: state.phase === "speaking" ? speechLevel : dictation.level,
    presence,
    start: controller.start,
    toggleMute: controller.toggleMute,
    interrupt: controller.interrupt,
    end: controller.end,
  };
}

/**
 * The steps of the conversation. They read the newest input and recognizer through the getters, and
 * keep their own copies of the state: a state read shows a write only after the next render.
 */
export function createController({
  input,
  dictation,
  setState,
  presence,
  speechLevel,
}: {
  input: () => LiveConversationInput & { realtimeReady: boolean };
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
  /** The reply that is read aloud now, and the answer messages of its turn in order. */
  let reading: ReplyReading | null = null;
  let readIds: string[] = [];
  let speakerId: string | null = null;
  const readTexts = new Map<string, string>();
  /** Each turn, interruption and the end make the work of the turn before them stale. */
  let generation = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** The recognizer reached `listening` in this session: an end after that is not a failed start. */
  let sessionListened = false;
  let previousRecognizerPhase: VoiceDictation["phase"] = "idle";
  let startedAt = 0;
  let turns = 0;
  let realtime: NativeRealtimeVoice | null = null;
  let usesRealtime = false;

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

  /** Ends the current turn's work: its recognizer session, its reply and its timers. */
  function drop(): void {
    generation += 1;
    clearTimers();
    stopSpeaking();
    pending = null;
  }

  /** Opens the microphone for the user's next turn, unless it is muted. */
  function listen(): void {
    drop();
    heard = "";
    setPhase("listening");
    setCaption("");
    // The next words go to the channel, so the leader listens again.
    setSpeaker(null);
    if (muted || !open) return;
    if (usesRealtime) return;
    sessionListened = false;
    if (!dictation()?.start("")) setMuted(true);
  }

  /** The user paused: the words so far are the turn. */
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

  /**
   * Reads the answer while the agent writes it. A turn can answer in more than one message: their
   * texts join in order, so the text only grows. The phase turns to speaking when the first part plays.
   */
  function readAnswer(answer: ConversationMessage, complete: boolean): void {
    if (usesRealtime) {
      // The provider reads one final, delivery-correlated answer. It never executes agent work.
      if (!complete) return;
      pending = null;
      realtime?.speak(speechTextFromMarkdown(answer.text));
      return;
    }
    if (!reading) {
      const own = generation;
      reading = streamReply({
        onPart: (part) => {
          if (own !== generation) return;
          if (phase !== "speaking") {
            clearTimers();
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
        onError: (failure) => {
          if (own !== generation || !open) return;
          listen();
          update({ error: currentText().t(REPLY_VOICE_FAILURE_TEXT[failure]) });
        },
      });
    }
    if (!readTexts.has(answer.id)) readIds.push(answer.id);
    readTexts.set(answer.id, answer.text);
    reading.update(readIds.map((id) => readTexts.get(id) ?? "").join("\n\n"), complete);
    if (complete) pending = null;
  }

  /**
   * Follows the message that was said to the turn that answers it, and reads the answer when the
   * turn ends. A message that the outbox could not send ends the wait.
   */
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
    current.turnId ??= current.messageId
      ? usesRealtime
        ? (conversation.messages.find((message) => message.id === current.messageId)?.turnId ??
          deliveries.find((delivery) => delivery.id === current.messageId)?.turnId ??
          null)
        : liveReplyTurn(conversation.messages, deliveries, current.messageId)
      : null;
    const turnId = current.turnId;
    const active = turnId !== null && conversation.activeTurnId === turnId;
    const answer = turnId ? latestTurnAnswer(conversation.messages, turnId) : undefined;
    // The answer plays while it streams. It is complete when it is done and its turn has ended.
    if (answer && (answer.status === "streaming" || answer.status === "completed")) {
      current.endedAt = null;
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
      readAnswer(answer, answer.status === "completed" && !active);
      return;
    }
    // A stopped or failed answer is not read, as on desktop.
    if (answer) {
      listen();
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
      if (own === generation && pending === current) listen();
    }, REPLY_GRACE_MS);
  }

  /**
   * The recognizer can end without a pause: Android ends a session at a silence, iOS at its time
   * limit, and an error or a denied permission ends it too. Words said so far are the turn; a
   * session that never listened mutes the microphone, and its alert explains why.
   */
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

  /** The agent in the call bar. Null shows the channel's leader. */
  function setSpeaker(agentId: string | null): void {
    if (speakerId === agentId) return;
    speakerId = agentId;
    update({ speakerId });
  }

  /**
   * In a channel the answer is the first new answer of any agent: the leader's, or the answer of the
   * member that the leader gave the task to. Words that name a member at their start wait for that
   * member. The call bar shows the member as soon as a new task is given to it, and then the agent
   * that answers. The answer is read while it streams.
   */
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
    // A stopped or failed answer is not read, as in an agent chat.
    else listen();
  }

  /** No reply comes while the server is away, so the conversation stops until it is back. */
  function connection(online: boolean): void {
    if (!open || exiting) return;
    if (!online && phase !== "offline") {
      realtime?.close();
      realtime = null;
      drop();
      dictation()?.cancel();
      setPhase("offline");
      setCaption("");
      update({ error: currentText().t("mobile.chat.liveVoice.offline") });
    } else if (online && phase === "offline") {
      update({ error: null });
      if (usesRealtime) void startRealtime();
      else listen();
    }
  }

  async function startRealtime(): Promise<void> {
    const port = input().realtime;
    if (!port || !open || exiting) return;
    setPhase("starting");
    update({ permissionPending: true });
    const own = generation;
    const call: NativeRealtimeVoice = createNativeRealtimeVoice({
      port,
      microphoneReady: () => {
        if (realtime === call && open && !exiting) update({ permissionPending: false });
      },
      transcript: (text, delegated) => {
        if (realtime !== call || !open || exiting || muted) return false;
        if (delegated) {
          if (pending || reading) return false;
          listen();
          deliver(text);
          return true;
        }
        if (phase === "thinking" || phase === "speaking") {
          call.interrupt();
          listen();
        }
        if (phase === "listening") deliver(text);
      },
      speechStarted: () => {
        if (realtime !== call || !open || exiting || muted) return;
        if (phase === "thinking" || phase === "speaking") listen();
      },
      speaking: (text) => {
        if (realtime !== call || !open || exiting) return;
        setPhase("speaking");
        setCaption(text);
        speechLevel.set(
          withRepeat(
            withTiming(0.55, { duration: SPEAKING_PULSE_MS, easing: Easing.inOut(Easing.ease) }),
            -1,
            true,
            undefined,
            ReduceMotion.System,
          ),
        );
      },
      spoken: () => {
        if (realtime !== call || !open || exiting) return;
        // Small talk and acknowledgements can finish while the accepted agent request is running.
        // Keep its delivery correlation until the final answer arrives or the caller interrupts.
        stopSpeaking();
        setCaption("");
        setPhase(pending ? "thinking" : "listening");
      },
      failed: () => {
        if (realtime !== call || !open || exiting) return;
        realtime = null;
        drop();
        setMuted(true);
        setPhase("offline");
        update({ error: currentText().t("mobile.chat.liveVoice.realtimeFailed"), permissionPending: false });
      },
      expired: () => {
        if (realtime !== call || !open || exiting) return;
        realtime = null;
        drop();
        setMuted(true);
        setPhase("offline");
        update({ error: currentText().t("mobile.chat.liveVoice.realtimeFailed"), permissionPending: false });
      },
    });
    realtime = call;
    try {
      await call.start();
      if (realtime !== call || !open || exiting || own !== generation) {
        call.close();
        return;
      }
      call.mute(muted);
      listen();
    } catch {
      if (realtime !== call || !open || exiting) return;
      realtime = null;
      setMuted(true);
      setPhase("offline");
      update({ error: currentText().t("mobile.chat.liveVoice.realtimeFailed"), permissionPending: false });
    }
  }

  function closed(): void {
    open = false;
    exiting = false;
    setState(() => CLOSED);
  }

  return {
    /** The words the recognizer heard in this session so far. */
    hear(text: string): void {
      // The final text of the turn can come after the pause ended it, while `finish` waits for it.
      if (!open || (phase !== "listening" && phase !== "sending")) return;
      heard = text;
      update({ caption: text });
      if (phase === "sending") return;
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = text.trim() ? setTimeout(endTurn, TURN_END_SILENCE_MS) : null;
    },
    /**
     * The user speaks now. Parakeet and ElevenLabs send text a while after the words, so the pause
     * that ends the turn counts from the last speech, not from the last text.
     */
    speaking(): void {
      if (!open || phase !== "listening" || !heard.trim()) return;
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = setTimeout(endTurn, TURN_END_SILENCE_MS);
    },
    followReply,
    recognizerPhase,
    connection,
    start(): void {
      const { conversation, channel, enabled, online } = input();
      if (open || (!conversation && !channel) || !enabled) return;
      usesRealtime = Boolean(input().realtimeReady && input().realtime && conversation);
      if (!usesRealtime && !speechNative) return;
      open = true;
      exiting = false;
      muted = false;
      startedAt = performance.now();
      turns = 0;
      setState(() => ({ ...CLOSED, open: true, realtime: usesRealtime }));
      void haptics.impact("light");
      mobileAnalytics.track("voice_conversation_action", {
        action: "start",
        server_kind: "remote",
        result: "succeeded",
      });
      // The composer turns into the call bar on this progress.
      presence.set(withTiming(1, { duration: OPEN_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
      // Started while the server is away, it waits for the server as it would after a disconnect.
      if (online && usesRealtime) void startRealtime();
      else if (online) listen();
      else {
        phase = "listening";
        connection(false);
      }
    },
    toggleMute(): void {
      if (!open || exiting) return;
      setMuted(!muted);
      if (usesRealtime) {
        realtime?.mute(muted);
        if (muted) setCaption("");
        return;
      }
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
      realtime?.interrupt();
      listen();
    },
    end(): void {
      if (!open || exiting) return;
      exiting = true;
      realtime?.close();
      realtime = null;
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
      // The call bar opens back into the composer.
      presence.set(
        withTiming(0, { duration: CLOSE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }, (finished) => {
          if (finished) scheduleOnRN(closed);
        }),
      );
    },
    dispose(): void {
      realtime?.close();
      realtime = null;
      if (open) stopSpeaking();
      generation += 1;
      clearTimers();
      open = false;
    },
  };
}
