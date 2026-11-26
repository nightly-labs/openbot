import type { OpenBotDesktopApi, VoiceLiveEvent } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { VoicePhase, VoiceTalkMode } from "@openbot/ui/features/conversation/VoicePill";
import { currentText } from "@openbot/ui/text";
import { createStore, onCleanup } from "solid-js";
import { SPEECH_LEVEL_COUNT } from "../../speech/speech-playback";
import { voiceCaptureError } from "../voice-status";

const LEVEL_INTERVAL_MS = 80;
const LEVEL_FLOOR_DB = -60;
const LEVEL_RANGE_DB = 50;
const EVENTS_CHANNEL = "oai-events";

export type CodexLivePort = Pick<OpenBotDesktopApi["voice"], "startLive" | "stopLive" | "onLiveEvent">;

function codexLivePort(): CodexLivePort {
  return window.openbot.voice;
}

type LiveStep = "starting" | "listening" | "thinking" | "speaking";

interface LiveState {
  step: LiveStep;
  muted: boolean;
  talking: boolean;
  error: string | null;
  levels: number[];
}

function quietLevels(): number[] {
  return new Array(SPEECH_LEVEL_COUNT).fill(0);
}

function loudness(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
  return Math.min(1, Math.max(0, (db - LEVEL_FLOOR_DB) / LEVEL_RANGE_DB));
}

export function createCodexLiveConversation(deps: { agentId: string; serverId: string; port?: CodexLivePort }) {
  const port = deps.port ?? codexLivePort();
  const [state, setState] = createStore<LiveState>({
    step: "starting",
    muted: false,
    talking: false,
    error: null,
    levels: quietLevels(),
  });
  let disposed = false;
  let failed = false;
  let sessionId: string | null = null;
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
  let step: LiveStep = "starting";
  let muted = false;
  let pushToTalk = false;
  let talking = false;
  let currentReply: unknown = null;
  let silencedTurn: unknown = null;
  let silenceNextReply = false;
  let holding = false;

  function setStep(next: LiveStep): void {
    step = next;
    setState((draft) => {
      draft.step = next;
    });
  }

  const endedToastId = `codex-live-ended-${deps.serverId}-${deps.agentId}`;

  function fail(message: string | null): void {
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
    fail(null);
    toast.error(
      error ? errorMessage(new Error(error), t("error.voice.live.disconnected")) : t("error.voice.live.disconnected"),
      { id: endedToastId },
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
    }
  });

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
      silenceNextReply = false;
      holding = false;
      if (silencedTurn === null) reply.muted = false;
      setStep("listening");
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
      const analyser = step === "speaking" && !holding ? replyMeter : microphoneMeter;
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
    holding = false;
    reply.muted = false;
    try {
      microphone = await navigator.mediaDevices.getUserMedia({
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

  function toggleMute(): void {
    applyMute(!muted);
  }

  function setTalkMode(mode: VoiceTalkMode): void {
    const push = mode === "push";
    if (push === pushToTalk) return;
    pushToTalk = push;
    setTalking(false);
    endHold(false);
    if (push !== muted) applyMute(push);
  }

  function startTalking(): void {
    if (!pushToTalk || talking) return;
    setTalking(true);
    holdReply();
    if (muted) applyMute(false);
  }

  function stopTalking(): void {
    if (!pushToTalk || !talking) return;
    setTalking(false);
    endHold(true);
    if (!muted) applyMute(true);
  }

  function cancelTalking(): void {
    if (!pushToTalk || !talking) return;
    setTalking(false);
    endHold(false);
    if (!muted) applyMute(true);
  }

  function holdReply(): void {
    if (step !== "speaking" && step !== "thinking") return;
    holding = true;
    reply.muted = true;
  }

  function endHold(stopReply: boolean): void {
    if (!holding) return;
    holding = false;
    if (stopReply) interrupt();
    if (silencedTurn === null && !silenceNextReply) reply.muted = false;
  }

  function setTalking(next: boolean): void {
    talking = next;
    setState((draft) => {
      draft.talking = next;
    });
  }

  function applyMute(next: boolean): void {
    muted = next;
    for (const track of microphone?.getAudioTracks() ?? []) track.enabled = !muted;
    setState((draft) => {
      draft.muted = muted;
    });
    if (!muted && failed && !disposed) {
      failed = false;
      toast.dismiss(endedToastId);
      setState((draft) => {
        draft.error = null;
      });
      setStep("starting");
      void start();
    }
  }

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

  const phase = (): VoicePhase => state.step;
  return {
    phase,
    muted: () => state.muted,
    talking: () => state.talking,
    error: () => state.error,
    downloadProgress: () => null,
    levels: () => state.levels,
    toggleMute,
    setTalkMode,
    startTalking,
    stopTalking,
    cancelTalking,
    interrupt,
  };
}
