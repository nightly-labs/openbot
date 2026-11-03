import type { SpeechSpeed } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { setReplyPlaybackRate } from "./speech-playback";
import { speechPort } from "./speech-port";

/** The order in which a speed button goes through the speeds, from normal speed. */
const SPEED_CYCLE: readonly SpeechSpeed[] = [1, 1.25, 1.5, 2, 0.75];

const [speed, setSpeed] = createSignal<SpeechSpeed>(1);
let loading: Promise<void> | undefined;
/** True after the user changed the speed, so that a slower first load does not undo the change. */
let changed = false;
/** The saves in the order of the changes, so that the last change is also the last save. */
let saving = Promise.resolve();

function apply(next: SpeechSpeed): void {
  setSpeed(next);
  setReplyPlaybackRate(next);
}

/**
 * The speed of replies that are read aloud. The first read loads the saved speed; until main
 * answers, it is normal speed.
 */
export function speechSpeed(): SpeechSpeed {
  void loadSpeechSpeed();
  return speed();
}

/** Loads the saved speed once, before a reply plays. A failure is forgotten, so the next call tries again. */
export function loadSpeechSpeed(): Promise<void> {
  loading ??= speechPort()
    .voice.getSpeechSettings()
    .then(
      (settings) => {
        if (!changed) apply(settings.speed);
      },
      () => {
        loading = undefined;
      },
    );
  return loading;
}

/**
 * Changes the speed of replies, also of the reply that plays now, and saves it. A failed save goes
 * back to the speed before the change.
 */
export function changeSpeechSpeed(next: SpeechSpeed): void {
  const previous = speed();
  if (next === previous) return;
  changed = true;
  apply(next);
  saving = saving
    .then(async () => {
      const voice = speechPort().voice;
      // Read again, so that a change of another speech setting since the load is kept.
      const settings = await voice.getSpeechSettings();
      await voice.setSpeechSettings({ ...settings, speed: next });
    })
    .catch(() => {
      if (speed() === next) apply(previous);
      toast.error(currentText().t("settings.voice.saveFailed"), {
        report: { operation: "settings", source: "system", cause_code: "unknown" },
      });
    });
}

/** Changes to the next speed of a speed button: 1×, 1.25×, 1.5×, 2×, 0.75×, then 1× again. */
export function cycleSpeechSpeed(): void {
  const index = SPEED_CYCLE.indexOf(speed());
  changeSpeechSpeed(SPEED_CYCLE[(index + 1) % SPEED_CYCLE.length] ?? 1);
}
