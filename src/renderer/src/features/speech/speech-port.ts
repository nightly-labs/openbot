import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface SpeechPort {
  voice: Pick<
    OpenBotDesktopApi["voice"],
    | "getSpeechSettings"
    | "setSpeechSettings"
    | "setAgentElevenLabsVoiceId"
    | "onSpeechSettings"
    | "getSpeechModelStatus"
    | "downloadSpeechModel"
    | "onSpeechModelStatus"
    | "speak"
    | "warmSpeech"
    | "keepRecording"
    | "getServer"
    | "onServerSettings"
  >;
  agent: Pick<OpenBotDesktopApi["agent"], "readConversationPage" | "discardDraftAttachment">;
}

export function speechPort(): SpeechPort {
  return window.openbot;
}
