import {
  type ConversationMessage,
  DEFAULT_SPEECH_SETTINGS,
  LOCAL_SERVER_ID,
  SPEECH_MODEL,
  type SpeechModelStatus,
  VOICE_AUDIO_LIMITS,
  VOICE_MODELS,
  VOICE_STREAM_LIMITS,
  type VoiceModelId,
  type VoiceModelStatus,
} from "@openbot/contracts/ipc";
import type { VoicePhase, VoiceTalkMode } from "@openbot/ui/features/conversation/VoicePill";
import { currentText } from "@openbot/ui/text";
import { encodePcm16, recordingToSamples, recordingToWav } from "@openbot/ui/voice-recording";
import { createEffect, createStore, onCleanup } from "solid-js";
import { desktopAnalytics } from "../../../analytics";
import { holdSpeech, releaseSpeech, SPEECH_LEVEL_COUNT, speechReading } from "../../speech/speech-playback";
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

const LEVEL_INTERVAL_MS = 80;
const SPEECH_LOUDNESS = 0.3;
const SPEECH_START_MS = 240;
const REPLY_SPEECH_LOUDNESS = 0.5;
const REPLY_SPEECH_START_MS = 400;
const HOLD_WORDS_MS = 2_000;
const WORD = /[\p{L}\p{N}]/u;
const SILENT_RECORDING_MS = 4_000;
const TURN_MAXIMUM_SECONDS = 120;
const RESTART_QUIET_MS = 600;
const PUSH_TO_TALK_MIN_MS = 300;
const LIVE_TRANSCRIPT_INTERVAL_MS = 1_200;
const DIGITAL_SILENCE_DB = -90;
const NOISE_RISE_DB = 0.1;
const NOISE_MARGIN_DB = 6;
const PEAK_FALL_DB = 0.05;
const MIN_RANGE_DB = 12;
const RECORDING_TYPE = "audio/webm;codecs=opus";
const RECORDING_BITS_PER_SECOND = 32_000;

function createRecorder(stream: MediaStream): MediaRecorder {
  return MediaRecorder.isTypeSupported(RECORDING_TYPE)
    ? new MediaRecorder(stream, { mimeType: RECORDING_TYPE, audioBitsPerSecond: RECORDING_BITS_PER_SECOND })
    : new MediaRecorder(stream);
}

function currentRecording(turn: Recording): Recording {
  return { recorder: turn.recorder, chunks: turn.chunks, startedAt: turn.startedAt, livePreview: turn.livePreview };
}

function quietLevels(): number[] {
  return new Array(SPEECH_LEVEL_COUNT).fill(0);
}

type VoiceConversationStep = "starting" | "listening" | "transcribing" | "waiting";

interface VoiceConversationState {
  phase: VoiceConversationStep;
  muted: boolean;
  talking: boolean;
  offline: boolean;
  heard: string;
  error: string | null;
  levels: number[];
  downloadProgress: number | null;
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
  serverOnline: () => boolean;
  progressUpdate: (message: ConversationMessage) => boolean;
}

interface Recording {
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  livePreview: Promise<void> | undefined;
}

interface Turn extends Recording {
  own: number;
  stream: MediaStream;
  context: AudioContext | undefined;
  timers: Array<ReturnType<typeof setInterval>>;
  spoke: boolean;
  roomNoise: boolean;
}

export function createVoiceConversation(deps: VoiceConversationDeps) {
  const target = { agentId: deps.agentId, serverId: deps.serverId };
  const [state, setState] = createStore<VoiceConversationState>({
    phase: "starting",
    muted: false,
    talking: false,
    offline: false,
    heard: "",
    error: null,
    levels: quietLevels(),
    downloadProgress: null,
  });
  let generation = 0;
  let disposed = false;
  let turn: Turn | undefined;
  let ready = false;
  let loading = false;
  let pushToTalk = false;
  let talking = false;
  let talkingAt = 0;
  let releaseWhenListening = false;
  let livePreview = false;
  let streamed = false;
  let cloud = false;
  let turnEndSilenceMs: number = DEFAULT_SPEECH_SETTINGS.turnPauseMs;
  let step: VoiceConversationStep = "starting";
  let muted = false;
  let online = true;
  let held = false;
  let heldAt: number | undefined;
  let heldReplyEnded = false;
  let sentHeard = "";
  let waitingSend = 0;
  let sending = 0;
  const startedAt = performance.now();
  let sentTurns = 0;
  const serverKind = deps.serverId === LOCAL_SERVER_ID ? "local" : "remote";
  let ownServer = false;
  const downloadListeners: Array<() => void> = [];
  const downloads: Array<{ modelId: string; bytes: number; share: number }> = [];
  const transcription = () => {
    if (ownServer) return "server";
    return cloud ? "cloud" : "local";
  };
  const elapsedMs = (since: number) => Math.max(0, Math.round(performance.now() - since));

  function setStep(next: VoiceConversationStep): void {
    step = next;
    if (next === "listening" && releaseWhenListening) {
      releaseWhenListening = false;
      queueMicrotask(() => {
        if (!talking && pushToTalk && !disposed) releaseTalk();
      });
    }
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

  function setTalking(next: boolean): void {
    talking = next;
    setState((draft) => {
      draft.talking = next;
    });
  }

  const stopReplyEnd = onDictatedReplyEnd((agent) => {
    if (agent.serverId !== deps.serverId || agent.agentId !== deps.agentId) return;
    if (held) heldReplyEnded = true;
    else if (step === "waiting") resumeListening();
  });

  createEffect(deps.serverOnline, (next) => {
    if (next === online) return;
    online = next;
    if (!next) {
      generation += 1;
      releaseTurn();
      dropReply();
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

  function showDownload(status: VoiceModelStatus | SpeechModelStatus): void {
    const index = downloads.findIndex((download) => download.modelId === status.modelId);
    if (index < 0 || status.phase !== "downloading" || disposed) return;
    downloads.forEach((download, position) => {
      if (position < index) download.share = 1;
    });
    const current = downloads[index];
    if (current) current.share = (status.progress ?? 0) / 100;
    const total = downloads.reduce((sum, download) => sum + download.bytes, 0);
    const received = downloads.reduce((sum, download) => sum + download.share * download.bytes, 0);
    setState((draft) => {
      draft.downloadProgress = Math.min(100, Math.floor((received / total) * 100));
    });
  }

  function planDownloads(
    speechModel: SpeechModelStatus | null,
    dictationModelId: VoiceModelId | null,
    dictationStatuses: VoiceModelStatus[] | null,
  ): void {
    downloads.length = 0;
    if (speechModel?.modelId === SPEECH_MODEL.id && speechModel.phase !== "ready")
      downloads.push({ modelId: speechModel.modelId, bytes: SPEECH_MODEL.bytes, share: 0 });
    const dictation = VOICE_MODELS.find((candidate) => candidate.id === dictationModelId);
    const dictationStatus = dictationStatuses?.find((status) => status.modelId === dictationModelId);
    if (dictation?.kind === "local" && dictationStatus && dictationStatus.phase !== "ready")
      downloads.push({ modelId: dictation.id, bytes: dictation.bytes, share: 0 });
  }

  function removeDownloadListeners(): void {
    for (const stop of downloadListeners.splice(0)) stop();
  }

  function stopDownloadProgress(): void {
    removeDownloadListeners();
    setState((draft) => {
      draft.downloadProgress = null;
    });
  }

  async function start(): Promise<void> {
    const own = generation;
    const analytics = desktopAnalytics.scope();
    const startingAt = performance.now();
    loading = true;
    try {
      const speech = speechPort().voice;
      downloadListeners.push(speech.onSpeechModelStatus(showDownload), deps.voice.onModelStatus(showDownload));
      const [server, turnPauseMs, plannedSettings, dictationStatuses] = await Promise.all([
        speech.getServer(),
        speech.getSpeechSettings().then(
          (speechSettings) => speechSettings.turnPauseMs,
          () => DEFAULT_SPEECH_SETTINGS.turnPauseMs,
        ),
        deps.voice.getSettings(),
        speech.getModelStatuses().catch(() => null),
      ]);
      turnEndSilenceMs = turnPauseMs;
      const speechModel = server?.routes.speech ? null : await speech.getSpeechModelStatus();
      planDownloads(speechModel, server?.routes.dictation ? null : plannedSettings.modelId, dictationStatuses);
      if (speechModel && speechModel.phase !== "ready") {
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
      ownServer = server?.routes.dictation === true;
      cloud = !ownServer && selected?.kind === "cloud";
      streamed = selected?.kind === "cloud" && selected.provider === "elevenlabs" && !ownServer;
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
    } finally {
      loading = false;
      stopDownloadProgress();
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

  function dropReply(): void {
    held = false;
    dropDictatedReply(target);
  }

  function holdReply(): void {
    held = true;
    heldAt = performance.now();
    heldReplyEnded = false;
    holdSpeech(target);
    resumeListening();
  }

  function interruptByVoice(): void {
    if (!heldReplyEnded)
      desktopAnalytics.track("voice_conversation_action", {
        action: "interrupt",
        server_kind: serverKind,
        result: "succeeded",
        trigger: "voice",
      });
    dropReply();
  }

  async function resumeReply(): Promise<void> {
    held = false;
    releaseSpeech(target, true);
    if (heldReplyEnded) {
      resumeListening();
      return;
    }
    setStep("waiting");
    setState((draft) => {
      draft.heard = sentHeard;
      draft.levels = quietLevels();
    });
    await listenWhileWaiting(generation);
  }

  async function listenWhileWaiting(own: number): Promise<void> {
    if (turn?.spoke) holdReply();
    else if (!turn) await openTurn(own);
  }

  async function openTurn(own: number): Promise<void> {
    if (muted || disposed || !online) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
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
      roomNoise: false,
      livePreview: undefined,
    };
    turn = current;
    record(current, current.recorder);
    startMeter(current);
    if (livePreview)
      current.timers.push(
        setInterval(() => {
          if (step === "listening" && current.spoke && !current.livePreview && current.recorder.state === "recording")
            current.livePreview = refreshHeard(current).finally(() => {
              current.livePreview = undefined;
            });
        }, LIVE_TRANSCRIPT_INTERVAL_MS),
      );
    current.timers.push(
      setInterval(() => {
        if (turn !== current || performance.now() - current.startedAt < (TURN_MAXIMUM_SECONDS - 2) * 1_000) return;
        if (current.spoke || (pushToTalk && talking)) endTurn(current);
        else restartRecording(current);
      }, 1_000),
    );
  }

  function record(current: Turn, recorder: MediaRecorder): void {
    const chunks: Blob[] = [];
    current.recorder = recorder;
    current.chunks = chunks;
    current.startedAt = performance.now();
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      if (turn !== current || current.recorder !== recorder) return;
      const ended = currentRecording(current);
      releaseTurn();
      if (step === "listening") void finishTurn(ended, current.own);
    });
    recorder.start(LIVE_TRANSCRIPT_INTERVAL_MS);
  }

  function restartRecording(current: Turn): void {
    const previous = current.recorder;
    record(current, createRecorder(current.stream));
    if (previous.state !== "inactive") previous.stop();
  }

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
    let silentFor = 0;
    current.timers.push(
      setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const db = 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-5));
        if (db > DIGITAL_SILENCE_DB) {
          if (current.roomNoise) {
            current.roomNoise = false;
            noiseDb = db;
            loudFor = 0;
          }
          noiseDb = db < noiseDb ? db : Math.min(db, noiseDb + NOISE_RISE_DB);
          peakDb = Math.max(db, peakDb - PEAK_FALL_DB);
        }
        const range = Math.max(MIN_RANGE_DB, peakDb - noiseDb - NOISE_MARGIN_DB);
        const loudness = Math.min(1, Math.max(0, (db - noiseDb - NOISE_MARGIN_DB) / range));
        const level = loudness * loudness;
        shown += (level - shown) * (level > shown ? 0.7 : 0.45);
        const value = shown;
        if (step === "listening")
          setState((draft) => {
            draft.levels = [...draft.levels.slice(1), value];
          });
        silentFor = loudness >= SPEECH_LOUDNESS ? 0 : silentFor + LEVEL_INTERVAL_MS;
        if (
          !current.spoke &&
          !(pushToTalk && talking) &&
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
            if (step === "waiting" && sending === 0) holdReply();
            setState((draft) => {
              draft.error = null;
            });
          }
        } else {
          loudFor = 0;
          quietFor += LEVEL_INTERVAL_MS;
          if (current.spoke && quietFor >= turnEndSilenceMs && !pushToTalk) endTurn(current);
        }
        if (held && !pushToTalk && heldAt !== undefined && current.spoke && performance.now() - heldAt >= HOLD_WORDS_MS)
          checkHeldWords(current);
      }, LEVEL_INTERVAL_MS),
    );
  }

  function checkHeldWords(current: Turn): void {
    if (step !== "listening" || current.livePreview || current.chunks.length === 0) return;
    heldAt = undefined;
    if (WORD.test(state.heard)) return;
    const recorder = current.recorder;
    const check = transcribe(new Blob(current.chunks, { type: recorder.mimeType }))
      .then((text) => {
        if (!held || turn !== current || current.recorder !== recorder || !current.spoke || step !== "listening")
          return;
        if (WORD.test(text)) {
          setState((draft) => {
            draft.heard = text;
          });
          return;
        }
        current.spoke = false;
        current.roomNoise = true;
        void resumeReply();
      })
      .catch(() => {})
      .finally(() => {
        if (current.livePreview === check) current.livePreview = undefined;
      });
    current.livePreview = check;
  }

  async function refreshHeard(current: Turn): Promise<void> {
    try {
      const audio = await recordingToWav(new Blob(current.chunks, { type: current.recorder.mimeType }));
      const result = await deps.voice.transcribe({ audio });
      if (turn === current && current.recorder.state === "recording")
        setState((draft) => {
          draft.heard = result.text.trim();
        });
    } catch {}
  }

  function endTurn(current: Turn): void {
    if (step !== "listening" || current.recorder.state !== "recording") return;
    const ended = currentRecording(current);
    current.spoke = false;
    current.livePreview = undefined;
    record(current, createRecorder(current.stream));
    setStep("transcribing");
    setState((draft) => {
      draft.levels = quietLevels();
    });
    const own = current.own;
    ended.recorder.addEventListener("stop", () => void finishTurn(ended, own), { once: true });
    ended.recorder.stop();
  }

  async function finishTurn(current: Recording, own: number): Promise<void> {
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
      await current.livePreview;
      if (current.chunks.length === 0) throw new Error(currentText().t("composer.voice.noSpeechRecorded"));
      recording = new Blob(current.chunks, { type: mimeType });
      text = await transcribe(recording);
    } catch (error) {
      if (own !== generation || disposed) return;
      analytics.track("voice_turn", {
        ...turnProperties,
        result: "failed",
        duration_ms: elapsedMs(transcribingAt),
        failure_code: "transcription_failed",
      });
      if (held) await resumeReply();
      else resumeListening();
      setState((draft) => {
        draft.error = voiceTranscriptionError(error);
      });
      return;
    }
    if (own !== generation || disposed) return;
    const transcribedMs = elapsedMs(transcribingAt);
    if (!WORD.test(text)) {
      analytics.track("voice_turn", {
        ...turnProperties,
        result: "failed",
        duration_ms: transcribedMs,
        failure_code: "no_speech",
      });
      if (held) await resumeReply();
      else resumeListening();
      return;
    }
    if (held) interruptByVoice();
    setStep("waiting");
    waitingSend = own;
    sentHeard = text;
    setState((draft) => {
      draft.heard = text;
      draft.error = null;
    });
    const notSent = () => {
      if (disposed || own !== waitingSend || step !== "waiting") return;
      forgetDictatedMessage(target);
      resumeListening();
      setState((draft) => {
        draft.heard = text;
        draft.error = currentText().t("conversation.voice.notSent");
      });
    };
    sending += 1;
    let recordingId: string | undefined;
    let delivered: boolean;
    try {
      recordingId = await keepRecording(recording);
      if (own !== generation || disposed) {
        discardRecording(recordingId);
        return;
      }
      noteDictatedMessage(target, text, { always: true, progressUpdate: deps.progressUpdate });
      delivered = await deps.submit({ ...EMPTY_DRAFT, text }, target, EMPTY_DRAFT, {
        recordingDraftId: recordingId,
        onFailed: notSent,
      });
    } finally {
      sending -= 1;
    }
    analytics.track("voice_turn", {
      ...turnProperties,
      result: delivered ? "succeeded" : "failed",
      duration_ms: transcribedMs,
      recording_kept: recordingId !== undefined,
      ...(delivered ? {} : { failure_code: "send_failed" }),
    });
    if (delivered) {
      sentTurns += 1;
      if (step === "waiting") await listenWhileWaiting(own);
      return;
    }
    discardRecording(recordingId);
    notSent();
  }

  async function keepRecording(recording: Blob): Promise<string | undefined> {
    if (deps.serverId !== LOCAL_SERVER_ID || !recording.type.startsWith("audio/webm")) return undefined;
    if (recording.size > VOICE_AUDIO_LIMITS.maximumRecordingBytes) return undefined;
    try {
      return (await speechPort().voice.keepRecording({ audio: new Uint8Array(await recording.arrayBuffer()) })).id;
    } catch {
      return undefined;
    }
  }

  function discardRecording(id: string | undefined): void {
    if (id)
      void speechPort()
        .agent.discardDraftAttachment(id, LOCAL_SERVER_ID)
        .catch(() => {});
  }

  async function transcribe(recording: Blob): Promise<string> {
    const result = streamed
      ? await transcribeStreamed(recording)
      : await deps.voice.transcribe({ audio: await recordingToWav(recording) });
    return result.text.trim();
  }

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

  function releaseTurn(): void {
    const current = turn;
    if (!current) return;
    turn = undefined;
    stopCapture(current);
    if (current.recorder.state !== "inactive") current.recorder.stop();
  }

  function toggleMute(): void {
    desktopAnalytics.track("voice_conversation_action", {
      action: muted ? "unmute" : "mute",
      server_kind: serverKind,
      result: "succeeded",
    });
    applyMute(!muted);
  }

  function setTalkMode(mode: VoiceTalkMode): void {
    const push = mode === "push";
    if (push === pushToTalk) return;
    pushToTalk = push;
    releaseWhenListening = false;
    setTalking(false);
    if (push !== muted) applyMute(push);
  }

  function startTalking(): void {
    if (!pushToTalk || talking) return;
    setTalking(true);
    talkingAt = performance.now();
    releaseWhenListening = false;
    if (step === "waiting" && sending === 0) holdReply();
    if (muted) applyMute(false);
  }

  function stopTalking(): void {
    if (!pushToTalk || !talking) return;
    setTalking(false);
    if (muted) {
      if (held && step === "listening") void resumeReply();
      return;
    }
    const current = turn;
    const long = performance.now() - talkingAt >= PUSH_TO_TALK_MIN_MS;
    if (long && current?.spoke && (step === "transcribing" || step === "waiting")) {
      releaseWhenListening = true;
      return;
    }
    releaseTalk(long);
  }

  function releaseTalk(long = true): void {
    const current = turn;
    if (long && current && step === "listening" && current.recorder.state === "recording") {
      endTurn(current);
      setMuted(true);
      releaseTurn();
      return;
    }
    if (held) {
      desktopAnalytics.track("voice_conversation_action", {
        action: "interrupt",
        server_kind: serverKind,
        result: "succeeded",
        trigger: "button",
      });
      dropReply();
    }
    applyMute(true);
  }

  function cancelTalking(): void {
    if (!pushToTalk || !talking) return;
    setTalking(false);
    releaseWhenListening = false;
    if (!muted) applyMute(true);
    else if (held && step === "listening") void resumeReply();
  }

  function applyMute(next: boolean): void {
    setMuted(next);
    if (!muted)
      setState((draft) => {
        draft.error = null;
      });
    if (!muted && !ready && !loading) {
      setStep("starting");
      void start();
      return;
    }
    if (step === "waiting" || step === "transcribing") {
      if (muted) releaseTurn();
      else void openTurn(generation);
      return;
    }
    if (step !== "listening") return;
    if (muted) {
      generation += 1;
      releaseTurn();
      if (held) {
        void resumeReply();
        return;
      }
      setState((draft) => {
        draft.heard = "";
        draft.levels = quietLevels();
      });
    } else void listen();
  }

  function interrupt(): void {
    if (step !== "waiting" && step !== "transcribing") return;
    desktopAnalytics.track("voice_conversation_action", {
      action: "interrupt",
      server_kind: serverKind,
      result: "succeeded",
      trigger: "button",
    });
    resumeListening();
    dropReply();
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
    removeDownloadListeners();
    releaseTurn();
    dropReply();
  }
  onCleanup(dispose);

  const reading = () => {
    const current = speechReading();
    return current?.serverId === deps.serverId && current.agentId === deps.agentId ? current : null;
  };
  function phase(): VoicePhase {
    if (state.offline) return "offline";
    if (state.phase === "starting" || state.phase === "listening") return state.phase;
    if (state.phase === "waiting" && reading()) return "speaking";
    return "thinking";
  }

  void start();

  return {
    phase,
    muted: () => state.muted,
    talking: () => state.talking,
    error: () => state.error,
    downloadProgress: () => state.downloadProgress,
    levels: () => (phase() === "speaking" ? (reading()?.levels ?? state.levels) : state.levels),
    toggleMute,
    setTalkMode,
    startTalking,
    stopTalking,
    cancelTalking,
    interrupt,
  };
}
