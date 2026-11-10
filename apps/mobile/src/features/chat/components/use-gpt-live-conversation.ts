import type { CodexLiveVoice } from "@openbot/contracts/ipc";
import {
  isLiveVoiceName,
  type LiveVoiceEvent,
  type LiveVoiceSessionResponse,
  type LiveVoiceStartRequest,
} from "@openbot/contracts/team-protocol/live-voice-v1";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useId, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { Easing, ReduceMotion, type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";
import type { MediaStream, MediaStreamTrack, RTCPeerConnection } from "react-native-webrtc";
import { scheduleOnRN } from "react-native-worklets";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { liveVoiceWebRtc } from "@/features/voice/model/live-voice-webrtc";
import { speechNative } from "@/features/voice/model/speech-native";
import { subscribeLiveVoiceEvents } from "@/features/workspace/model/live-voice-events";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";
import { gptLiveCaption, gptLiveLevel, gptLiveTurn } from "../model/gpt-live-conversation";
import type { LiveConversationPhase } from "../model/live-conversation";
import type { LiveConversation } from "./use-live-conversation";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 460;
const CLOSE_MS = 400;
/** How often the loudness of the microphone or of the reply is read, for the level of the call bar. */
const METER_MS = 160;
/** The data channel that the realtime model sends its events on. */
const EVENTS_CHANNEL = "oai-events";

interface GptLiveConversationInput {
  /** The user chose GPT live voice, and the server, the app binary and the chat can run it. */
  active: boolean;
  /** The chat is in front and the user can write here. */
  enabled: boolean;
  /** The agent's server is connected. */
  online: boolean;
  focused: boolean;
  foreground: boolean;
  agentId: string;
  voice: CodexLiveVoice | null;
  startSession: (input: LiveVoiceStartRequest) => Promise<LiveVoiceSessionResponse>;
  stopSession: (sessionId: string) => Promise<void>;
  /** The server of the chat: a live voice event of another server is not for this conversation. */
  serverId: string;
}

interface GptLiveState {
  open: boolean;
  phase: LiveConversationPhase;
  muted: boolean;
  caption: string;
  error: string | null;
  exit: "cancel" | null;
  /** The call to OpenAI is up, so the microphone hears. */
  connected: boolean;
}

const CLOSED: GptLiveState = {
  open: false,
  phase: "starting",
  muted: false,
  caption: "",
  error: null,
  exit: null,
  connected: false,
};

/**
 * A voice conversation with an agent through GPT live voice, as Codex live voice on desktop. The
 * microphone and the reply go over WebRTC between the phone and OpenAI; the host opens the call with
 * the Codex sign-in of its computer, and gives each spoken request to the agent as the user's
 * message, so the chat shows the requests and the answers. It has the shape of the conversation that
 * recognizes speech on the phone, so the same call bar shows it. The speech module does not capture
 * or speak while it runs.
 */
export function useGptLiveConversation(input: GptLiveConversationInput): LiveConversation {
  const [state, setState] = useState(CLOSED);
  const inputRef = useRef(input);
  inputRef.current = input;
  const presence = useSharedValue(0);
  const level = useSharedValue(0);
  const [controller] = useState(() => createController({ input: () => inputRef.current, setState, presence, level }));

  useEffect(() => subscribeLiveVoiceEvents(controller.hostEvent), [controller]);

  useEffect(() => {
    controller.connection(input.online);
  }, [controller, input.online]);

  // As the phone conversation: a screen above the chat, or the app in the background, ends it. While
  // the call starts, Android reports the app as in the background for the microphone permission dialog.
  const starting = state.phase === "starting";
  useEffect(() => {
    if (state.open && (!input.focused || (!input.foreground && !starting))) controller.end();
  }, [controller, state.open, input.focused, input.foreground, starting]);

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
    open: state.open,
    phase: state.phase,
    muted: state.muted,
    caption: state.caption,
    error: state.error,
    exit: state.exit,
    speakerId: null,
    available: input.active && liveVoiceWebRtc !== null,
    micOpen: state.connected && state.phase === "listening",
    level,
    presence,
    start: controller.start,
    toggleMute: controller.toggleMute,
    interrupt: controller.interrupt,
    end: controller.end,
  };
}

function createController({
  input,
  setState,
  presence,
  level,
}: {
  input: () => GptLiveConversationInput;
  setState: (change: (current: GptLiveState) => GptLiveState) => void;
  presence: SharedValue<number>;
  level: SharedValue<number>;
}) {
  // The copies that the steps read: a state read shows a write only after the next render.
  let open = false;
  let exiting = false;
  let phase: LiveConversationPhase = "starting";
  let muted = false;
  /** The call failed or ended; an unmute starts a new one. */
  let failed = false;
  let heard = "";
  let said = "";
  /** Each call, and the end, make the work of the call before them stale. */
  let generation = 0;
  let sessionId: string | null = null;
  // Sessions that ended before the start returned their id: the end event can arrive first.
  let starting = false;
  const endedEarly = new Map<string, string | null>();
  let peer: RTCPeerConnection | null = null;
  let channel: ReturnType<RTCPeerConnection["createDataChannel"]> | null = null;
  let microphone: MediaStream | null = null;
  let reply: MediaStreamTrack | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  let callAudio = false;
  // Realtime v3 has no command that stops a reply: an interrupted reply plays on mute until its turn ends.
  let currentReply: string | null = null;
  let silencedTurn: string | null = null;
  let silenceNextReply = false;
  let startedAt = 0;
  let turns = 0;

  const update = (change: Partial<GptLiveState>) => setState((current) => ({ ...current, ...change }));
  const setPhase = (next: LiveConversationPhase) => {
    phase = next;
    update({ phase: next });
  };
  const showCaption = () => update({ caption: gptLiveCaption(phase === "speaking" ? said : heard) });

  function setReplyAudible(audible: boolean): void {
    if (reply) reply.enabled = audible;
  }

  /** The loudspeaker, with echo cancellation, for the call. Each call after the first changes nothing. */
  function routeCall(): void {
    callAudio = true;
    speechNative?.setCallAudio?.(true);
  }

  function startMeter(): void {
    stopMeter();
    meterTimer = setInterval(() => {
      const current = peer;
      if (!current) return;
      const speaking = phase === "speaking";
      if (!speaking && (muted || phase !== "listening")) {
        level.set(withTiming(0, { duration: METER_MS }));
        return;
      }
      current.getStats().then(
        (reports: Map<string, unknown>) => {
          if (peer === current) level.set(withTiming(gptLiveLevel(reports.values(), speaking), { duration: METER_MS }));
        },
        () => undefined,
      );
    }, METER_MS);
  }

  function stopMeter(): void {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = null;
    level.set(0);
  }

  /** Ends the call and frees the microphone. The session on the host ends with its own stop. */
  function release(): void {
    generation += 1;
    stopMeter();
    if (sessionId)
      void input()
        .stopSession(sessionId)
        .catch(() => undefined);
    sessionId = null;
    channel?.close();
    channel = null;
    peer?.close();
    peer = null;
    for (const track of microphone?.getTracks() ?? []) track.stop();
    microphone?.release();
    microphone = null;
    reply = null;
    if (callAudio) speechNative?.setCallAudio?.(false);
    callAudio = false;
    update({ connected: false });
  }

  function fail(message: string): void {
    failed = true;
    release();
    setPhase("listening");
    muted = true;
    update({ muted: true, error: message, caption: "" });
  }

  function failEnded(error: string | null): void {
    const text = currentText();
    fail(error ? text.sourceText(error) : text.t("mobile.chat.liveVoice.gptEnded"));
  }

  /** The realtime v3 turns give the phase: who speaks, and when the model thinks. */
  function modelEvent(data: unknown): void {
    const turn = gptLiveTurn(data);
    if (!turn || !open || exiting) return;
    if (turn.step === "user-started") {
      // The next reply answers this turn, so an interrupt of the reply before it does not silence it.
      silenceNextReply = false;
      if (silencedTurn === null) setReplyAudible(true);
      heard = "";
      setPhase("listening");
      showCaption();
    } else if (turn.step === "user-done") {
      turns += 1;
      if (phase !== "speaking") setPhase("thinking");
    } else if (turn.step === "reply-started") {
      currentReply = turn.id;
      routeCall();
      if (silenceNextReply) {
        silenceNextReply = false;
        silencedTurn = turn.id;
        return;
      }
      said = "";
      setPhase("speaking");
      showCaption();
    } else if (turn.step === "reply-done") {
      if (silencedTurn === turn.id) {
        silencedTurn = null;
        setReplyAudible(true);
        return;
      }
      if (phase === "speaking") {
        setPhase("listening");
        showCaption();
      }
    }
  }

  async function connect(): Promise<void> {
    const webRtc = liveVoiceWebRtc;
    if (!webRtc) return;
    release();
    const own = generation;
    failed = false;
    currentReply = null;
    silencedTurn = null;
    silenceNextReply = false;
    heard = "";
    said = "";
    setPhase("starting");
    update({ error: null, caption: "" });
    // A reply of the phone voice must not play over the call.
    speechNative?.stop();
    let stream: MediaStream;
    try {
      // The reply plays while the microphone listens. The native WebRTC audio has echo cancellation,
      // noise suppression and gain control on by default, and its constraints cannot set them.
      stream = await webRtc.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      if (own !== generation) return;
      const denied =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error.name === "SecurityError" || error.name === "NotAllowedError");
      mobileAnalytics.track("voice_conversation_action", {
        action: "start",
        server_kind: "remote",
        transcription: "cloud",
        result: "failed",
        failure_code: denied ? "permission_denied" : "operation_failed",
      });
      fail(currentText().t(denied ? "mobile.chat.liveVoice.gptMicrophoneOff" : "mobile.chat.liveVoice.gptFailed"));
      return;
    }
    if (own !== generation) {
      for (const track of stream.getTracks()) track.stop();
      stream.release();
      return;
    }
    microphone = stream;
    // The user can mute while the microphone opens.
    for (const track of stream.getAudioTracks()) track.enabled = !muted;
    try {
      const connection = new webRtc.RTCPeerConnection();
      peer = connection;
      for (const track of stream.getAudioTracks()) connection.addTrack(track, stream);
      connection.addEventListener("track", (event) => {
        if (peer !== connection || event.track?.kind !== "audio") return;
        reply = event.track;
        setReplyAudible(silencedTurn === null);
        routeCall();
      });
      connection.addEventListener("connectionstatechange", () => {
        if (peer !== connection || !open || exiting) return;
        if (connection.connectionState === "connected") routeCall();
        else if (connection.connectionState === "failed") failEnded(null);
      });
      const events = connection.createDataChannel(EVENTS_CHANNEL);
      channel = events;
      events.addEventListener("message", (event) => {
        if (peer === connection) modelEvent(event.data);
      });
      const offer = await connection.createOffer({});
      await connection.setLocalDescription(offer);
      const sdp = connection.localDescription?.sdp ?? offer.sdp;
      if (!sdp) throw new Error("No offer.");
      const { agentId, voice } = input();
      starting = true;
      endedEarly.clear();
      const session = await input()
        .startSession({ agentId, sdp, ...(isLiveVoiceName(voice) ? { voice } : {}) })
        .finally(() => {
          starting = false;
        });
      if (own !== generation) {
        void input()
          .stopSession(session.sessionId)
          .catch(() => undefined);
        return;
      }
      if (endedEarly.has(session.sessionId)) {
        const error = endedEarly.get(session.sessionId) ?? null;
        endedEarly.clear();
        failEnded(error);
        return;
      }
      endedEarly.clear();
      sessionId = session.sessionId;
      await connection.setRemoteDescription({ type: "answer", sdp: session.sdp });
      if (own !== generation) return;
      startMeter();
      routeCall();
      setPhase("listening");
      update({ connected: true });
      mobileAnalytics.track("voice_conversation_action", {
        action: "start",
        server_kind: "remote",
        transcription: "cloud",
        result: "succeeded",
      });
    } catch (error) {
      if (own !== generation) return;
      mobileAnalytics.track("voice_conversation_action", {
        action: "start",
        server_kind: "remote",
        transcription: "cloud",
        result: "failed",
        failure_code: "connection_failed",
      });
      const text = currentText();
      fail(text.errorMessage(error, text.t("mobile.chat.liveVoice.gptFailed")));
    }
  }

  function closed(): void {
    open = false;
    exiting = false;
    setState(() => CLOSED);
  }

  return {
    hostEvent(serverId: string, event: LiveVoiceEvent): void {
      if (!open || serverId !== input().serverId) return;
      if (event.sessionId !== sessionId) {
        if (event.kind === "ended" && starting) endedEarly.set(event.sessionId, event.error);
        return;
      }
      if (event.kind === "ended") {
        // The host ended the session: no stop goes back for it.
        sessionId = null;
        if (!exiting) failEnded(event.error);
        return;
      }
      if (event.role === "user") heard = event.final ? event.text : heard + event.text;
      else said = event.final ? event.text : said + event.text;
      if ((event.role === "user") === (phase !== "speaking")) showCaption();
    },
    /** No request reaches the host while the server is away, so the call stops until it is back. */
    connection(online: boolean): void {
      if (!open || exiting) return;
      if (!online && phase !== "offline") {
        release();
        setPhase("offline");
        update({ caption: "", error: currentText().t("mobile.chat.liveVoice.offline") });
      } else if (online && phase === "offline") {
        update({ error: null });
        if (muted) {
          failed = true;
          setPhase("listening");
        } else void connect();
      }
    },
    start(): void {
      const { active, enabled, online } = input();
      if (open || !active || !enabled || !liveVoiceWebRtc) return;
      open = true;
      exiting = false;
      muted = false;
      startedAt = performance.now();
      turns = 0;
      setState(() => ({ ...CLOSED, open: true }));
      void haptics.impact("light");
      presence.set(withTiming(1, { duration: OPEN_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
      if (online) void connect();
      else {
        setPhase("offline");
        update({ error: currentText().t("mobile.chat.liveVoice.offline") });
      }
    },
    /** The microphone stays open while it is muted, so an unmute does not start a new call. */
    toggleMute(): void {
      if (!open || exiting || phase === "offline") return;
      muted = !muted;
      for (const track of microphone?.getAudioTracks() ?? []) track.enabled = !muted;
      update({ muted });
      void haptics.selection();
      // A call that failed starts again on unmute.
      if (!muted && failed) void connect();
    },
    /** Silences the reply that plays now, or the next one. The model and the agent's turn go on. */
    interrupt(): void {
      if (!open || exiting || (phase !== "thinking" && phase !== "speaking")) return;
      void haptics.impact("light");
      if (phase === "speaking") silencedTurn = currentReply;
      else silenceNextReply = true;
      setReplyAudible(false);
      setPhase("listening");
      showCaption();
    },
    end(): void {
      if (!open || exiting) return;
      exiting = true;
      release();
      update({ exit: "cancel" });
      void haptics.selection();
      mobileAnalytics.track("voice_conversation_action", {
        action: "end",
        server_kind: "remote",
        transcription: "cloud",
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
      release();
      open = false;
    },
  };
}
