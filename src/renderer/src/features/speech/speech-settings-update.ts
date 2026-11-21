import { DEFAULT_SPEECH_SETTINGS, type OpenBotDesktopApi, type SpeechSettings } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { clearSpokenAudioCache } from "./speech-playback";
import { speechPort } from "./speech-port";

const [latestSpeechSettings, setLatestSpeechSettings] = createSignal<SpeechSettings>(DEFAULT_SPEECH_SETTINGS);
const [speechSettingsLoaded, setSpeechSettingsLoaded] = createSignal(false);
let saving: Promise<unknown> = Promise.resolve();
let loading: Promise<SpeechSettings | undefined> | undefined;
let following = false;
let appliedVersion = 0;
let broadcastVersion = 0;

function voiceConfigChanged(previous: SpeechSettings, next: SpeechSettings): boolean {
  if (
    previous.modelId !== next.modelId ||
    previous.voice !== next.voice ||
    previous.elevenLabsVoice !== next.elevenLabsVoice ||
    previous.elevenLabsCustomVoiceId !== next.elevenLabsCustomVoiceId ||
    previous.xaiVoice !== next.xaiVoice
  ) {
    return true;
  }
  const previousAgents = previous.elevenLabsAgentVoiceIds;
  const nextAgents = next.elevenLabsAgentVoiceIds;
  const previousKeys = Object.keys(previousAgents);
  const nextKeys = Object.keys(nextAgents);
  if (previousKeys.length !== nextKeys.length) return true;
  return previousKeys.some((key) => previousAgents[key] !== nextAgents[key]);
}

export function applySpeechSettings(next: SpeechSettings): void {
  const wasLoaded = speechSettingsLoaded();
  appliedVersion += 1;
  const previous = latestSpeechSettings();
  setLatestSpeechSettings(next);
  if (!wasLoaded) {
    setSpeechSettingsLoaded(true);
    return;
  }
  if (voiceConfigChanged(previous, next)) clearSpokenAudioCache();
}

export function followSpeechSettings(): void {
  if (following) return;
  following = true;
  speechPort().voice.onSpeechSettings((next) => {
    broadcastVersion += 1;
    applySpeechSettings(next);
  });
}

export function loadSpeechSettings(): Promise<SpeechSettings | undefined> {
  followSpeechSettings();
  if (speechSettingsLoaded()) return Promise.resolve(latestSpeechSettings());
  loading ??= (() => {
    const versionAtStart = appliedVersion;
    return speechPort()
      .voice.getSpeechSettings()
      .then(
        (settings) => {
          if (appliedVersion === versionAtStart) applySpeechSettings(settings);
          return latestSpeechSettings();
        },
        () => {
          loading = undefined;
          return undefined;
        },
      );
  })();
  return loading.then((loaded) => (loaded ? latestSpeechSettings() : undefined));
}

export { latestSpeechSettings, speechSettingsLoaded };

export function speechSettings(): SpeechSettings {
  void loadSpeechSettings();
  return latestSpeechSettings();
}

export function updateSpeechSettings(
  voice: Pick<OpenBotDesktopApi["voice"], "getSpeechSettings" | "setSpeechSettings">,
  patch: Partial<SpeechSettings>,
): Promise<SpeechSettings> {
  followSpeechSettings();
  const next = saving.then(async () => {
    const current = await voice.getSpeechSettings();
    const seenBroadcast = broadcastVersion;
    const updated = await voice.setSpeechSettings({ ...current, ...patch });
    if (broadcastVersion === seenBroadcast) applySpeechSettings(updated);
    return latestSpeechSettings();
  });
  saving = next.catch(() => undefined);
  return next;
}

export function setAgentElevenLabsVoiceId(agentKey: string, voiceId: string | null): Promise<SpeechSettings> {
  followSpeechSettings();
  const next = saving.then(async () => {
    const seenBroadcast = broadcastVersion;
    const updated = await speechPort().voice.setAgentElevenLabsVoiceId({ agentKey, voiceId });
    if (broadcastVersion === seenBroadcast) applySpeechSettings(updated);
    return latestSpeechSettings();
  });
  saving = next.catch(() => undefined);
  return next;
}
