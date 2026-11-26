import {
  DEFAULT_VOICE_MODEL_ID,
  DEFAULT_VOICE_SETTINGS,
  VOICE_AUDIO_LIMITS,
  type VoiceModelStatus,
  type VoiceServerSettings,
  type VoiceSettingsState,
  type VoiceTranscriptionInput,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import {
  decodeVoiceTranscription,
  VOICE_TRANSCRIPTION_ROUTES,
} from "@openbot/contracts/team-protocol/voice-transcription-v1";
import { sourceText } from "@openbot/i18n/source";
import { bytesToBase64 } from "@openbot/team-client/base64";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";

const HOST_DICTATES: VoiceServerSettings = {
  address: "",
  hasApiKey: false,
  routes: { dictation: true, speech: false, transcriptionModel: null, speechModel: null, voice: null },
};

const HOST_SETTINGS: VoiceSettingsState = { ...DEFAULT_VOICE_SETTINGS, saved: true };

const HOST_READY: VoiceModelStatus = { modelId: DEFAULT_VOICE_MODEL_ID, phase: "ready", progress: null, message: null };

function hostNotSetUp(error: unknown): boolean {
  return error instanceof Error && error.message === sourceText("error.voice.host.notSetUp");
}

export function webDictationPort(request: () => TeamApiRequest) {
  return {
    getSettings: async () => HOST_SETTINGS,
    getServer: async () => HOST_DICTATES,
    prepareModel: async () => HOST_READY,
    async transcribe({ audio }: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> {
      const upload = {
        name: "dictation.wav",
        mimeType: "audio/wav",
        base64: bytesToBase64(audio),
        maxBytes: VOICE_AUDIO_LIMITS.maximumWavBytes,
      };
      try {
        return await request()("POST", VOICE_TRANSCRIPTION_ROUTES.transcribe, decodeVoiceTranscription, {}, upload);
      } catch (error) {
        if (hostNotSetUp(error)) throw new Error(currentText().t("webClient.voice.notSetUp"));
        throw error;
      }
    },
  };
}
