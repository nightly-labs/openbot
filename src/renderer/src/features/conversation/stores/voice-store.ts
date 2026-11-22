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
import { conversationOwnerId } from "./composer-store";

const LIVE_TRANSCRIPT_INTERVAL_MS = 1_000;
const STREAM_INTERVAL_MS = 250;

export const VOICE_LEVEL_COUNT = 24;
const VOICE_LEVEL_INTERVAL_MS = 80;
const VOICE_DIGITAL_SILENCE_DB = -90;
const VOICE_NOISE_RISE_DB = 0.1;
const VOICE_NOISE_MARGIN_DB = 6;
const VOICE_PEAK_FALL_DB = 0.05;
const VOICE_MIN_RANGE_DB = 12;

export interface VoiceCloudStream {
  streamId: string;
  sentSamples: number;
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

type VoiceStoreProps = Pick<ConversationProps, "runtime"> & {
  agent: Pick<NonNullable<ConversationProps["agent"]>, "id"> | undefined;
  channel?: Pick<NonNullable<ConversationProps["channel"]>, "id"> | undefined;
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
  setVoiceLimitReached?: (target: ConversationTarget, reached: boolean) => void;
  hooks: VoiceSubmitHooks;
  thread?: VoiceThreadHooks;
}

interface VoiceThreadHooks {
  openDraftKey: () => string | undefined;
  besideDraftKey?: () => string | undefined;
  appendTranscript: (key: string, text: string) => void;
  send: (key: string) => Promise<void>;
  reportError: (message: string) => void;
  reportLimit: () => void;
}

export function createVoiceStore(deps: VoiceStoreDeps) {
  const { resources } = deps;
  let preparingModelId: VoiceModelId | null = null;
  let stoppedAtLimit = false;

  async function startVoiceRecording(threadKey?: string): Promise<void> {
    const agentId = conversationOwnerId(deps.props);
    const serverId = deps.props.server?.id ?? "local";
    if (!agentId || deps.voicePhase() !== "idle") return;
    deps.setVoiceThreadKey(threadKey);
    stopSpokenReply();
    unlockCompletionSound();
    const target = { agentId, serverId };
    const destination = { ...target, threadKey };
    const fail = (message: string) =>
      threadKey === undefined ? deps.setConversationError(target, message) : deps.thread?.reportError(message);
    const stillOpen = () =>
      deps.viewIsMounted() &&
      (deps.thread?.openDraftKey() === threadKey ||
        (threadKey !== undefined && deps.thread?.besideDraftKey?.() === threadKey));
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
      const [, modelStatus] = await Promise.all([
        Promise.all([voice.getSettings(), voice.getServer()]).then(([settings, server]) => {
          preparingModelId = settings.modelId;
          const model = VOICE_MODELS.find((candidate) => candidate.id === settings.modelId);
          const own = server?.routes.dictation === true;
          livePreview = !own && (model?.livePreview ?? true);
          streamed = !own && model?.kind === "cloud" && model.provider === "elevenlabs";
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
        if (event.data.size === 0 || resources.voiceRecorder !== recorder) return;
        resources.voiceChunks.push(event.data);
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
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        if (resources.voiceStream === stream) {
          resources.voiceStream = undefined;
          resources.voiceRecorder = undefined;
        }
      }
      if (cloud && resources.voiceCloudStream === cloud) cancelCloudStream();
      if (resources.voiceRequestGeneration === generation) deps.setVoicePhase("idle");
      fail(voiceCaptureError(error));
    }
  }

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

  async function sendCloudAudio(cloud: VoiceCloudStream, samples: Float32Array): Promise<void> {
    const pcm = encodePcm16(samples.subarray(cloud.sentSamples));
    cloud.sentSamples = Math.max(cloud.sentSamples, samples.length);
    const voice = conversationRuntime(deps.props).voice;
    for (let offset = 0; offset < pcm.byteLength; offset += VOICE_STREAM_LIMITS.maximumChunkBytes)
      await voice.appendStream({
        streamId: cloud.streamId,
        pcm: pcm.slice(offset, offset + VOICE_STREAM_LIMITS.maximumChunkBytes),
      });
  }

  async function streamNewAudio(recorder: MediaRecorder, cloud: VoiceCloudStream): Promise<void> {
    let samples: Float32Array;
    try {
      samples = await recordingToSamples(new Blob(resources.voiceChunks, { type: recorder.mimeType }));
    } catch {
      return;
    }
    try {
      await sendCloudAudio(cloud, samples);
    } catch {
      if (resources.voiceRecorder === recorder) stopVoiceRecording();
    }
  }

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

  function stopVoiceRecordingAndSend(): void {
    if (deps.voicePhase() !== "recording" || deps.voiceThreadKey() === undefined) return;
    resources.voiceThreadSend = true;
    stopVoiceRecording();
  }

  function stopVoiceRecordingAtLimit(): void {
    if (deps.voicePhase() !== "recording" || !resources.voiceRecorder) return;
    playVoiceLimitStop();
    stoppedAtLimit = true;
    stopVoiceRecording();
  }

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
    let noiseDb = Number.POSITIVE_INFINITY;
    let peakDb = Number.NEGATIVE_INFINITY;
    let shown = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const db = 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-5));
      if (db > VOICE_DIGITAL_SILENCE_DB) {
        noiseDb = db < noiseDb ? db : Math.min(db, noiseDb + VOICE_NOISE_RISE_DB);
        peakDb = Math.max(db, peakDb - VOICE_PEAK_FALL_DB);
      }
      const range = Math.max(VOICE_MIN_RANGE_DB, peakDb - noiseDb - VOICE_NOISE_MARGIN_DB);
      const loudness = Math.min(1, Math.max(0, (db - noiseDb - VOICE_NOISE_MARGIN_DB) / range));
      const level = loudness * loudness;
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

  async function refreshLiveTranscript(
    recorder: MediaRecorder,
    destination: Omit<VoiceLiveTranscript, "text">,
  ): Promise<void> {
    try {
      const audio = await recordingToWav(new Blob(resources.voiceChunks, { type: recorder.mimeType }));
      const result = await conversationRuntime(deps.props).voice.transcribe({ audio });
      if (resources.voiceRecorder === recorder && !resources.voiceDisposed)
        deps.setVoiceLiveTranscript({ ...destination, text: result.text.trim() });
    } catch {}
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
    stopVoiceElapsedTimer();
    if (resources.voiceRecordingTimer) clearTimeout(resources.voiceRecordingTimer);
    resources.voiceRecordingTimer = undefined;
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
      await resources.voiceLiveRequest;
      const voice = conversationRuntime(deps.props).voice;
      let result: { text: string };
      if (cloud) {
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
      if (threadKey !== undefined) {
        deps.thread?.appendTranscript(threadKey, result.text);
        if (atLimit) deps.thread?.reportLimit();
        if (sendThread) await deps.thread?.send(threadKey);
        return;
      }
      const recordingTarget = { agentId: targetAgentId, serverId: targetServerId };
      deps.clearConversationError(recordingTarget);
      const draft = submitRequest?.draft ?? deps.drafts()[composerDraftKey(recordingTarget)] ?? EMPTY_DRAFT;
      const transcribedDraft = { ...draft, text: appendVoiceTranscript(draft.text, result.text) };
      const spokenReply = !deps.props.runtime && !deps.props.channel;
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
        if (
          conversationOwnerId(deps.props) === targetAgentId &&
          (deps.props.server?.id ?? "local") === targetServerId
        ) {
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
