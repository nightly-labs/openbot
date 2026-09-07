// The local Whisper model and dictation.

import type { VoiceModelStatus, VoiceTranscriptionResult } from "@openbot/contracts/ipc";
import type { VoiceTranscriptionService } from "../voice-transcription-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseVoiceTranscription } from "./voice-inputs";

export interface VoiceIpcDependencies {
  voice: VoiceTranscriptionService;
}

export function voiceIpcHandlers({ voice }: VoiceIpcDependencies): Pick<IpcGroupHandlers, "voice"> {
  return {
    voice: {
      getModelStatus: handler((): Promise<VoiceModelStatus> => voice.getModelStatus()),
      prepareModel: handler((): Promise<VoiceModelStatus> => voice.prepareModel()),
      transcribe: payloadHandler(
        parseVoiceTranscription,
        (transcription): Promise<VoiceTranscriptionResult> => voice.transcribe(transcription.audio),
      ),
    },
  };
}
