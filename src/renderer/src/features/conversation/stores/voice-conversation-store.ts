import { LOCAL_SERVER_ID, VOICE_AUDIO_LIMITS, VOICE_MODELS, VOICE_STREAM_LIMITS } from "@openbot/contracts/ipc";
import type { VoicePanelPhase } from "@openbot/ui/features/conversation/VoicePanel";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, onCleanup } from "solid-js";
import { desktopAnalytics } from "../../../analytics";
import { encodePcm16, recordingToSamples, recordingToWav } from "../../../voice-recording";
import { SPEECH_LEVEL_COUNT, speechReading } from "../../speech/speech-playback";
import { speechPort } from "../../speech/speech-port";
import {
  dropDictatedReply,
  forgetDictatedMessage,
  noteDictatedMessage,
  onDictatedReplyEnd,
} from "../../speech/speech-replies";
import { EMPTY_DRAFT } from "../composer-draft";
import type { ConversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationTarget } from "../conversation-types";
import { voiceCaptureError, voiceTranscriptionError } from "../voice-status";
import type { VoiceSend } from "./composer-actions";

/** How often the microphone loudness is read, for the face and to find the end of a turn. */
const LEVEL_INTERVAL_MS = 80;
/** The loudness, above the room noise, that counts as speech, and how long speech must last. */
const SPEECH_LOUDNESS = 0.3;
const SPEECH_START_MS = 240;
/**
 * While the reply plays, speech must be louder and longer to interrupt it, so that what is left of
 * the reply after echo cancellation does not.
 */
const REPLY_SPEECH_LOUDNESS = 0.5;
const REPLY_SPEECH_START_MS = 400;
/** A recording with no speech starts again after this long, at a pause, so it does not keep the silence. */
const SILENT_RECORDING_MS = 4_000;
const RESTART_QUIET_MS = 600;
/** The pause after speech that ends the turn. */
const TURN_END_SILENCE_MS = 1_200;
/** How often the words so far are transcribed again while the user speaks. */
const LIVE_TRANSCRIPT_INTERVAL_MS = 1_200;
/** The same loudness scale as the dictation waveform, in dB. */
const DIGITAL_SILENCE_DB = -90;
const NOISE_RISE_DB = 0.1;
const NOISE_MARGIN_DB = 6;
const PEAK_FALL_DB = 0.05;
const MIN_RANGE_DB = 12;
/** What the user said is kept as Opus: about 4 KB a second, an eighth of the WAV that is transcribed. */
const RECORDING_TYPE = "audio/webm;codecs=opus";
const RECORDING_BITS_PER_SECOND = 32_000;

/** A recorder that writes Opus, or the default format when this computer has no Opus encoder. */
function createRecorder(stream: MediaStream): MediaRecorder {
  return MediaRecorder.isTypeSupported(RECORDING_TYPE)
    ? new MediaRecorder(stream, { mimeType: RECORDING_TYPE, audioBitsPerSecond: RECORDING_BITS_PER_SECOND })
    : new MediaRecorder(stream);
}

function quietLevels(): number[] {
  return new Array(SPEECH_LEVEL_COUNT).fill(0);
}

type VoiceConversationStep = "starting" | "listening" | "transcribing" | "waiting";

interface VoiceConversationState {
  phase: VoiceConversationStep;
  /** The microphone stays off until the user unmutes it. */
  muted: boolean;
  /** The agent's server is not connected, so the pane does not listen. */
  offline: boolean;
  /** What the user said in this turn, so far. */
  heard: string;
  error: string | null;
  /** The latest loudness readings of the microphone, from 0 to 1, oldest first. */
  levels: number[];
}

export interface VoiceConversationDeps {
  agentId: string;
  serverId: string;
  voice: ConversationRuntime["voice"];
  submit: (
    draft: ComposerDraft,
    target: ConversationTarget,
    submittedSnapshot: ComposerDraft,
    voice: VoiceSend,
  ) => Promise<boolean>;
  /** The server of the agent is connected. The local server always is. */
  serverOnline: () => boolean;
}

/**
 * One turn of listening: the microphone, its recorder and the loudness meter. While the agent thinks
 * or speaks, the next turn already listens, so the user can interrupt it by voice.
 */
interface Turn {
  /** The generation of the turn. A resumed turn gets a new one. */
  own: number;
  stream: MediaStream;
  /** A recording with no speech is replaced by a new one, at a pause. */
  recorder: MediaRecorder;
  chunks: Blob[];
  context: AudioContext | undefined;
  timers: Array<ReturnType<typeof setInterval>>;
  /** When the recording started, on the `performance.now()` clock. */
  startedAt: number;
  /** The user spoke in this turn. */
  spoke: boolean;
  livePreview: Promise<void> | undefined;
}

/**
 * A conversation by voice with one agent. It listens until the user stops speaking, transcribes the
 * words, sends them to the chat, and waits while the reply is read aloud; then it listens again. It
 * ends with its owner, so the microphone is released when the pane closes.
 */
export function createVoiceConversation(deps: VoiceConversationDeps) {
  const target = { agentId: deps.agentId, serverId: deps.serverId };
  const [state, setState] = createStore<VoiceConversationState>({
    phase: "starting",
    muted: false,
    offline: false,
    heard: "",
    error: null,
    levels: quietLevels(),
  });
  /** Each new turn, interruption and the end make the work of the turn before them stale. */
  let generation = 0;
  let disposed = false;
  let turn: Turn | undefined;
  /** Both models are ready, so a turn can be transcribed and its reply read aloud. */
  let ready = false;
  let livePreview = false;
  let streamed = false;
  // The logic reads these copies: a store read shows a write only after the next flush.
  let step: VoiceConversationStep = "starting";
  let muted = false;
  let online = true;
  const startedAt = performance.now();
  /** The turns that were sent to the chat. */
  let sentTurns = 0;
  const serverKind = deps.serverId === LOCAL_SERVER_ID ? "local" : "remote";
  // True when the user's own voice server takes the dictation.
  let ownServer = false;
  const transcription = () => {
    if (ownServer) return "server";
    return streamed ? "cloud" : "local";
  };
  const elapsedMs = (since: number) => Math.max(0, Math.round(performance.now() - since));

  function setStep(next: VoiceConversationStep): void {
    step = next;
    setState((draft) => {
      draft.phase = next;
    });
  }

  function setMuted(next: boolean): void {
    muted = next;
    setState((draft) => {
      draft.muted = next;
    });
  }

  const stopReplyEnd = onDictatedReplyEnd((agent) => {
    if (agent.serverId === deps.serverId && agent.agentId === deps.agentId && step === "waiting") resumeListening();
  });

  /** No reply comes while the server is away, so the pane stops listening until it is back. */
  createEffect(deps.serverOnline, (next) => {
    if (next === online) return;
    online = next;
    if (!next) {
      generation += 1;
      releaseTurn();
      dropDictatedReply(target);
      setStep("listening");
      setState((draft) => {
        draft.offline = true;
        draft.heard = "";
        draft.levels = quietLevels();
        draft.error = currentText().t("conversation.voice.offline");
      });
      return;
    }
    setState((draft) => {
      draft.offline = false;
      draft.error = null;
    });
    if (ready && step === "listening") void listen();
  });

  async function start(): Promise<void> {
    const own = generation;
    const analytics = desktopAnalytics.scope();
    const startingAt = performance.now();
    try {
      const speech = speechPort().voice;
      const server = await speech.getServer();
      // The user's own server reads the replies, so the speech model is not necessary.
      if (!server?.routes.speech && (await speech.getSpeechModelStatus()).phase !== "ready") {
        const downloadAt = performance.now();
        const status = await speech.downloadSpeechModel().catch((error: unknown) => {
          analytics.track("speech_model_action", {
            action: "download",
            entry_point: "voice_conversation",
            result: "failed",
            duration_ms: elapsedMs(downloadAt),
            failure_code: "download_failed",
          });
          throw error;
        });
        analytics.track("speech_model_action", {
          action: "download",
          entry_point: "voice_conversation",
          result: status.phase === "ready" ? "succeeded" : "failed",
          duration_ms: elapsedMs(downloadAt),
          // A download that the settings cancelled ends as "missing".
          ...(status.phase === "ready"
            ? {}
            : { failure_code: status.phase === "missing" ? "cancelled" : "download_failed" }),
        });
        if (status.phase !== "ready") throw new Error(status.message ?? currentText().t("conversation.voice.error"));
      }
      const [settings, model] = await Promise.all([deps.voice.getSettings(), deps.voice.prepareModel()]);
      if (own !== generation || disposed) return;
      if (model.phase !== "ready")
        throw new Error(currentText().errorMessage(model.message, currentText().t("composer.voice.prepareFailed")));
      const selected = VOICE_MODELS.find((candidate) => candidate.id === settings.modelId);
      // The user's own server takes the whole recording once: it has no live preview or stream.
      ownServer = server?.routes.dictation === true;
      streamed = !ownServer && selected?.kind === "cloud";
      livePreview = !ownServer && !streamed && (selected?.livePreview ?? true);
      ready = true;
      analytics.track("voice_conversation_action", {
        action: "start",
        server_kind: serverKind,
        result: "succeeded",
        transcription: transcription(),
        duration_ms: elapsedMs(startingAt),
      });
      await listen();
    } catch (error) {
      if (own !== generation || disposed) return;
      analytics.track("voice_conversation_action", {
        action: "start",
        server_kind: serverKind,
        result: "failed",
        duration_ms: elapsedMs(startingAt),
        failure_code: "load_failed",
      });
      setStep("listening");
      setMuted(true);
      setState((draft) => {
        draft.error = currentText().errorMessage(error, currentText().t("conversation.voice.error"));
      });
    }
  }

  async function listen(): Promise<void> {
    releaseTurn();
    const own = ++generation;
    setStep("listening");
    setState((draft) => {
      draft.heard = "";
      draft.levels = quietLevels();
    });
    await openTurn(own);
  }

  /**
   * The turn that listened while the agent thought or spoke goes on as the next turn, with no gap.
   * Before the user speaks, its recording holds only the reply, so a new recording starts.
   * A new generation makes a late failure of the earlier send stale.
   */
  function resumeListening(): void {
    if (!turn) {
      void listen();
      return;
    }
    turn.own = ++generation;
    if (!turn.spoke) restartRecording(turn);
    setStep("listening");
    setState((draft) => {
      draft.heard = "";
    });
  }

  /** The user spoke over the agent: its reply stops, and what they say is the next turn. */
  function interruptByVoice(): void {
    desktopAnalytics.track("voice_conversation_action", {
      action: "interrupt",
      server_kind: serverKind,
      result: "succeeded",
      trigger: "voice",
    });
    // Before the drop, which can end the reply and start a new turn.
    resumeListening();
    dropDictatedReply(target);
  }

  /** Opens the microphone for the next turn. It listens now, or while the agent thinks and speaks. */
  async function openTurn(own: number): Promise<void> {
    if (muted || disposed || !online) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // The reply plays while the microphone listens: the echo canceller removes it.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      if (own !== generation || disposed) return;
      desktopAnalytics.track("voice_turn", {
        server_kind: serverKind,
        transcription: transcription(),
        result: "failed",
        audio_duration_seconds: 0,
        failure_code: "microphone_failed",
      });
      setMuted(true);
      setState((draft) => {
        draft.error = voiceCaptureError(error);
      });
      return;
    }
    if (own !== generation || disposed || muted || !online || turn) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const current: Turn = {
      own,
      stream,
      recorder: createRecorder(stream),
      chunks: [],
      context: undefined,
      timers: [],
      startedAt: performance.now(),
      spoke: false,
      livePreview: undefined,
    };
    turn = current;
    record(current, current.recorder);
    startMeter(current);
    if (livePreview)
      current.timers.push(
        setInterval(() => {
          if (current.spoke && !current.livePreview && current.recorder.state === "recording")
            current.livePreview = refreshHeard(current).finally(() => {
              current.livePreview = undefined;
            });
        }, LIVE_TRANSCRIPT_INTERVAL_MS),
      );
    // The check runs each second, and the recording can run a little longer than its check.
    current.timers.push(
      setInterval(() => {
        if (turn !== current || performance.now() - current.startedAt < (VOICE_AUDIO_LIMITS.maximumSeconds - 2) * 1_000)
          return;
        if (current.spoke) endTurn(current);
        else restartRecording(current);
      }, 1_000),
    );
  }

  /** Starts a recording of the turn. Its stop ends the turn, unless a new recording replaced it. */
  function record(current: Turn, recorder: MediaRecorder): void {
    const chunks: Blob[] = [];
    current.recorder = recorder;
    current.chunks = chunks;
    current.startedAt = performance.now();
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0 && turn === current && current.recorder === recorder) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      if (turn !== current || current.recorder !== recorder) return;
      // The microphone ended while the agent waits, as when a headset disconnects. The user did not
      // speak: the end of the reply opens a new turn.
      if (step === "waiting") releaseTurn();
      else void finishTurn(current, current.own);
    });
    recorder.start(LIVE_TRANSCRIPT_INTERVAL_MS);
  }

  /**
   * Replaces a recording that holds no speech, so the turn does not keep the silence, or the reply that
   * played while it listened. The microphone stays open.
   */
  function restartRecording(current: Turn): void {
    const previous = current.recorder;
    record(current, createRecorder(current.stream));
    if (previous.state !== "inactive") previous.stop();
  }

  /**
   * Reads the loudness above the room noise, as the dictation waveform does, and ends the turn at a
   * pause. While the agent thinks or speaks, speech interrupts it.
   */
  function startMeter(current: Turn): void {
    let analyser: AnalyserNode;
    try {
      current.context = new AudioContext();
      analyser = current.context.createAnalyser();
      analyser.fftSize = 512;
      current.context.createMediaStreamSource(current.stream).connect(analyser);
    } catch (error) {
      setState((draft) => {
        draft.error = voiceCaptureError(error);
      });
      return;
    }
    const samples = new Float32Array(analyser.fftSize);
    let noiseDb = Number.POSITIVE_INFINITY;
    let peakDb = Number.NEGATIVE_INFINITY;
    let shown = 0;
    let loudFor = 0;
    let quietFor = 0;
    // Below the speech level of a turn that listens. Soft words over the reply are not silence.
    let silentFor = 0;
    current.timers.push(
      setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const db = 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-5));
        if (db > DIGITAL_SILENCE_DB) {
          noiseDb = db < noiseDb ? db : Math.min(db, noiseDb + NOISE_RISE_DB);
          peakDb = Math.max(db, peakDb - PEAK_FALL_DB);
        }
        const range = Math.max(MIN_RANGE_DB, peakDb - noiseDb - NOISE_MARGIN_DB);
        const loudness = Math.min(1, Math.max(0, (db - noiseDb - NOISE_MARGIN_DB) / range));
        const level = loudness * loudness;
        shown += (level - shown) * (level > shown ? 0.7 : 0.45);
        const value = shown;
        // While the agent thinks or speaks, the pane shows its state, not the microphone.
        if (step === "listening")
          setState((draft) => {
            draft.levels = [...draft.levels.slice(1), value];
          });
        silentFor = loudness >= SPEECH_LOUDNESS ? 0 : silentFor + LEVEL_INTERVAL_MS;
        if (
          !current.spoke &&
          silentFor >= RESTART_QUIET_MS &&
          performance.now() - current.startedAt >= SILENT_RECORDING_MS
        )
          restartRecording(current);
        const replying = step === "waiting" && reading() !== null;
        if (loudness >= (replying ? REPLY_SPEECH_LOUDNESS : SPEECH_LOUDNESS)) {
          loudFor += LEVEL_INTERVAL_MS;
          quietFor = 0;
          if (loudFor >= (replying ? REPLY_SPEECH_START_MS : SPEECH_START_MS) && !current.spoke) {
            current.spoke = true;
            if (step === "waiting") interruptByVoice();
            setState((draft) => {
              draft.error = null;
            });
          }
        } else {
          loudFor = 0;
          quietFor += LEVEL_INTERVAL_MS;
          if (current.spoke && quietFor >= TURN_END_SILENCE_MS) endTurn(current);
        }
      }, LEVEL_INTERVAL_MS),
    );
  }

  /** Shows the words so far. A failure says nothing that the final pass does not say better. */
  async function refreshHeard(current: Turn): Promise<void> {
    try {
      const audio = await recordingToWav(new Blob(current.chunks, { type: current.recorder.mimeType }));
      const result = await deps.voice.transcribe({ audio });
      if (turn === current && current.recorder.state === "recording")
        setState((draft) => {
          draft.heard = result.text.trim();
        });
    } catch {
      // The final transcription reports its own error.
    }
  }

  function endTurn(current: Turn): void {
    if (current.recorder.state !== "recording") return;
    stopCapture(current);
    setStep("transcribing");
    setState((draft) => {
      draft.levels = quietLevels();
    });
    current.recorder.stop();
  }

  async function finishTurn(current: Turn, own: number): Promise<void> {
    turn = undefined;
    const mimeType = current.recorder.mimeType;
    const analytics = desktopAnalytics.scope();
    const turnProperties = {
      server_kind: serverKind,
      transcription: transcription(),
      audio_duration_seconds: Math.round(performance.now() - current.startedAt) / 1_000,
    } as const;
    const transcribingAt = performance.now();
    let text: string;
    let recording: Blob;
    try {
      // The voice host takes one request at a time.
      await current.livePreview;
      if (current.chunks.length === 0) throw new Error(currentText().t("composer.voice.noSpeechRecorded"));
      recording = new Blob(current.chunks, { type: mimeType });
      text = (
        streamed
          ? await transcribeStreamed(recording)
          : await deps.voice.transcribe({ audio: await recordingToWav(recording) })
      ).text.trim();
    } catch (error) {
      if (own !== generation || disposed) return;
      analytics.track("voice_turn", {
        ...turnProperties,
        result: "failed",
        duration_ms: elapsedMs(transcribingAt),
        failure_code: "transcription_failed",
      });
      await listen();
      setState((draft) => {
        draft.error = voiceTranscriptionError(error);
      });
      return;
    }
    if (own !== generation || disposed) return;
    const transcribedMs = elapsedMs(transcribingAt);
    if (!text) {
      analytics.track("voice_turn", {
        ...turnProperties,
        result: "failed",
        duration_ms: transcribedMs,
        failure_code: "no_speech",
      });
      await listen();
      return;
    }
    setStep("waiting");
    setState((draft) => {
      draft.heard = text;
      draft.error = null;
    });
    const recordingId = await keepRecording(recording);
    if (own !== generation || disposed) {
      discardRecording(recordingId);
      return;
    }
    noteDictatedMessage(target, text, { always: true });
    // A send can fail after it is queued, so the wait for the reply ends there too.
    // A later failure, after a Retry, belongs to a turn that is over.
    const notSent = () => {
      if (disposed || own !== generation || step !== "waiting") return;
      forgetDictatedMessage(target);
      void listen();
      setState((draft) => {
        draft.heard = text;
        draft.error = currentText().t("conversation.voice.notSent");
      });
    };
    const delivered = await deps.submit({ ...EMPTY_DRAFT, text }, target, EMPTY_DRAFT, {
      recordingDraftId: recordingId,
      onFailed: notSent,
    });
    analytics.track("voice_turn", {
      ...turnProperties,
      result: delivered ? "succeeded" : "failed",
      duration_ms: transcribedMs,
      recording_kept: recordingId !== undefined,
      ...(delivered ? {} : { failure_code: "send_failed" }),
    });
    if (delivered) {
      sentTurns += 1;
      // The next turn listens while the agent thinks and speaks, so the user can interrupt it.
      if (step === "waiting") await openTurn(own);
      return;
    }
    discardRecording(recordingId);
    notSent();
  }

  /**
   * Keeps what the user said, so the chat can play it again. The text goes without it when this
   * computer cannot keep it: the turn matters more than its replay. Only the local server stores it;
   * the Team API sends text only.
   */
  async function keepRecording(recording: Blob): Promise<string | undefined> {
    if (deps.serverId !== LOCAL_SERVER_ID || !recording.type.startsWith("audio/webm")) return undefined;
    if (recording.size > VOICE_AUDIO_LIMITS.maximumRecordingBytes) return undefined;
    try {
      return (await speechPort().voice.keepRecording({ audio: new Uint8Array(await recording.arrayBuffer()) })).id;
    } catch {
      return undefined;
    }
  }

  /** The recording is a draft of this computer, whichever server the message was for. */
  function discardRecording(id: string | undefined): void {
    if (id)
      void speechPort()
        .agent.discardDraftAttachment(id, LOCAL_SERVER_ID)
        .catch(() => {});
  }

  /** A cloud model hears through a stream: the whole recording is sent, then the stream ends. */
  async function transcribeStreamed(recording: Blob): Promise<{ text: string }> {
    const pcm = encodePcm16(await recordingToSamples(recording));
    const { streamId } = await deps.voice.startStream();
    try {
      for (let offset = 0; offset < pcm.byteLength; offset += VOICE_STREAM_LIMITS.maximumChunkBytes)
        await deps.voice.appendStream({
          streamId,
          pcm: pcm.slice(offset, offset + VOICE_STREAM_LIMITS.maximumChunkBytes),
        });
    } catch (error) {
      void deps.voice.cancelStream({ streamId }).catch(() => {});
      throw error;
    }
    return deps.voice.finishStream({ streamId });
  }

  function stopCapture(current: Turn): void {
    for (const timer of current.timers) clearInterval(timer);
    current.timers = [];
    void current.context?.close();
    current.context = undefined;
    for (const track of current.stream.getTracks()) track.stop();
  }

  /** Discards the turn that listens now: nothing is transcribed. */
  function releaseTurn(): void {
    const current = turn;
    if (!current) return;
    turn = undefined;
    stopCapture(current);
    if (current.recorder.state !== "inactive") current.recorder.stop();
  }

  function toggleMute(): void {
    setMuted(!muted);
    desktopAnalytics.track("voice_conversation_action", {
      action: muted ? "mute" : "unmute",
      server_kind: serverKind,
      result: "succeeded",
    });
    if (!muted)
      setState((draft) => {
        draft.error = null;
      });
    // A start that failed starts again.
    if (!muted && !ready) {
      setStep("starting");
      void start();
      return;
    }
    if (step === "waiting") {
      // The turn that waits for the reply listens only while the microphone is on.
      if (muted) releaseTurn();
      else void openTurn(generation);
      return;
    }
    if (step !== "listening") return;
    if (muted) {
      generation += 1;
      releaseTurn();
      setState((draft) => {
        draft.heard = "";
        draft.levels = quietLevels();
      });
    } else void listen();
  }

  /** Stops the reply, or the wait for it, and listens again. The agent's turn goes on. */
  function interrupt(): void {
    if (step !== "waiting" && step !== "transcribing") return;
    desktopAnalytics.track("voice_conversation_action", {
      action: "interrupt",
      server_kind: serverKind,
      result: "succeeded",
      trigger: "button",
    });
    // Before the drop, which can end the reply and start a new turn.
    if (step === "waiting") resumeListening();
    else void listen();
    dropDictatedReply(target);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    desktopAnalytics.track("voice_conversation_action", {
      action: "end",
      server_kind: serverKind,
      result: "succeeded",
      ...(ready ? { transcription: transcription() } : {}),
      duration_ms: elapsedMs(startedAt),
      turn_count: sentTurns,
    });
    generation += 1;
    stopReplyEnd();
    releaseTurn();
    dropDictatedReply(target);
  }
  onCleanup(dispose);

  /** What the pane shows: the reply speaks while its words play, and the agent thinks until then. */
  const reading = () => {
    const current = speechReading();
    return current?.serverId === deps.serverId && current.agentId === deps.agentId ? current : null;
  };
  function phase(): VoicePanelPhase {
    if (state.offline) return "offline";
    if (state.phase === "starting" || state.phase === "listening") return state.phase;
    if (state.phase === "waiting" && reading()) return "speaking";
    return "thinking";
  }

  void start();

  return {
    phase,
    muted: () => state.muted,
    heard: () => state.heard,
    error: () => state.error,
    said: () => reading()?.part ?? "",
    levels: () => (phase() === "speaking" ? (reading()?.levels ?? state.levels) : state.levels),
    toggleMute,
    interrupt,
  };
}
