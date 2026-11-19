import {
  type CodexLiveVoice,
  cloudSpeechModel,
  type ElevenLabsSpeechVoice,
  type SpeechSettings,
  type SpeechVoice,
  type XaiSpeechVoice,
} from "@openbot/contracts/ipc";

const FEMALE_LIVE_VOICE: CodexLiveVoice = "juniper";
const MALE_LIVE_VOICE: CodexLiveVoice = "cove";
type SpokenVoice = SpeechVoice | ElevenLabsSpeechVoice | XaiSpeechVoice;
const FEMALE_SPEECH_VOICES = new Set<SpokenVoice>([
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "alice",
  "jessica",
  "sarah",
  "eve",
  "ara",
]);
const MALE_SPEECH_VOICES = new Set<SpokenVoice>([
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "chris",
  "eric",
  "george",
  "leo",
  "rex",
]);

export function liveVoiceOf(settings: SpeechSettings): CodexLiveVoice | null {
  if (settings.codexLiveVoice) return settings.codexLiveVoice;
  const provider = cloudSpeechModel(settings.modelId)?.provider;
  const spoken =
    provider === "elevenlabs" ? settings.elevenLabsVoice : provider === "xai" ? settings.xaiVoice : settings.voice;
  if (FEMALE_SPEECH_VOICES.has(spoken)) return FEMALE_LIVE_VOICE;
  if (MALE_SPEECH_VOICES.has(spoken)) return MALE_LIVE_VOICE;
  return null;
}
