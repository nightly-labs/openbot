import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface VoicePort {
  voice: OpenBotDesktopApi["voice"];
}

export function voicePort(): VoicePort {
  return window.openbot;
}
