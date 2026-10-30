import { VOICE_AUDIO_LIMITS, VOICE_MODELS, VOICE_STREAM_LIMITS, type VoiceModelId } from "@openbot/contracts/ipc";
import { VOICE_LIMIT_WARNING_SECONDS } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { currentText } from "@openbot/ui/text";
import { onCleanup } from "solid-js";
import { desktopAnalytics } from "../../../analytics";
import { unlockCompletionSound } from "../../../completion-sound";
import { playVoiceLimitStop, playVoiceLimitWarning } from "../../../voice-limit-sound";
import { appendVoiceTranscript, encodePcm16, recordingToSamples, recordingToWav } from "../../../voice-recording";
import { forgetDictatedMessage, noteDictatedMessage, stopSpokenReply } from "../../speech/speech-replies";
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
/** How often a streamed dictation sends the new audio to ElevenLabs. */
const STREAM_INTERVAL_MS = 250;

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

/** A dictation that streams to ElevenLabs through main. */
export interface VoiceCloudStream {
  streamId: string;
  /** How many 16 kHz samples main has received. */
  sentSamples: number;
  /** Stops the transcript events of this stream. */
  stopTranscript: () => void;
}

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

/** What the voice store reads from its view: the agent and server it dictates for, and the runtime. */
type VoiceStoreProps = Pick<ConversationProps, "runtime"> & {
  agent: Pick<NonNullable<ConversationProps["agent"]>, "id"> | undefined;
  server: Pick<NonNullable<ConversationProps["server"]>, "id"> | undefined;
};

export interface VoiceStoreDeps {
  props: VoiceStoreProps;
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
    voiceCloudStream: VoiceCloudStream | undefined;
    voiceMeterStop: (() => void) | undefined;
    voiceAgentId: string | undefined;
    voiceServerId: string | undefined;
    voiceThreadSend: boolean;
  };
  voicePhase: () => "idle" | "preparing" | "requesting" | "recording" | "transcribing";
  setVoicePhase: (phase: "idle" | "preparing" | "requesting" | "recording" | "transcribing") => void;
  setVoiceModelProgress: (progress: number | null) => void;
  voiceElapsedSeconds: () => number;
  setVoiceElapsedSeconds: (seconds: number) => void;
  setVoiceLiveTranscript: (transcript: VoiceLiveTranscript | null) => void;
  /** The side thread draft that the last recording was started for. It stays set after the recording. */
  voiceThreadKey: () => string | undefined;
  setVoiceThreadKey: (key: string | undefined) => void;
  setVoiceLevels: (levels: number[]) => void;
  drafts: () => Record<string, ComposerDraft>;
  setDrafts: (update: (current: Record<string, ComposerDraft>) => Record<string, ComposerDraft>) => void;
  setConversationErrors: (update: (current: Record<string, string>) => Record<string, string>) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  setComposerFocusRequest: (update: (current: number) => number) => void;
  clearConversationError: (target: ConversationTarget) => void;
  setConversationError: (target: ConversationTarget, message: string) => void;
  viewIsMounted: () => boolean;
  /** Shows or ends the notice that the recording of this conversation stopped at the time limit. */
  setVoiceLimitReached?: (target: ConversationTarget, reached: boolean) => void;
  hooks: VoiceSubmitHooks;
  /** The open side thread. A recording for it puts its text in the thread's draft. */
  thread?: VoiceThreadHooks;
}

/** What a recording for a side thread needs. The agent's own chat is covered while a thread is open. */
interface VoiceThreadHooks {
  /** The draft key of the open side thread. Undefined while the agent's own chat is open. */
  openDraftKey: () => string | undefined;
  appendTranscript: (key: string, text: string) => void;
  /** Sends the thread's draft, when that thread is still open. The message box stays locked until it ends. */
  send: (key: string) => Promise<void>;
  reportError: (message: string) => void;
  /** The recording stopped at the time limit. */
  reportLimit: () => void;
}

export function createVoiceStore(deps: VoiceStoreDeps) {
  const { resources } = deps;
  /** The model that `prepareModel` downloads, so the progress of another model is not shown. */
  let preparingModelId: VoiceModelId | null = null;
  /** The recording that is being transcribed stopped at the time limit, not at the user's click. */
  let stoppedAtLimit = false;

  /** Starts a recording for the agent's own chat, or for the side thread whose draft is `threadKey`. */
  async function startVoiceRecording(threadKey?: string): Promise<void> {
    const agentId = deps.props.agent?.id;
    const serverId = deps.props.server?.id ?? "local";
    if (!agentId || deps.voicePhase() !== "idle") return;
    deps.setVoiceThreadKey(threadKey);
    // The user speaks again: the reply that is read aloud stops.
    stopSpokenReply();
    // The limit cues play up to two minutes after this click, and audio starts surely only from one.
    unlockCompletionSound();
    const target = { agentId, serverId };
    const destination = { ...target, threadKey };
    // The agent's own chat is covered by the thread, so a thread recording reports its errors there.
    const fail = (message: string) =>
      threadKey === undefined ? deps.setConversationError(target, message) : deps.thread?.reportError(message);
    // A recording also ends when its message box closes or is covered before the microphone opens.
    const stillOpen = () => deps.viewIsMounted() && deps.thread?.openDraftKey() === threadKey;
    if (threadKey === undefined) {
      deps.setVoiceLimitReached?.(target, false);
      deps.clearConversationError(target);
      deps.setComposerError(null);
    }
    resources.voiceSubmitRequest = undefined;
    const generation = ++resources.voiceRequestGeneration;
    deps.setVoicePhase("preparing");
    deps.setVoiceModelProgress(0);
    let stream: MediaStream | undefined;
    let cloud: VoiceCloudStream | undefined;
    try {
      const voice = conversationRuntime(deps.props).voice;
      let livePreview = true;
      let streamed = false;
      // The settings answer at once; a download reports progress only after that.
      const [, modelStatus] = await Promise.all([
        Promise.all([voice.getSettings(), voice.getServer()]).then(([settings, server]) => {
          preparingModelId = settings.modelId;
          const model = VOICE_MODELS.find((candidate) => candidate.id === settings.modelId);
          // The user's own server takes the whole recording once: it has no live preview or stream.
          const own = server?.routes.dictation === true;
          livePreview = !own && (model?.livePreview ?? true);
          streamed = !own && model?.kind === "cloud";
        }),
        voice.prepareModel(),
      ]);
      if (resources.voiceDisposed || resources.voiceRequestGeneration !== generation) return;
      if (modelStatus.phase !== "ready") {
        deps.setVoicePhase("idle");
        deps.setVoiceModelProgress(null);
        fail(currentText().errorMessage(modelStatus.message, currentText().t("composer.voice.prepareFailed")));
        return;
      }
      if (!stillOpen()) {
        deps.setVoicePhase("idle");
        deps.setVoiceModelProgress(null);
        return;
      }
      deps.setVoicePhase("requesting");
      deps.setVoiceModelProgress(null);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (resources.voiceDisposed || !stillOpen() || resources.voiceRequestGeneration !== generation) {
        for (const track of stream.getTracks()) track.stop();
        if (!resources.voiceDisposed && resources.voiceRequestGeneration === generation) deps.setVoicePhase("idle");
        return;
      }
      cloud = streamed ? await openCloudStream(destination, fail, stillOpen, generation) : undefined;
      if (streamed && !cloud) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const recorder = new MediaRecorder(stream);
      resources.voiceStream = stream;
      resources.voiceRecorder = recorder;
      resources.voiceAgentId = agentId;
      resources.voiceServerId = serverId;
      resources.voiceThreadSend = false;
      resources.voiceChunks = [];
      deps.setVoiceLiveTranscript(null);
      recorder.addEventListener("dataavailable", (event) => {
        // A cancelled recorder still delivers its last chunk; it belongs to nothing.
        if (event.data.size === 0 || resources.voiceRecorder !== recorder) return;
        resources.voiceChunks.push(event.data);
        // The last chunk arrives after Stop, and the final pass already covers it.
        if (livePreview && recorder.state === "recording" && !resources.voiceLiveRequest) {
          const request = cloud ? streamNewAudio(recorder, cloud) : refreshLiveTranscript(recorder, destination);
          resources.voiceLiveRequest = request.finally(() => {
            resources.voiceLiveRequest = undefined;
          });
        }
      });
      recorder.addEventListener("stop", () => {
        if (resources.voiceRecorder === recorder) void finishVoiceRecording(recorder.mimeType);
      });
      recorder.start(cloud ? STREAM_INTERVAL_MS : LIVE_TRANSCRIPT_INTERVAL_MS);
      startVoiceMeter(stream);
      startVoiceElapsedTimer();
      deps.setVoicePhase("recording");
      resources.voiceRecordingTimer = setTimeout(stopVoiceRecordingAtLimit, VOICE_AUDIO_LIMITS.maximumSeconds * 1_000);
    } catch (error) {
      // The recorder failed after the microphone opened: release it, or the OS keeps it in use.
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        if (resources.voiceStream === stream) {
          resources.voiceStream = undefined;
          resources.voiceRecorder = undefined;
        }
      }
      // A stream that no recording uses would take the next recording's audio.
      if (cloud && resources.voiceCloudStream === cloud) cancelCloudStream();
      if (resources.voiceRequestGeneration === generation) deps.setVoicePhase("idle");
      fail(voiceCaptureError(error));
    }
  }

  /**
   * Opens the ElevenLabs stream after the microphone. Answers nothing when the stream cannot open or
   * the request was replaced; the phase and the error are then already set.
   */
  async function openCloudStream(
    destination: Omit<VoiceLiveTranscript, "text">,
    fail: (message: string) => void,
    stillOpen: () => boolean,
    generation: number,
  ): Promise<VoiceCloudStream | undefined> {
    const voice = conversationRuntime(deps.props).voice;
    let streamId: string;
    try {
      ({ streamId } = await voice.startStream());
    } catch (error) {
      if (resources.voiceRequestGeneration === generation) deps.setVoicePhase("idle");
      fail(voiceTranscriptionError(error));
      return undefined;
    }
    if (resources.voiceDisposed || !stillOpen() || resources.voiceRequestGeneration !== generation) {
      void voice.cancelStream({ streamId }).catch(() => {});
      if (!resources.voiceDisposed && resources.voiceRequestGeneration === generation) deps.setVoicePhase("idle");
      return undefined;
    }
    const stopTranscript = voice.onStreamTranscript((event) => {
      if (event.streamId === streamId && !resources.voiceDisposed)
        deps.setVoiceLiveTranscript({ ...destination, text: event.text.trim() });
    });
    const cloud = { streamId, sentSamples: 0, stopTranscript };
    resources.voiceCloudStream = cloud;
    return cloud;
  }

  /** Sends the audio that main does not have yet. Each pass decodes the whole recording again. */
  async function sendCloudAudio(cloud: VoiceCloudStream, samples: Float32Array): Promise<void> {
    const pcm = encodePcm16(samples.subarray(cloud.sentSamples));
    cloud.sentSamples = Math.max(cloud.sentSamples, samples.length);
    const voice = conversationRuntime(deps.props).voice;
    // A copy for each part, because IPC would copy the whole buffer of a view.
    for (let offset = 0; offset < pcm.byteLength; offset += VOICE_STREAM_LIMITS.maximumChunkBytes)
      await voice.appendStream({
        streamId: cloud.streamId,
        pcm: pcm.slice(offset, offset + VOICE_STREAM_LIMITS.maximumChunkBytes),
      });
  }

  /** A failed stream does not hear the rest: Stop now, and the final pass reports the failure. */
  async function streamNewAudio(recorder: MediaRecorder, cloud: VoiceCloudStream): Promise<void> {
    let samples: Float32Array;
    try {
      samples = await recordingToSamples(new Blob(resources.voiceChunks, { type: recorder.mimeType }));
    } catch {
      // The next pass, or the final one, decodes the recording again.
      return;
    }
    try {
      await sendCloudAudio(cloud, samples);
    } catch {
      if (resources.voiceRecorder === recorder) stopVoiceRecording();
    }
  }

  /** Ends the stream in main and drops its text. */
  function cancelCloudStream(): void {
    const cloud = resources.voiceCloudStream;
    if (!cloud) return;
    resources.voiceCloudStream = undefined;
    cloud.stopTranscript();
    void conversationRuntime(deps.props)
      .voice.cancelStream({ streamId: cloud.streamId })
      .catch(() => {});
  }

  const removeVoiceModelListener = conversationRuntime(deps.props).voice.onModelStatus((status) => {
    // Settings can download another model at the same time.
    if (deps.voicePhase() !== "preparing" || status.modelId !== preparingModelId) return;
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

  /** Stops a side thread's recording, and the thread sends its draft when the text is in it. */
  function stopVoiceRecordingAndSend(): void {
    if (deps.voicePhase() !== "recording" || deps.voiceThreadKey() === undefined) return;
    resources.voiceThreadSend = true;
    stopVoiceRecording();
  }

  /** The recording reached the time limit: a chime says so, as the user may not look at the screen. */
  function stopVoiceRecordingAtLimit(): void {
    if (deps.voicePhase() !== "recording" || !resources.voiceRecorder) return;
    playVoiceLimitStop();
    stoppedAtLimit = true;
    stopVoiceRecording();
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
    resources.voiceThreadSend = false;
    resources.voiceChunks = [];
    resources.voiceSubmitRequest = undefined;
    recorder.stop();
    stopVoiceStream();
    cancelCloudStream();
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
  async function refreshLiveTranscript(
    recorder: MediaRecorder,
    destination: Omit<VoiceLiveTranscript, "text">,
  ): Promise<void> {
    try {
      const audio = await recordingToWav(new Blob(resources.voiceChunks, { type: recorder.mimeType }));
      const result = await conversationRuntime(deps.props).voice.transcribe({ audio });
      if (resources.voiceRecorder === recorder && !resources.voiceDisposed)
        deps.setVoiceLiveTranscript({ ...destination, text: result.text.trim() });
    } catch {
      // The final transcription reports its own error.
    }
  }

  async function finishVoiceRecording(mimeType: string): Promise<void> {
    const targetAgentId = resources.voiceAgentId;
    const targetServerId = resources.voiceServerId;
    const threadKey = deps.voiceThreadKey();
    const sendThread = resources.voiceThreadSend;
    const chunks = resources.voiceChunks;
    const submitRequest = resources.voiceSubmitRequest;
    const atLimit = stoppedAtLimit;
    stoppedAtLimit = false;
    const cloud = resources.voiceCloudStream;
    resources.voiceCloudStream = undefined;
    resources.voiceRecorder = undefined;
    resources.voiceAgentId = undefined;
    resources.voiceServerId = undefined;
    resources.voiceThreadSend = false;
    resources.voiceChunks = [];
    resources.voiceSubmitRequest = undefined;
    // The recorder also stops by itself, for example when the microphone is disconnected.
    stopVoiceElapsedTimer();
    stopVoiceStream();
    if (!targetAgentId || !targetServerId || resources.voiceDisposed) {
      if (cloud) {
        cloud.stopTranscript();
        void conversationRuntime(deps.props)
          .voice.cancelStream({ streamId: cloud.streamId })
          .catch(() => {});
      }
      return;
    }
    const analytics = desktopAnalytics.scope();
    const audioDurationSeconds = deps.voiceElapsedSeconds();
    const startedAt = performance.now();
    try {
      // The voice host takes one request at a time; the live pass is at most a second of work.
      await resources.voiceLiveRequest;
      const voice = conversationRuntime(deps.props).voice;
      let result: { text: string };
      if (cloud) {
        // Main ends the stream when it finishes, also when it fails.
        try {
          if (chunks.length > 0)
            await sendCloudAudio(cloud, await recordingToSamples(new Blob(chunks, { type: mimeType })));
        } catch (error) {
          void voice.cancelStream({ streamId: cloud.streamId }).catch(() => {});
          throw error;
        }
        result = await voice.finishStream({ streamId: cloud.streamId });
      } else {
        if (chunks.length === 0) throw new Error(currentText().t("composer.voice.noSpeechRecorded"));
        const audio = await recordingToWav(new Blob(chunks, { type: mimeType }));
        result = await voice.transcribe({ audio });
      }
      if (!result.text.trim()) throw new Error(currentText().t("composer.voice.noSpeechDetected"));
      analytics.track("voice_transcription", {
        result: "succeeded",
        audio_duration_seconds: audioDurationSeconds,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      if (resources.voiceDisposed) return;
      // A thread's text stays in its draft, and the agent's own chat does not read the reply aloud.
      if (threadKey !== undefined) {
        deps.thread?.appendTranscript(threadKey, result.text);
        if (atLimit) deps.thread?.reportLimit();
        // As in the agent's own chat, the phase stays "transcribing" until the send ends, so a second Send waits.
        if (sendThread) await deps.thread?.send(threadKey);
        return;
      }
      const recordingTarget = { agentId: targetAgentId, serverId: targetServerId };
      deps.clearConversationError(recordingTarget);
      const draft = submitRequest?.draft ?? deps.drafts()[composerDraftKey(recordingTarget)] ?? EMPTY_DRAFT;
      const transcribedDraft = { ...draft, text: appendVoiceTranscript(draft.text, result.text) };
      // Only the desktop app reads replies aloud; the web client has its own runtime.
      const spokenReply = !deps.props.runtime;
      if (submitRequest) {
        const target = { agentId: submitRequest.agentId, serverId: submitRequest.serverId };
        if (spokenReply) noteDictatedMessage(target, result.text);
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
        if (!delivered) {
          if (spokenReply) forgetDictatedMessage(target);
          deps.hooks.restoreTranscript(target, result.text);
        }
      } else {
        if (spokenReply) noteDictatedMessage(recordingTarget, result.text);
        const key = composerDraftKey(recordingTarget);
        deps.setDrafts((current) => ({ ...current, [key]: transcribedDraft }));
        if (atLimit) deps.setVoiceLimitReached?.(recordingTarget, true);
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
      if (!resources.voiceDisposed && threadKey !== undefined) deps.thread?.reportError(voiceTranscriptionError(error));
      else if (!resources.voiceDisposed) {
        const target = { agentId: targetAgentId, serverId: targetServerId };
        deps.setConversationErrors((current) => ({
          ...current,
          [composerDraftKey(target)]: voiceTranscriptionError(error),
        }));
      }
    } finally {
      cloud?.stopTranscript();
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
    let warned = false;
    deps.setVoiceElapsedSeconds(0);
    resources.voiceElapsedTimer = setInterval(() => {
      const elapsed = Math.min(VOICE_AUDIO_LIMITS.maximumSeconds, Math.floor((Date.now() - startedAt) / 1_000));
      deps.setVoiceElapsedSeconds(elapsed);
      if (!warned && elapsed >= VOICE_AUDIO_LIMITS.maximumSeconds - VOICE_LIMIT_WARNING_SECONDS) {
        warned = true;
        playVoiceLimitWarning();
      }
    }, 250);
  }

  function stopVoiceElapsedTimer(): void {
    if (resources.voiceElapsedTimer) clearInterval(resources.voiceElapsedTimer);
    resources.voiceElapsedTimer = undefined;
  }

  return {
    startVoiceRecording,
    stopVoiceRecording,
    stopVoiceRecordingAndSend,
    cancelVoiceRecording,
    finishVoiceRecording,
    stopVoiceStream,
    cancelCloudStream,
    startVoiceElapsedTimer,
    stopVoiceElapsedTimer,
  };
}
