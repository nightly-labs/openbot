import {
  cloudSpeechModel,
  DEFAULT_SPEECH_SETTINGS,
  DEFAULT_VOICE_SETTINGS,
  type DictationKeyProvider,
  ELEVENLABS_VOICE_MODEL_ID,
  isLocalVoiceModelId,
  type OpenBotDesktopApi,
  SPEECH_MODEL_ID,
  type SpeechKeyProvider,
  type SpeechModelStatus,
  type SpeechSettings,
  VOICE_MODEL_IDS,
  VOICE_MODELS,
  type VoiceLiveEvent,
  type VoiceModelId,
  type VoiceModelStatus,
  type VoiceServerModels,
  type VoiceServerProbe,
  type VoiceServerSettings,
  type VoiceSettings,
  type VoiceStreamTranscript,
} from "@openbot/contracts/ipc";
import { clone, type Listener, type MockRuntime } from "./mock-support";

export interface MockVoiceOptions {
  voiceModelsReady?: readonly VoiceModelId[];
  voiceSettings?: VoiceSettings;
  speechModelReady?: boolean;
  xaiKeySaved?: boolean;
  speechSettings?: SpeechSettings;
  voiceServer?: VoiceServerSettings | null;
}

const MOCK_SERVER_MODELS: VoiceServerModels = {
  transcription: ["Systran/faster-whisper-large-v3", "Systran/faster-distil-whisper-small.en"],
  speech: ["speaches-ai/Kokoro-82M-v1.0-ONNX"],
  voices: ["af_heart", "af_sky", "am_adam", "bm_george"],
};

const MOCK_SPEECH_ONLY_MODELS: VoiceServerModels = {
  transcription: [],
  speech: ["kokoro"],
  voices: ["af_heart", "af_bella", "am_michael", "bf_emma"],
};

function probeMockServer(address: string, apiKey: string | null): VoiceServerProbe {
  const url = new URL(address);
  if (url.hostname.includes("offline"))
    return { ok: false, field: "address", message: `OpenBot could not connect to ${url.host}.` };
  if (apiKey === "wrong") return { ok: false, field: "apiKey", message: `${url.host} refused the API key.` };
  return { ok: true, models: clone(url.port === "8880" ? MOCK_SPEECH_ONLY_MODELS : MOCK_SERVER_MODELS) };
}

const MOCK_SPEECH_SAMPLE_RATE = 44_100;

export function createMockVoice(options: MockVoiceOptions, { emit, schedule }: MockRuntime) {
  const ready = new Set(options.voiceModelsReady ?? ["parakeet-tdt-0.6b-v3"]);
  let settings: VoiceSettings = clone(options.voiceSettings ?? DEFAULT_VOICE_SETTINGS);
  let saved = options.voiceSettings !== undefined;
  const statuses = new Map<VoiceModelId, VoiceModelStatus>(
    VOICE_MODEL_IDS.map((modelId) => [
      modelId,
      ready.has(modelId)
        ? { modelId, phase: "ready", progress: 100, message: null }
        : { modelId, phase: "missing", progress: null, message: null },
    ]),
  );
  const listeners = new Set<Listener<VoiceModelStatus>>();
  const transcriptListeners = new Set<Listener<VoiceStreamTranscript>>();
  const transfers = new Map<VoiceModelId, { settle: (status: VoiceModelStatus) => void }>();
  let speechSettings: SpeechSettings = clone(options.speechSettings ?? DEFAULT_SPEECH_SETTINGS);
  let supertonicStatus: SpeechModelStatus = options.speechModelReady
    ? { modelId: SPEECH_MODEL_ID, phase: "ready", progress: 100, message: null }
    : { modelId: SPEECH_MODEL_ID, phase: "missing", progress: null, message: null };
  const speechListeners = new Set<Listener<SpeechModelStatus>>();
  let speechTransfer: { settle: (status: SpeechModelStatus) => void } | null = null;
  let server: VoiceServerSettings | null = clone(options.voiceServer ?? null);
  const serverListeners = new Set<Listener<VoiceServerSettings | null>>();
  const liveListeners = new Set<Listener<VoiceLiveEvent>>();
  const liveAnswerers = new Map<string, RTCPeerConnection>();
  let xaiKeySaved = options.xaiKeySaved ?? false;
  const keySaved = (provider: SpeechKeyProvider) =>
    provider === "xai" ? xaiKeySaved : ready.has(ELEVENLABS_VOICE_MODEL_ID);
  const speechStatus = (): SpeechModelStatus => {
    const { modelId } = speechSettings;
    const cloud = cloudSpeechModel(modelId);
    if (!cloud) return clone(supertonicStatus);
    return keySaved(cloud.provider)
      ? { modelId, phase: "ready", progress: 100, message: null }
      : { modelId, phase: "missing", progress: null, message: null };
  };
  const announceSpeech = () => {
    emit(speechListeners, speechStatus());
    return speechStatus();
  };
  const setSpeechStatus = (next: SpeechModelStatus) => {
    supertonicStatus = next;
    if (speechSettings.modelId === SPEECH_MODEL_ID) emit(speechListeners, clone(next));
  };
  const downloadSpeech = () =>
    new Promise<SpeechModelStatus>((resolve) => {
      if (speechSettings.modelId !== SPEECH_MODEL_ID || supertonicStatus.phase === "ready")
        return resolve(speechStatus());
      const transfer = { settle: resolve };
      speechTransfer = transfer;
      const advance = (progress: number) => {
        if (speechTransfer !== transfer) return;
        if (progress >= 100) {
          speechTransfer = null;
          setSpeechStatus({ modelId: SPEECH_MODEL_ID, phase: "ready", progress: 100, message: null });
          return resolve(speechStatus());
        }
        setSpeechStatus({ modelId: SPEECH_MODEL_ID, phase: "downloading", progress, message: null });
        schedule(() => advance(progress + 10), 200);
      };
      advance(0);
    });
  const status = (modelId: VoiceModelId): VoiceModelStatus =>
    clone(statuses.get(modelId) ?? { modelId, phase: "missing", progress: null, message: null });
  const setStatus = (next: VoiceModelStatus) => {
    statuses.set(next.modelId, next);
    emit(listeners, next);
  };

  const download = (modelId: VoiceModelId) =>
    new Promise<VoiceModelStatus>((resolve) => {
      const current = status(modelId);
      if (current.phase === "ready" || !isLocalVoiceModelId(modelId)) return resolve(current);
      const transfer = { settle: resolve };
      transfers.set(modelId, transfer);
      setStatus({ modelId, phase: "downloading", progress: 0, message: null });
      const advance = (progress: number) => {
        if (transfers.get(modelId) !== transfer) return;
        if (progress >= 100) {
          transfers.delete(modelId);
          setStatus({ modelId, phase: "ready", progress: 100, message: null });
          return resolve(status(modelId));
        }
        setStatus({ modelId, phase: "downloading", progress, message: null });
        schedule(() => advance(progress + 5), 200);
      };
      schedule(() => advance(5), 200);
    });

  const setDictationKey = (provider: DictationKeyProvider, key: string | null) => {
    for (const model of VOICE_MODELS) {
      if (model.kind !== "cloud" || model.provider !== provider) continue;
      if (key === null) ready.delete(model.id);
      else ready.add(model.id);
      setStatus({
        modelId: model.id,
        phase: key === null ? "missing" : "ready",
        progress: key === null ? null : 100,
        message: null,
      });
    }
  };

  const voice: OpenBotDesktopApi["voice"] = {
    getModelStatus: async () => status(settings.modelId),
    getModelStatuses: async () => VOICE_MODEL_IDS.map(status),
    prepareModel: () => download(settings.modelId),
    downloadModel: ({ modelId }) => download(modelId),
    cancelModelDownload: async ({ modelId }) => {
      const transfer = transfers.get(modelId);
      if (!transfer) return status(modelId);
      transfers.delete(modelId);
      setStatus({ modelId, phase: "missing", progress: null, message: null });
      transfer.settle(status(modelId));
      return status(modelId);
    },
    removeModel: async ({ modelId }) => {
      if (!isLocalVoiceModelId(modelId)) throw new Error("A cloud model has no files to remove.");
      transfers.get(modelId)?.settle({ modelId, phase: "missing", progress: null, message: null });
      transfers.delete(modelId);
      setStatus({ modelId, phase: "missing", progress: null, message: null });
      return status(modelId);
    },
    getSettings: async () => ({ ...clone(settings), saved }),
    setSettings: async (next) => {
      settings = { modelId: next.modelId, language: next.language };
      saved = true;
      return clone(settings);
    },
    transcribe: async () => ({ text: "Mock voice transcript" }),
    setApiKey: async ({ provider, key }) => {
      setDictationKey(provider, key);
      announceSpeech();
      const inUse = VOICE_MODELS.find((model) => model.id === settings.modelId);
      if (inUse?.kind === "cloud" && inUse.provider === provider) return status(inUse.id);
      const first = VOICE_MODELS.find((model) => model.kind === "cloud" && model.provider === provider);
      return status(first?.id ?? ELEVENLABS_VOICE_MODEL_ID);
    },
    startStream: async () => ({ streamId: crypto.randomUUID() }),
    appendStream: async ({ streamId }) => emit(transcriptListeners, { streamId, text: "Mock voice transcript" }),
    finishStream: async () => ({ text: "Mock voice transcript" }),
    cancelStream: async () => {},
    onModelStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStreamTranscript: (listener) => {
      transcriptListeners.add(listener);
      return () => transcriptListeners.delete(listener);
    },
    getSpeechSettings: async () => clone(speechSettings),
    setSpeechSettings: async (next) => {
      const changed = next.modelId !== speechSettings.modelId;
      if (changed && speechTransfer) {
        const transfer = speechTransfer;
        speechTransfer = null;
        supertonicStatus = { modelId: SPEECH_MODEL_ID, phase: "missing", progress: null, message: null };
        transfer.settle(clone(supertonicStatus));
      }
      speechSettings = clone(next);
      if (changed) announceSpeech();
      return clone(speechSettings);
    },
    getSpeechModelStatus: async () => speechStatus(),
    setSpeechApiKey: async ({ provider, key }) => {
      if (provider === "xai") xaiKeySaved = key !== null;
      else setDictationKey("elevenlabs", key);
      return announceSpeech();
    },
    downloadSpeechModel: downloadSpeech,
    cancelSpeechModelDownload: async () => {
      const transfer = speechTransfer;
      if (!transfer) return speechStatus();
      speechTransfer = null;
      setSpeechStatus({ modelId: SPEECH_MODEL_ID, phase: "missing", progress: null, message: null });
      transfer.settle(speechStatus());
      return speechStatus();
    },
    removeSpeechModel: async () => {
      speechTransfer?.settle({ modelId: SPEECH_MODEL_ID, phase: "missing", progress: null, message: null });
      speechTransfer = null;
      setSpeechStatus({ modelId: SPEECH_MODEL_ID, phase: "missing", progress: null, message: null });
      return speechStatus();
    },
    speak: async ({ text }) => ({
      pcm: new Uint8Array(Math.min(10, Math.max(0.5, text.length / 15)) * MOCK_SPEECH_SAMPLE_RATE * 2),
      sampleRate: MOCK_SPEECH_SAMPLE_RATE,
    }),
    warmSpeech: async () => undefined,
    keepRecording: async ({ audio }) => ({
      id: `mock-voice-recording-${audio.byteLength}`,
      name: "voice.webm",
      size: audio.byteLength,
      kind: "file",
      mimeType: "audio/webm",
      previewKind: "none",
      previewUrl: null,
    }),
    onSpeechModelStatus: (listener) => {
      speechListeners.add(listener);
      return () => speechListeners.delete(listener);
    },
    getServer: async () => clone(server),
    probeServer: ({ address, apiKey }) =>
      new Promise((resolve) => schedule(() => resolve(probeMockServer(address, apiKey)), 600)),
    setServer: async ({ server: next }) => {
      server = next && {
        address: next.address,
        hasApiKey: next.apiKey !== null || (server?.hasApiKey ?? false),
        routes: clone(next.routes),
      };
      emit(serverListeners, clone(server));
      return clone(server);
    },
    onServerSettings: (listener) => {
      serverListeners.add(listener);
      return () => serverListeners.delete(listener);
    },
    startLive: async ({ sdp }) => {
      const answerer = new RTCPeerConnection();
      await answerer.setRemoteDescription({ type: "offer", sdp });
      const answer = await answerer.createAnswer();
      await answerer.setLocalDescription(answer);
      const sessionId = crypto.randomUUID();
      liveAnswerers.set(sessionId, answerer);
      schedule(() => {
        if (!liveAnswerers.has(sessionId)) return;
        emit(liveListeners, { type: "transcript", sessionId, role: "user", text: "Mock live question", final: true });
        emit(liveListeners, {
          type: "transcript",
          sessionId,
          role: "assistant",
          text: "Mock live answer",
          final: true,
        });
      }, 1_000);
      return { sessionId, sdp: answer.sdp ?? "" };
    },
    stopLive: async ({ sessionId }) => {
      liveAnswerers.get(sessionId)?.close();
      liveAnswerers.delete(sessionId);
    },
    onLiveEvent: (listener) => {
      liveListeners.add(listener);
      return () => liveListeners.delete(listener);
    },
  };
  return { voice };
}
