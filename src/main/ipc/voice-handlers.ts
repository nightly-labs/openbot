import { Effect } from "effect";
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
      getModelStatus: handler(
        (): Promise<VoiceModelStatus> =>
          Effect.runPromise(voice.getModelStatus().pipe(Effect.mapError((error) => error.cause))),
      ),
      prepareModel: handler(
        (): Promise<VoiceModelStatus> =>
          Effect.runPromise(voice.prepareModel().pipe(Effect.mapError((error) => error.cause))),
      ),
      transcribe: payloadHandler(
        parseVoiceTranscription,
        (transcription): Promise<VoiceTranscriptionResult> =>
          Effect.runPromise(voice.transcribe(transcription.audio).pipe(Effect.mapError((error) => error.cause))),
      ),
    },
  };
}
