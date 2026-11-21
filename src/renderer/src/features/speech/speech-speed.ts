import { nextSpeechSpeed, type SpeechSpeed } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { setReplyPlaybackRate } from "./speech-playback";
import { speechPort } from "./speech-port";
import { loadSpeechSettings, updateSpeechSettings } from "./speech-settings-update";

const [speed, setSpeed] = createSignal<SpeechSpeed>(1);
let loading: Promise<void> | undefined;
let changed = false;
let saved: SpeechSpeed = 1;

function apply(next: SpeechSpeed): void {
  setSpeed(next);
  setReplyPlaybackRate(next);
}

export function speechSpeed(): SpeechSpeed {
  void loadSpeechSpeed();
  return speed();
}

export function loadSpeechSpeed(): Promise<void> {
  loading ??= loadSpeechSettings().then((settings) => {
    if (!settings) {
      loading = undefined;
      return;
    }
    if (changed) return;
    saved = settings.speed;
    apply(settings.speed);
  });
  return loading;
}

export function changeSpeechSpeed(next: SpeechSpeed): void {
  if (next === speed()) return;
  changed = true;
  apply(next);
  updateSpeechSettings(speechPort().voice, { speed: next }).then(
    (settings) => {
      saved = settings.speed;
    },
    () => {
      if (speed() === next) apply(saved);
      toast.error(currentText().t("settings.voice.saveFailed"), {
        report: { operation: "settings", source: "system", cause_code: "unknown" },
      });
    },
  );
}

export function cycleSpeechSpeed(): void {
  void loadSpeechSpeed().then(() => {
    changeSpeechSpeed(nextSpeechSpeed(speed()));
  });
}
