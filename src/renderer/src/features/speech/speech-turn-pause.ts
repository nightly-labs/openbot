import { DEFAULT_SPEECH_SETTINGS, nextVoiceTurnPause, type VoiceTurnPause } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";
import { updateSpeechSettings } from "./speech-speed";

const [pause, setPause] = createSignal<VoiceTurnPause>(DEFAULT_SPEECH_SETTINGS.turnPauseMs);
let saved: VoiceTurnPause = DEFAULT_SPEECH_SETTINGS.turnPauseMs;
let changes = 0;
let known = false;
let cycling: Promise<void> = Promise.resolve();

export function voiceTurnPause(): VoiceTurnPause {
  return pause();
}

export function loadVoiceTurnPause(): Promise<void> {
  const before = changes;
  return speechPort()
    .voice.getSpeechSettings()
    .then(
      (settings) => {
        known = true;
        if (changes !== before) return;
        saved = settings.turnPauseMs;
        setPause(settings.turnPauseMs);
      },
      () => undefined,
    );
}

export function showSavedVoiceTurnPause(next: VoiceTurnPause): void {
  changes += 1;
  known = true;
  saved = next;
  setPause(next);
}

export function cycleVoiceTurnPause(): void {
  cycling = cycling.then(async () => {
    if (!known) await loadVoiceTurnPause();
    changeVoiceTurnPause();
  });
}

function changeVoiceTurnPause(): void {
  const next = nextVoiceTurnPause(pause());
  changes += 1;
  setPause(next);
  updateSpeechSettings(speechPort().voice, { turnPauseMs: next }).then(
    (settings) => {
      saved = settings.turnPauseMs;
    },
    () => {
      if (pause() === next) setPause(saved);
      toast.error(currentText().t("settings.voice.saveFailed"), {
        report: { operation: "settings", source: "system", cause_code: "unknown" },
      });
    },
  );
}
