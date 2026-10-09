import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { onCleanup } from "solid-js";
import { desktopAnalytics } from "../../../analytics";
import { appendVoiceTranscript, recordingToWav } from "../../../voice-recording";
import { EMPTY_DRAFT } from "../composer-draft";
import { composerDraftKey } from "../conversation-keys";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps, ConversationTarget, VoiceLiveTranscript } from "../conversation-types";
import { voiceCaptureError, voiceTranscriptionError } from "../voice-status";

/**
 * How often the recording so far is transcribed again while you speak. Parakeet reads a minute of
 * audio in about a second, so the whole recording is sent each time rather than a sliding window,
 * and a pass that is still running makes the next tick wait instead of queueing behind it.
 */
const LIVE_TRANSCRIPT_INTERVAL_MS = 1_000;

/** The recording waveform: how many level samples it shows, and how often a new one arrives. */
export const VOICE_LEVEL_COUNT = 24;
const VOICE_LEVEL_INTERVAL_MS = 80;
/**
 * Waveform loudness, in dB: how fast the noise floor rises and the loudest sound fades per sample,
 * and the smallest speech scale above the floor.
 */
const VOICE_DIGITAL_SILENCE_DB = -90;
const VOICE_NOISE_RISE_DB = 0.1;
const VOICE_NOISE_MARGIN_DB = 6;
const VOICE_PEAK_FALL_DB = 0.05;
const VOICE_MIN_RANGE_DB = 12;

interface VoiceSubmitHooks {
  saveEdit: (
    draftOverride?: ComposerDraft,
    target?: ConversationTarget & { deliveryId: string; originalAttachmentIds: string[] },
    submittedSnapshot?: ComposerDraft,
  ) => Promise<boolean>;
  submit: (
    draftOverride?: ComposerDraft,
    targetOverride?: ConversationTarget,
    submittedSnapshot?: ComposerDraft,
  ) => Promise<boolean>;
  restoreTranscript: (target: ConversationTarget, transcript: string) => void;
}

export interface VoiceStoreDeps {
  props: ConversationProps;
  resources: {
    voiceSubmitRequest:
      | undefined
      | {
          agentId: string;
          serverId: string;
          draft: ComposerDraft;
          queuedEdit: { deliveryId: string; originalAttachmentIds: string[] } | undefined;
        };
    voiceDisposed: boolean;
    voiceRequestGeneration: number;
    voiceRecorder: Pick<MediaRecorder, "state" | "stop"> | undefined;
    voiceStream: { getTracks(): Array<Pick<MediaStreamTrack, "stop">> } | undefined;
    voiceRecordingTimer: ReturnType<typeof setTimeout> | undefined;
    voiceElapsedTimer: ReturnType<typeof setInterval> | undefined;
    voiceChunks: Blob[];
    voiceLiveRequest: Promise<void> | undefined;
    voiceMeterStop: (() => void) | undefined;
    voiceAgentId: string | undefined;
    voiceServerId: string | undefined;
  };
  voicePhase: () => "idle" | "preparing" | "requesting" | "recording" | "transcribing";
  setVoicePhase: (phase: "idle" | "preparing" | "requesting" | "recording" | "transcribing") => void;
  setVoiceModelProgress: (progress: number | null) => void;
  voiceElapsedSeconds: () => number;
  setVoiceElapsedSeconds: (seconds: number) => void;
  setVoiceLiveTranscript: (transcript: VoiceLiveTranscript | null) => void;
  setVoiceLevels: (levels: number[]) => void;
  drafts: () => Record<string, ComposerDraft>;
  setDrafts: (update: (current: Record<string, ComposerDraft>) => Record<string, ComposerDraft>) => void;
  setConversationErrors: (update: (current: Record<string, string>) => Record<string, string>) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  setComposerFocusRequest: (update: (current: number) => number) => void;
  clearConversationError: (target: ConversationTarget) => void;
  setConversationError: (target: ConversationTarget, message: string) => void;
  viewIsMounted: () => boolean;
  hooks: VoiceSubmitHooks;
}

export function createVoiceStore(deps: VoiceStoreDeps) {
  const { resources } = deps;

  async function startVoiceRecording(): Promise<void> {
    const agentId = deps.props.agent?.id;
    const serverId = deps.props.server?.id ?? "local";
    if (!agentId || deps.voicePhase() !== "idle") return;
    const target = { agentId, serverId };
    deps.clearConversationError(target);
    resources.voiceSubmitRequest = undefined;
    deps.setComposerError(null);
    const generation = ++resources.voiceRequestGeneration;
    deps.setVoicePhase("preparing");
    deps.setVoiceModelProgress(0);
    try {
      const modelStatus = await conversationRuntime(deps.props).voice.prepareModel();
      if (resources.voiceDisposed || resources.voiceRequestGeneration !== generation) return;
      if (modelStatus.phase !== "ready") {
        deps.setVoicePhase("idle");
        deps.setVoiceModelProgress(null);
        deps.setConversationError(
          target,
          currentText().errorMessage(modelStatus.message, currentText().t("composer.voice.prepareFailed")),
        );
        return;
      }
      if (!deps.viewIsMounted()) {
        deps.setVoicePhase("idle");
        deps.setVoiceModelProgress(null);
        return;
      }
      deps.setVoicePhase("requesting");
      deps.setVoiceModelProgress(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (resources.voiceDisposed || !deps.viewIsMounted() || resources.voiceRequestGeneration !== generation) {
        for (const track of stream.getTracks()) track.stop();
        if (!resources.voiceDisposed && resources.voiceRequestGeneration === generation) deps.setVoicePhase("idle");
        return;
      }
      const recorder = new MediaRecorder(stream);
      resources.voiceStream = stream;
      resources.voiceRecorder = recorder;
      resources.voiceAgentId = agentId;
      resources.voiceServerId = serverId;
      resources.voiceChunks = [];
      deps.setVoiceLiveTranscript(null);
      recorder.addEventListener("dataavailable", (event) => {
        // A cancelled recorder still delivers its last chunk; it belongs to nothing.
        if (event.data.size === 0 || resources.voiceRecorder !== recorder) return;
        resources.voiceChunks.push(event.data);
        // The last chunk arrives after Stop, and the final pass already covers it.
        if (recorder.state === "recording" && !resources.voiceLiveRequest) {
          resources.voiceLiveRequest = refreshLiveTranscript(recorder, target).finally(() => {
            resources.voiceLiveRequest = undefined;
          });
        }
      });
      recorder.addEventListener("stop", () => {
        if (resources.voiceRecorder === recorder) void finishVoiceRecording(recorder.mimeType);
      });
      recorder.start(LIVE_TRANSCRIPT_INTERVAL_MS);
      startVoiceMeter(stream);
      startVoiceElapsedTimer();
      deps.setVoicePhase("recording");
      resources.voiceRecordingTimer = setTimeout(stopVoiceRecording, VOICE_AUDIO_LIMITS.maximumSeconds * 1_000);
    } catch (error) {
      if (resources.voiceRequestGeneration === generation) deps.setVoicePhase("idle");
      deps.setConversationError(target, voiceCaptureError(error));
    }
  }

  const removeVoiceModelListener = conversationRuntime(deps.props).voice.onModelStatus((status) => {
    if (deps.voicePhase() !== "preparing") return;
    deps.setVoiceModelProgress(status.progress);
  });
  onCleanup(removeVoiceModelListener);

  function stopVoiceRecording(): void {
    if (deps.voicePhase() !== "recording" || !resources.voiceRecorder) return;
    deps.setVoicePhase("transcribing");
    stopVoiceElapsedTimer();
    if (resources.voiceRecordingTimer) clearTimeout(resources.voiceRecordingTimer);
    resources.voiceRecordingTimer = undefined;
    resources.voiceRecorder.stop();
    stopVoiceStream();
  }

  /** Discards the recording: nothing is transcribed and the draft stays as it was. */
  function cancelVoiceRecording(): void {
    const recorder = resources.voiceRecorder;
    if (deps.voicePhase() !== "recording" || !recorder) return;
    stopVoiceElapsedTimer();
    if (resources.voiceRecordingTimer) clearTimeout(resources.voiceRecordingTimer);
    resources.voiceRecordingTimer = undefined;
    resources.voiceRecorder = undefined;
    resources.voiceAgentId = undefined;
    resources.voiceServerId = undefined;
    resources.voiceChunks = [];
    resources.voiceSubmitRequest = undefined;
    recorder.stop();
    stopVoiceStream();
    deps.setVoiceLiveTranscript(null);
    deps.setVoicePhase("idle");
  }

  /**
   * Samples the microphone loudness for the waveform. The meter is decoration: where Web Audio
   * cannot read the stream, the waveform stays flat and the recording is not affected.
   */
  function startVoiceMeter(stream: MediaStream): void {
    resources.voiceMeterStop?.();
    let levels: number[] = new Array(VOICE_LEVEL_COUNT).fill(0);
    deps.setVoiceLevels(levels);
    let context: AudioContext | undefined;
    let analyser: AnalyserNode;
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
    } catch {
      void context?.close();
      return;
    }
    const samples = new Float32Array(analyser.fftSize);
    // Room noise differs between microphones, so loudness counts from a noise floor that follows
    // the quietest recent sound. It starts at the first sample, taken just after the click and before
    // the user speaks. It falls at once and rises slowly, so speech does not become the floor.
    let noiseDb = Number.POSITIVE_INFINITY;
    // Microphone gain differs too, so the scale reaches up to the loudest recent sound.
    let peakDb = Number.NEGATIVE_INFINITY;
    let shown = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const db = 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-5));
      // Digital silence comes before the stream flows and from a muted input; no real room is that quiet.
      if (db > VOICE_DIGITAL_SILENCE_DB) {
        noiseDb = db < noiseDb ? db : Math.min(db, noiseDb + VOICE_NOISE_RISE_DB);
        peakDb = Math.max(db, peakDb - VOICE_PEAK_FALL_DB);
      }
      const range = Math.max(VOICE_MIN_RANGE_DB, peakDb - noiseDb - VOICE_NOISE_MARGIN_DB);
      const loudness = Math.min(1, Math.max(0, (db - noiseDb - VOICE_NOISE_MARGIN_DB) / range));
      // Squared, so ordinary syllables differ in height and only the loudest fill the bar.
      const level = loudness * loudness;
      // Rise quickly with a word and fall back gently, so bars do not flicker between syllables.
      shown += (level - shown) * (level > shown ? 0.7 : 0.45);
      levels = [...levels.slice(1), shown];
      deps.setVoiceLevels(levels);
    }, VOICE_LEVEL_INTERVAL_MS);
    const meterContext = context;
    resources.voiceMeterStop = () => {
      clearInterval(timer);
      void meterContext.close();
      resources.voiceMeterStop = undefined;
    };
  }

  /**
   * Shows what was said so far. It is a preview: a failure here says nothing the final pass will
   * not say better, so it is dropped, and a result that arrives after the recorder stopped is
   * dropped too, because the final transcript is about to replace it.
   */
  async function refreshLiveTranscript(recorder: MediaRecorder, target: ConversationTarget): Promise<void> {
    try {
      const audio = await recordingToWav(new Blob(resources.voiceChunks, { type: recorder.mimeType }));
      const result = await conversationRuntime(deps.props).voice.transcribe({ audio });
      if (resources.voiceRecorder === recorder && !resources.voiceDisposed)
        deps.setVoiceLiveTranscript({ ...target, text: result.text.trim() });
    } catch {
      // The final transcription reports its own error.
    }
  }

  async function finishVoiceRecording(mimeType: string): Promise<void> {
    const targetAgentId = resources.voiceAgentId;
    const targetServerId = resources.voiceServerId;
    const chunks = resources.voiceChunks;
    const submitRequest = resources.voiceSubmitRequest;
    resources.voiceRecorder = undefined;
    resources.voiceAgentId = undefined;
    resources.voiceServerId = undefined;
    resources.voiceChunks = [];
    resources.voiceSubmitRequest = undefined;
    // The recorder also stops by itself, for example when the microphone is disconnected.
    stopVoiceElapsedTimer();
    stopVoiceStream();
    if (!targetAgentId || !targetServerId || resources.voiceDisposed) return;
    const analytics = desktopAnalytics.scope();
    const audioDurationSeconds = deps.voiceElapsedSeconds();
    const startedAt = performance.now();
    try {
      // The voice host takes one request at a time; the live pass is at most a second of work.
      await resources.voiceLiveRequest;
      if (chunks.length === 0) throw new Error(currentText().t("composer.voice.noSpeechRecorded"));
      const audio = await recordingToWav(new Blob(chunks, { type: mimeType }));
      const result = await conversationRuntime(deps.props).voice.transcribe({ audio });
      if (!result.text.trim()) throw new Error(currentText().t("composer.voice.noSpeechDetected"));
      analytics.track("voice_transcription", {
        result: "succeeded",
        audio_duration_seconds: audioDurationSeconds,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      if (resources.voiceDisposed) return;
      const recordingTarget = { agentId: targetAgentId, serverId: targetServerId };
      deps.clearConversationError(recordingTarget);
      const draft = submitRequest?.draft ?? deps.drafts()[composerDraftKey(recordingTarget)] ?? EMPTY_DRAFT;
      const transcribedDraft = { ...draft, text: appendVoiceTranscript(draft.text, result.text) };
      if (submitRequest) {
        const target = { agentId: submitRequest.agentId, serverId: submitRequest.serverId };
        let delivered: boolean;
        if (submitRequest.queuedEdit) {
          delivered = await deps.hooks.saveEdit(
            transcribedDraft,
            {
              ...target,
              ...submitRequest.queuedEdit,
            },
            submitRequest.draft,
          );
        } else {
          delivered = await deps.hooks.submit(transcribedDraft, target, submitRequest.draft);
        }
        if (!delivered) deps.hooks.restoreTranscript(target, result.text);
      } else {
        const key = composerDraftKey(recordingTarget);
        deps.setDrafts((current) => ({ ...current, [key]: transcribedDraft }));
        if (deps.props.agent?.id === targetAgentId && (deps.props.server?.id ?? "local") === targetServerId) {
          deps.setComposerFocusRequest((current) => current + 1);
        }
      }
    } catch (error) {
      analytics.track("voice_transcription", {
        result: "failed",
        audio_duration_seconds: audioDurationSeconds,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        failure_code: "transcription_failed",
      });
      if (!resources.voiceDisposed) {
        const target = { agentId: targetAgentId, serverId: targetServerId };
        deps.setConversationErrors((current) => ({
          ...current,
          [composerDraftKey(target)]: voiceTranscriptionError(error),
        }));
      }
    } finally {
      if (!resources.voiceDisposed) {
        deps.setVoiceLiveTranscript(null);
        deps.setVoicePhase("idle");
      }
    }
  }

  function stopVoiceStream(): void {
    for (const track of resources.voiceStream?.getTracks() ?? []) track.stop();
    resources.voiceStream = undefined;
    resources.voiceMeterStop?.();
  }

  function startVoiceElapsedTimer(): void {
    stopVoiceElapsedTimer();
    const startedAt = Date.now();
    deps.setVoiceElapsedSeconds(0);
    resources.voiceElapsedTimer = setInterval(() => {
      deps.setVoiceElapsedSeconds(
        Math.min(VOICE_AUDIO_LIMITS.maximumSeconds, Math.floor((Date.now() - startedAt) / 1_000)),
      );
    }, 250);
  }

  function stopVoiceElapsedTimer(): void {
    if (resources.voiceElapsedTimer) clearInterval(resources.voiceElapsedTimer);
    resources.voiceElapsedTimer = undefined;
  }

  return {
    startVoiceRecording,
    stopVoiceRecording,
    cancelVoiceRecording,
    finishVoiceRecording,
    stopVoiceStream,
    startVoiceElapsedTimer,
    stopVoiceElapsedTimer,
  };
}
