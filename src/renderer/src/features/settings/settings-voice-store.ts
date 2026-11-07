import {
  type CodexLiveVoice,
  type DictationKeyProvider,
  ELEVENLABS_VOICE_MODEL_ID,
  type ElevenLabsSpeechVoice,
  isSpeechLanguage,
  SPEECH_MODEL_ID,
  type SpeechKeyProvider,
  type SpeechModelId,
  type SpeechModelStatus,
  type SpeechSettings,
  type SpeechVoice,
  type VoiceLanguage,
  type VoiceModelId,
  type VoiceModelStatus,
  type VoiceServerConnection,
  type VoiceServerInput,
  type VoiceServerSettings,
  type VoiceSettings,
  type XaiSpeechVoice,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { readAloud, stopSpeech } from "../speech/speech-playback";
import { changeSpeechSpeed, speechSpeed, updateSpeechSettings } from "../speech/speech-speed";
import { voicePort } from "./voice-port";

interface SettingsVoiceState {
  /** One status for each model in `VOICE_MODELS`, or null before main answers. */
  statuses: Record<VoiceModelId, VoiceModelStatus | null>;
  settings: VoiceSettings | null;
  /**
   * The status of the model in the settings that reads replies aloud, and the settings, or null
   * before main answers. A cloud model is "ready" when its key is saved.
   */
  speech: { status: SpeechModelStatus | null; settings: SpeechSettings | null; listening: boolean };
  /** The user's own voice server, or null when none is set up or before main answers. */
  server: VoiceServerSettings | null;
}

const EMPTY_STATUSES: SettingsVoiceState["statuses"] = {
  "parakeet-tdt-0.6b-v3": null,
  "parakeet-unified-en-0.6b": null,
  "bark-3.0-plus": null,
  "whisper-turbo": null,
  "cohere-transcribe-03-2026": null,
  [ELEVENLABS_VOICE_MODEL_ID]: null,
  "groq-whisper-large-v3-turbo": null,
  "groq-whisper-large-v3": null,
};

type FailureKey =
  | "settings.voice.loadFailed"
  | "settings.voice.saveFailed"
  | "settings.voice.downloadFailed"
  | "settings.voice.cancelFailed"
  | "settings.voice.removeFailed"
  | "settings.voice.apiKey.saveFailed"
  | "settings.voice.apiKey.removeFailed"
  | "settings.voice.speech.listenFailed"
  | "settings.voice.server.saveFailed"
  | "settings.voice.server.removeFailed";

/**
 * The Voice tab's view of the dictation models and settings. It is created by the settings page,
 * so a download that runs keeps its row while another tab is open.
 */
export function createSettingsVoiceStore(active: () => boolean) {
  const [state, setState] = createStore<SettingsVoiceState>({
    statuses: { ...EMPTY_STATUSES },
    settings: null,
    speech: { status: null, settings: null, listening: false },
    server: null,
  });
  const setServer = (server: VoiceServerSettings | null) =>
    setState((draft) => {
      draft.server = server;
    });
  const setStatus = (status: VoiceModelStatus) =>
    setState((draft) => {
      draft.statuses[status.modelId] = status;
    });

  /** A status of another model, such as a Supertonic download that ends after a change to xAI, is old. */
  const setSpeechStatus = (status: SpeechModelStatus) => {
    const chosen = state.speech.settings?.modelId;
    if (chosen && status.modelId !== chosen) return;
    setState((draft) => {
      draft.speech.status = status;
    });
  };

  // The tab listens only while it is open, and reads every status again each time it opens.
  createEffect(active, (isActive) => {
    if (!isActive) return;
    const voice = voicePort().voice;
    const stopModel = voice.onModelStatus(setStatus);
    const stopSpeechModel = voice.onSpeechModelStatus(setSpeechStatus);
    const stopServer = voice.onServerSettings(setServer);
    void Promise.all([
      voice.getModelStatuses(),
      voice.getSettings(),
      voice.getSpeechModelStatus(),
      voice.getSpeechSettings(),
      voice.getServer(),
    ])
      .then(([statuses, settings, speechStatus, speechSettings, server]) => {
        for (const status of statuses) setStatus(status);
        setState((draft) => {
          draft.settings = settings;
          draft.speech.status = speechStatus;
          draft.speech.settings = speechSettings;
          draft.server = server;
        });
      })
      .catch((error: unknown) => fail(error, "settings.voice.loadFailed"));
    return () => {
      stopModel();
      stopSpeechModel();
      stopServer();
    };
  });

  function fail(error: unknown, fallback: FailureKey): void {
    const { t, errorMessage } = currentText();
    toast.error(errorMessage(error, t(fallback)), {
      report: { operation: "settings", source: "system", cause_code: "unknown" },
    });
  }

  function download(modelId: VoiceModelId): void {
    // Progress arrives as status events; the answer is the status when the download ends.
    void voicePort()
      .voice.downloadModel({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.downloadFailed"));
  }

  function cancel(modelId: VoiceModelId): void {
    void voicePort()
      .voice.cancelModelDownload({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.cancelFailed"));
  }

  /** Deletes a downloaded model from this computer. The model in use downloads again at the next dictation. */
  function remove(modelId: VoiceModelId): void {
    void voicePort()
      .voice.removeModel({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.removeFailed"));
  }

  function save(patch: Partial<VoiceSettings>): void {
    const current = state.settings;
    if (!current) return;
    const next = { ...current, ...patch };
    setState((draft) => {
      draft.settings = next;
    });
    void voicePort()
      .voice.setSettings(next)
      .then((saved) =>
        setState((draft) => {
          draft.settings = saved;
        }),
      )
      .catch((error: unknown) => {
        setState((draft) => {
          draft.settings = current;
        });
        fail(error, "settings.voice.saveFailed");
      });
  }

  function downloadSpeech(): void {
    const analytics = desktopAnalytics.scope();
    const startedAt = performance.now();
    // A cancelled download ends as "missing".
    const track = (phase: SpeechModelStatus["phase"]) =>
      analytics.track("speech_model_action", {
        action: "download",
        entry_point: "settings",
        result: phase === "ready" ? "succeeded" : "failed",
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(phase === "ready" ? {} : { failure_code: phase === "missing" ? "cancelled" : "download_failed" }),
      });
    void voicePort()
      .voice.downloadSpeechModel()
      .then((status) => {
        track(status.phase);
        setSpeechStatus(status);
      })
      .catch((error: unknown) => {
        track("error");
        fail(error, "settings.voice.downloadFailed");
      });
  }

  function cancelSpeech(): void {
    void voicePort()
      .voice.cancelSpeechModelDownload()
      .then(setSpeechStatus)
      .catch((error: unknown) => fail(error, "settings.voice.cancelFailed"));
  }

  function removeSpeech(): void {
    void voicePort()
      .voice.removeSpeechModel()
      .then(setSpeechStatus)
      .catch((error: unknown) => fail(error, "settings.voice.removeFailed"));
  }

  function saveSpeech(patch: Partial<SpeechSettings>): Promise<boolean> {
    const current = state.speech.settings;
    if (!current) return Promise.resolve(false);
    const next = { ...current, ...patch };
    setState((draft) => {
      draft.speech.settings = next;
    });
    // In series with the speed saves of the voice panel and the players, so that no save loses another.
    return updateSpeechSettings(voicePort().voice, patch)
      .then((saved) => {
        setState((draft) => {
          draft.speech.settings = saved;
        });
        return true;
      })
      .catch((error: unknown) => {
        setState((draft) => {
          draft.speech.settings = current;
        });
        fail(error, "settings.voice.saveFailed");
        return false;
      });
  }

  /** Saves the user's own voice server, or removes it with its key when `input` is null. */
  function saveServer(input: VoiceServerInput | null): Promise<boolean> {
    const spoke = state.server?.routes.speech === true;
    return voicePort()
      .voice.setServer({ server: input })
      .then((server) => {
        setServer(server);
        // Replies go back to Supertonic: download it now, as Read replies aloud does.
        if (spoke && !server?.routes.speech && state.speech.settings?.readReplies && supertonicMissing())
          downloadSpeech();
        return true;
      })
      .catch((error: unknown) => {
        fail(error, input ? "settings.voice.server.saveFailed" : "settings.voice.server.removeFailed");
        return false;
      });
  }

  /** A local model chosen with its Use button takes dictation back from the server. */
  function useModel(modelId: VoiceModelId): void {
    save({ modelId });
    const server = state.server;
    if (server?.routes.dictation)
      void saveServer({ address: server.address, apiKey: null, routes: { ...server.routes, dictation: false } });
  }

  /** Voice conversations with Codex agents use Codex live voice. Nothing is downloaded for it. */
  function setCodexLive(codexLive: boolean): void {
    void saveSpeech({ codexLive });
  }

  function setCodexLiveVoice(codexLiveVoice: CodexLiveVoice | null): void {
    void saveSpeech({ codexLiveVoice });
  }

  /** Supertonic is the model in the settings, and it is not on this computer. A cloud model downloads nothing. */
  function supertonicMissing(): boolean {
    const phase = state.speech.status?.phase;
    return state.speech.settings?.modelId === SPEECH_MODEL_ID && (phase === "missing" || phase === "error");
  }

  /**
   * Chooses the model that reads replies aloud. Main sends the status of the new model; a download
   * of Supertonic that runs stops when another model is chosen.
   */
  function setSpeechModel(modelId: SpeechModelId): void {
    void saveSpeech({ modelId }).then((saved) => {
      if (!saved) return;
      void voicePort()
        .voice.getSpeechModelStatus()
        .then((status) => {
          setSpeechStatus(status);
          // Back to Supertonic while replies are read aloud: download it, as Read replies aloud does.
          if (state.speech.settings?.readReplies && !state.server?.routes.speech && supertonicMissing())
            downloadSpeech();
        })
        .catch((error: unknown) => fail(error, "settings.voice.loadFailed"));
    });
  }

  /** Saves or removes the key of a provider of spoken replies. The ElevenLabs key is also the dictation key. */
  function setSpeechApiKey(provider: SpeechKeyProvider, key: string | null): Promise<boolean> {
    return voicePort()
      .voice.setSpeechApiKey({ provider, key })
      .then((status) => {
        setSpeechStatus(status);
        return true;
      })
      .catch((error: unknown) => {
        fail(error, key === null ? "settings.voice.apiKey.removeFailed" : "settings.voice.apiKey.saveFailed");
        return false;
      });
  }

  /** Saves or removes the key of a dictation provider. Main announces the status of each of its models. */
  function setDictationApiKey(provider: DictationKeyProvider, key: string | null): Promise<boolean> {
    return voicePort()
      .voice.setApiKey({ provider, key })
      .then((status) => {
        setStatus(status);
        return true;
      })
      .catch((error: unknown) => {
        fail(error, key === null ? "settings.voice.apiKey.removeFailed" : "settings.voice.apiKey.saveFailed");
        return false;
      });
  }

  /** Turning it on downloads the model, as the first dictation does, unless the server reads replies. */
  function setReadReplies(readReplies: boolean): void {
    void saveSpeech({ readReplies }).then((saved) => {
      desktopAnalytics.track("speech_settings_action", {
        action: readReplies ? "read_replies_on" : "read_replies_off",
        result: saved ? "succeeded" : "failed",
        ...(saved ? {} : { failure_code: "update_failed" }),
      });
      if (state.server?.routes.speech) return;
      if (saved && readReplies && supertonicMissing()) downloadSpeech();
    });
  }

  /** Reads a sample in the language of the interface with the voice in the settings. */
  async function listen(sample: string): Promise<void> {
    if (state.speech.listening) {
      stopSpeech();
      return;
    }
    const locale = currentText().locale();
    setState((draft) => {
      draft.speech.listening = true;
    });
    try {
      await readAloud(sample, isSpeechLanguage(locale) ? locale : "en");
    } catch (error) {
      fail(error, "settings.voice.speech.listenFailed");
    } finally {
      setState((draft) => {
        draft.speech.listening = false;
      });
    }
  }

  return {
    state,
    download,
    cancel,
    remove,
    useModel,
    setLanguage: (language: VoiceLanguage) => save({ language }),
    downloadSpeech,
    cancelSpeech,
    removeSpeech,
    setSpeechModel,
    saveSpeechApiKey: (provider: SpeechKeyProvider, key: string) => setSpeechApiKey(provider, key),
    removeSpeechApiKey: (provider: SpeechKeyProvider) => setSpeechApiKey(provider, null),
    saveDictationApiKey: (provider: DictationKeyProvider, key: string) => setDictationApiKey(provider, key),
    removeDictationApiKey: (provider: DictationKeyProvider) => setDictationApiKey(provider, null),
    setElevenLabsVoice: (elevenLabsVoice: ElevenLabsSpeechVoice) => void saveSpeech({ elevenLabsVoice }),
    setXaiVoice: (xaiVoice: XaiSpeechVoice) => void saveSpeech({ xaiVoice }),
    setReadReplies,
    setCodexLive,
    setCodexLiveVoice,
    setSpeechVoice: (voice: SpeechVoice) =>
      void saveSpeech({ voice }).then((saved) =>
        desktopAnalytics.track("speech_settings_action", {
          action: "voice_changed",
          result: saved ? "succeeded" : "failed",
          voice,
          ...(saved ? {} : { failure_code: "update_failed" }),
        }),
      ),
    /** The speed of replies, shared with the voice panel and the players of spoken replies. */
    speechSpeed,
    setSpeechSpeed: changeSpeechSpeed,
    listen,
    probeServer: (connection: VoiceServerConnection) => voicePort().voice.probeServer(connection),
    saveServer,
  };
}

export type SettingsVoiceStore = ReturnType<typeof createSettingsVoiceStore>;
