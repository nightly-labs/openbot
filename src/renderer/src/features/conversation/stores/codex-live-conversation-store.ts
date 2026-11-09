import type { OpenBotDesktopApi, VoiceLiveEvent } from "@openbot/contracts/ipc";
import type { VoicePanelPhase } from "@openbot/ui/features/conversation/VoicePanel";
import { currentText } from "@openbot/ui/text";
import { createStore, onCleanup } from "solid-js";
import { SPEECH_LEVEL_COUNT } from "../../speech/speech-playback";
import { voiceCaptureError } from "../voice-status";

/** How often the loudness of the microphone and of the reply is read, for the face. */
const LEVEL_INTERVAL_MS = 80;
/** The loudness range of the face, in dB: below the floor is silence, at the top is full. */
const LEVEL_FLOOR_DB = -60;
const LEVEL_RANGE_DB = 50;
/** The data channel that the realtime model sends its events on, and takes commands from. */
const EVENTS_CHANNEL = "oai-events";

export type CodexLivePort = Pick<OpenBotDesktopApi["voice"], "startLive" | "stopLive" | "onLiveEvent">;

/** Read on each call: tests and stories replace `window.openbot` per case. */
function codexLivePort(): CodexLivePort {
  return window.openbot.voice;
}

type LiveStep = "starting" | "listening" | "thinking" | "speaking";

interface LiveState {
  step: LiveStep;
  muted: boolean;
  heard: string;
  said: string;
  error: string | null;
  levels: number[];
}

function quietLevels(): number[] {
  return new Array(SPEECH_LEVEL_COUNT).fill(0);
}

/** The loudness of one reading, from 0 to 1. */
function loudness(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
  return Math.min(1, Math.max(0, (db - LEVEL_FLOOR_DB) / LEVEL_RANGE_DB));
}

/**
 * A voice conversation with a Codex agent through Codex live voice. The microphone and the reply go
 * over WebRTC between this window and OpenAI; the Codex App Server of the agent's server opens the
 * call with that server's Codex sign-in and runs the agent's turns in its chat. It has the same shape as the conversation
 * that transcribes on this computer, so the same pane shows it. It ends with its owner.
 */
export function createCodexLiveConversation(deps: { agentId: string; serverId: string; port?: CodexLivePort }) {
  const port = deps.port ?? codexLivePort();
  const [state, setState] = createStore<LiveState>({
    step: "starting",
    muted: false,
    heard: "",
    said: "",
    error: null,
    levels: quietLevels(),
  });
  let disposed = false;
  let failed = false;
  let sessionId: string | null = null;
  // Sessions that ended before `startLive` returned their id: the end event can arrive first.
  let starting = false;
  const endedEarly = new Map<string, string | null>();
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  let microphone: MediaStream | undefined;
  let context: AudioContext | undefined;
  let microphoneMeter: AnalyserNode | undefined;
  let replyMeter: AnalyserNode | undefined;
  let meterTimer: ReturnType<typeof setInterval> | undefined;
  const reply = new Audio();
  reply.autoplay = true;
  // The copies that the logic reads: a store read shows a write only after the next flush.
  let step: LiveStep = "starting";
  let muted = false;
  // Realtime v3 has no command that stops a reply: an interrupted reply plays on mute until its turn ends.
  let currentReply: unknown = null;
  let silencedTurn: unknown = null;
  let silenceNextReply = false;

  function setStep(next: LiveStep): void {
    step = next;
    setState((draft) => {
      draft.step = next;
    });
  }

  function fail(message: string): void {
    failed = true;
    release();
    setStep("listening");
    muted = true;
    setState((draft) => {
      draft.muted = true;
      draft.error = message;
      draft.levels = quietLevels();
    });
  }

  function failEnded(error: string | null): void {
    const { t, errorMessage } = currentText();
    fail(
      error ? errorMessage(new Error(error), t("error.voice.live.disconnected")) : t("error.voice.live.disconnected"),
    );
  }

  const stopEvents = port.onLiveEvent((event: VoiceLiveEvent) => {
    if (disposed) return;
    if (event.sessionId !== sessionId) {
      if (event.type === "ended" && starting) endedEarly.set(event.sessionId, event.error);
      return;
    }
    if (event.type === "ended") {
      sessionId = null;
      failEnded(event.error);
      return;
    }
    setState((draft) => {
      if (event.role === "user") draft.heard = event.final ? event.text : draft.heard + event.text;
      else draft.said = event.final ? event.text : draft.said + event.text;
    });
  });

  /** The realtime v3 turns give the phase: who speaks, and when the model thinks. */
  function onModelEvent(data: unknown): void {
    if (typeof data !== "string") return;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null || !("type" in event) || !("turn" in event)) return;
    const turn = event.turn;
    if (typeof turn !== "object" || turn === null || !("id" in turn) || !("role" in turn)) return;
    if (event.type === "turn.created" && turn.role === "user") {
      // The next reply answers this turn, so an interrupt of the reply before it does not silence it.
      silenceNextReply = false;
      if (silencedTurn === null) reply.muted = false;
      setStep("listening");
      setState((draft) => {
        draft.heard = "";
      });
    } else if (event.type === "turn.done" && turn.role === "user") {
      if (step !== "speaking") setStep("thinking");
    } else if (event.type === "turn.created" && turn.role === "assistant") {
      currentReply = turn.id;
      if (silenceNextReply) {
        silenceNextReply = false;
        silencedTurn = turn.id;
        return;
      }
      setStep("speaking");
      setState((draft) => {
        draft.said = "";
      });
    } else if (event.type === "turn.done" && turn.role === "assistant") {
      if (silencedTurn === turn.id) {
        silencedTurn = null;
        reply.muted = false;
        return;
      }
      if (step === "speaking") setStep("listening");
    }
  }

  function startMeter(): void {
    const samples = new Float32Array(512);
    meterTimer = setInterval(() => {
      const analyser = step === "speaking" ? replyMeter : microphoneMeter;
      const level = analyser && !(step !== "speaking" && muted) ? loudness(analyser, samples) : 0;
      setState((draft) => {
        draft.levels = [...draft.levels.slice(1), level];
      });
    }, LEVEL_INTERVAL_MS);
  }

  function meter(stream: MediaStream): AnalyserNode | undefined {
    if (!context) return undefined;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  async function start(): Promise<void> {
    failed = false;
    currentReply = null;
    silencedTurn = null;
    silenceNextReply = false;
    reply.muted = false;
    try {
      microphone = await navigator.mediaDevices.getUserMedia({
        // The reply plays while the microphone listens: the echo canceller removes it.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      if (!disposed) fail(voiceCaptureError(error));
      return;
    }
    if (disposed) {
      release();
      return;
    }
    // The user can mute while the microphone opens.
    for (const track of microphone.getAudioTracks()) track.enabled = !muted;
    try {
      context = new AudioContext();
      microphoneMeter = meter(microphone);
      peer = new RTCPeerConnection();
      for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);
      peer.addEventListener("track", (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        reply.srcObject = stream;
        replyMeter = meter(stream);
      });
      channel = peer.createDataChannel(EVENTS_CHANNEL);
      channel.addEventListener("message", (event) => onModelEvent(event.data));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error(currentText().t("conversation.voice.error"));
      starting = true;
      endedEarly.clear();
      const session = await port.startLive({ agentId: deps.agentId, sdp: offer.sdp }, deps.serverId).finally(() => {
        starting = false;
      });
      if (disposed) {
        void port.stopLive({ sessionId: session.sessionId }).catch(() => undefined);
        return;
      }
      if (endedEarly.has(session.sessionId)) {
        failEnded(endedEarly.get(session.sessionId) ?? null);
        endedEarly.clear();
        return;
      }
      endedEarly.clear();
      sessionId = session.sessionId;
      await peer.setRemoteDescription({ type: "answer", sdp: session.sdp });
      startMeter();
      setStep("listening");
    } catch (error) {
      if (disposed) return;
      const { t, errorMessage } = currentText();
      fail(errorMessage(error, t("conversation.voice.error")));
    }
  }

  /** Ends the call and frees the microphone. The session in main ends with its own stop. */
  function release(): void {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = undefined;
    if (sessionId) void port.stopLive({ sessionId }).catch(() => undefined);
    sessionId = null;
    channel?.close();
    channel = undefined;
    peer?.close();
    peer = undefined;
    for (const track of microphone?.getTracks() ?? []) track.stop();
    microphone = undefined;
    microphoneMeter = undefined;
    replyMeter = undefined;
    void context?.close().catch(() => undefined);
    context = undefined;
    reply.srcObject = null;
  }

  /** The microphone stays open while it is muted, so unmuting does not start a new call. */
  function toggleMute(): void {
    muted = !muted;
    for (const track of microphone?.getAudioTracks() ?? []) track.enabled = !muted;
    setState((draft) => {
      draft.muted = muted;
    });
    // A call that failed starts again on unmute. A call that still starts keeps its start.
    if (!muted && failed && !disposed) {
      failed = false;
      setState((draft) => {
        draft.error = null;
      });
      setStep("starting");
      void start();
    }
  }

  /** Silences the reply that plays now, or the next one. The model and the agent's turn in the chat go on. */
  function interrupt(): void {
    if (step !== "speaking" && step !== "thinking") return;
    if (step === "speaking") silencedTurn = currentReply;
    else silenceNextReply = true;
    reply.muted = true;
    setStep("listening");
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopEvents();
    release();
  }
  onCleanup(dispose);

  void start();

  const phase = (): VoicePanelPhase => state.step;
  return {
    phase,
    muted: () => state.muted,
    heard: () => state.heard,
    error: () => state.error,
    said: () => state.said,
    levels: () => state.levels,
    toggleMute,
    interrupt,
  };
}
