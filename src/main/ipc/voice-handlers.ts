// The speech recognition models (Parakeet and Whisper turbo on this computer, ElevenLabs Scribe in
// the cloud), their settings, and dictation. Also the speech model that reads replies aloud, and the
// user's own OpenAI-compatible voice server, which can take either route.

import type {
  DraftAttachment,
  SpeechAudio,
  SpeechModelStatus,
  SpeechSettings,
  VoiceModelStatus,
  VoiceServerProbe,
  VoiceServerSettings,
  VoiceSettings,
  VoiceStream,
  VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { VoiceServerService } from "../voice-server-service";
import type { VoiceSpeechService } from "../voice-speech-service";
import type { VoiceTranscriptionService } from "../voice-transcription-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseSpeechInput,
  parseSpeechSettings,
  parseVoiceApiKey,
  parseVoiceModelRequest,
  parseVoiceRecording,
  parseVoiceServerConnection,
  parseVoiceServerSave,
  parseVoiceSettings,
  parseVoiceStream,
  parseVoiceStreamAudio,
  parseVoiceTranscription,
} from "./voice-inputs";

export interface VoiceIpcDependencies {
  voice: VoiceTranscriptionService;
  speech: VoiceSpeechService;
  /** The user's own server. While one of its routes is on, it replaces the model on this computer. */
  server: VoiceServerService;
  /** Keeps a voice turn's recording as an attachment draft. Voice turns go to this computer's host only. */
  service: Pick<AgentService, "prepareVoiceRecording">;
}

export function voiceIpcHandlers({
  voice,
  speech,
  server,
  service,
}: VoiceIpcDependencies): Pick<IpcGroupHandlers, "voice"> {
  return {
    voice: {
      getModelStatus: handler((): Promise<VoiceModelStatus> => runCauseEffect(voice.getModelStatus())),
      getModelStatuses: handler((): Promise<VoiceModelStatus[]> => runCauseEffect(voice.getModelStatuses())),
      // The server's model is ready on the server: nothing on this computer is downloaded for it.
      prepareModel: handler(
        (): Promise<VoiceModelStatus> =>
          server.dictates()
            ? Promise.resolve({ modelId: voice.getSettings().modelId, phase: "ready", progress: 100, message: null })
            : runCauseEffect(voice.prepareModel()),
      ),
      downloadModel: payloadHandler(
        parseVoiceModelRequest,
        ({ modelId }): Promise<VoiceModelStatus> => runCauseEffect(voice.downloadModel(modelId)),
      ),
      cancelModelDownload: payloadHandler(
        parseVoiceModelRequest,
        ({ modelId }): Promise<VoiceModelStatus> => runCauseEffect(voice.cancelModelDownload(modelId)),
      ),
      removeModel: payloadHandler(
        parseVoiceModelRequest,
        ({ modelId }): Promise<VoiceModelStatus> => runCauseEffect(voice.removeModel(modelId)),
      ),
      getSettings: handler((): VoiceSettings => voice.getSettings()),
      setSettings: payloadHandler(
        parseVoiceSettings,
        (settings): Promise<VoiceSettings> => runCauseEffect(voice.setSettings(settings)),
      ),
      transcribe: payloadHandler(
        parseVoiceTranscription,
        ({ audio }): Promise<VoiceTranscriptionResult> =>
          runCauseEffect(
            server.dictates() ? server.transcribe(audio, voice.getSettings().language) : voice.transcribe(audio),
          ),
      ),
      setApiKey: payloadHandler(
        parseVoiceApiKey,
        ({ key }): Promise<VoiceModelStatus> => runCauseEffect(voice.setApiKey(key)),
      ),
      startStream: handler((): Promise<VoiceStream> => runCauseEffect(voice.startStream())),
      appendStream: payloadHandler(
        parseVoiceStreamAudio,
        (audio): Promise<void> => runCauseEffect(voice.appendStream(audio)),
      ),
      finishStream: payloadHandler(
        parseVoiceStream,
        (stream): Promise<VoiceTranscriptionResult> => runCauseEffect(voice.finishStream(stream)),
      ),
      cancelStream: payloadHandler(parseVoiceStream, (stream): void => voice.cancelStream(stream)),
      getSpeechSettings: handler((): SpeechSettings => speech.getSettings()),
      setSpeechSettings: payloadHandler(
        parseSpeechSettings,
        (settings): Promise<SpeechSettings> => runCauseEffect(speech.setSettings(settings)),
      ),
      getSpeechModelStatus: handler((): Promise<SpeechModelStatus> => runCauseEffect(speech.getModelStatus())),
      downloadSpeechModel: handler((): Promise<SpeechModelStatus> => runCauseEffect(speech.downloadModel())),
      cancelSpeechModelDownload: handler(
        (): Promise<SpeechModelStatus> => runCauseEffect(speech.cancelModelDownload()),
      ),
      removeSpeechModel: handler((): Promise<SpeechModelStatus> => runCauseEffect(speech.removeModel())),
      speak: payloadHandler(
        parseSpeechInput,
        (input): Promise<SpeechAudio> =>
          runCauseEffect(server.speaks() ? server.speak(input.text) : speech.speak(input)),
      ),
      // A server has nothing to load on this computer.
      warmSpeech: handler((): Promise<void> => (server.speaks() ? Promise.resolve() : runCauseEffect(speech.warm()))),
      keepRecording: payloadHandler(parseVoiceRecording, async ({ audio }): Promise<DraftAttachment> => {
        const [draft] = await runCauseEffect(service.prepareVoiceRecording(audio));
        if (!draft) throw new Error(sourceText("error.voice.recordingNotKept"));
        return draft;
      }),
      getServer: handler((): VoiceServerSettings | null => server.get()),
      probeServer: payloadHandler(
        parseVoiceServerConnection,
        (connection): Promise<VoiceServerProbe> => runCauseEffect(server.probe(connection)),
      ),
      setServer: payloadHandler(
        parseVoiceServerSave,
        (save): Promise<VoiceServerSettings | null> => runCauseEffect(server.set(save.server)),
      ),
    },
  };
}
